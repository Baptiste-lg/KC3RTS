import "./style.css";
import { GameConnection, type GameClient, type GameConnectionStatus, type CommandOutcome } from "./game/connection";
import { LocalGameConnection } from "./game/local_connection";
import type { Building, GameCommand, GroundPoint, WorldSnapshot } from "./game/protocol";
import { WorldView, type MapHit } from "./scene/world_view";
import { Minimap } from "./scene/minimap";

function element<T extends HTMLElement>(id: string): T { const found = document.getElementById(id); if (!found) throw new Error(`Missing interface element: ${id}`); return found as T; }
const sceneMount = element<HTMLDivElement>("scene");
const minimapCanvas = element<HTMLCanvasElement>("minimap");
const woodLabel = element<HTMLElement>("wood"), stoneLabel = element<HTMLElement>("stone"), goldLabel = element<HTMLElement>("gold");
const mapSeedLabel = element<HTMLElement>("map-seed");
const villagerLabel = element<HTMLElement>("villagers"), enemyHpLabel = element<HTMLElement>("enemy-hp"), tickLabel = element<HTMLElement>("tick");
const connectionBadge = element<HTMLElement>("connection"), connectionLabel = element<HTMLElement>("connection-label");
const recruitButton = element<HTMLButtonElement>("recruit"), buildButton = element<HTMLButtonElement>("build"), stopButton = element<HTMLButtonElement>("stop");
const selectionLabel = element<HTMLElement>("selection"), selectionDetail = element<HTMLElement>("selection-detail"), commandHelp = element<HTMLElement>("command-help"), notice = element<HTMLElement>("notice");
const loading = element<HTMLElement>("loading"), fallback = element<HTMLElement>("fallback");
let view: WorldView | null = null, world: WorldSnapshot | null = null;
let status: GameConnectionStatus = "connecting", graphicsFailed = false, placing = false, noticeTimer = 0;
let selectedBuilding: number | null = 1;
let selectedInfo: { kind: "resource" | "enemy"; id: number } | null = null;
const selectedVillagers = new Set<number>();
const controlGroups = new Map<number, number[]>();
let lastGroup = 0, lastGroupTime = 0;
const minimap = new Minimap(minimapCanvas, (point) => { view?.focus(point); if (world && view) minimap.draw(world, view.getFocus()); });
const statusLabels: Record<GameConnectionStatus, string> = { connecting: "Connexion…", connected: "Partie connectée", local: "Partie solo", offline: "Serveur hors ligne", incompatible: "Version incompatible" };
const errors: Record<string, string> = { insufficient_resources: "Ressources insuffisantes.", invalid_location: "Emplacement trop proche d’un obstacle ou hors de la carte.", invalid_target: "Cible indisponible.", invalid_selection: "Sélectionnez un villageois.", invalid_building: "Sélectionnez un centre terminé.", offline: "Connexion interrompue.", game_over: "La partie est terminée." };
function showNotice(message: string): void { window.clearTimeout(noticeTimer); notice.textContent = message; noticeTimer = window.setTimeout(() => { notice.textContent = "Clic gauche : sélectionner · clic droit : donner un ordre."; }, 5_000); }
function selectedCenter(): Building | undefined { return world?.buildings.find((b) => b.id === selectedBuilding && b.owner === "player" && b.hp > 0 && b.progress === 100); }
function updateControls(): void {
  const ready = !graphicsFailed && (status === "connected" || status === "local") && world?.outcome === "playing";
  recruitButton.disabled = !ready || !selectedCenter() || (world?.stockpile.wood ?? 0) < 5 || (world?.stockpile.gold ?? 0) < 5;
  buildButton.disabled = !ready || selectedVillagers.size === 0 || (world?.stockpile.wood ?? 0) < 25 || (world?.stockpile.stone ?? 0) < 15;
  const selected = world?.villagers.filter((v) => selectedVillagers.has(v.id)) ?? [];
  recruitButton.hidden = !selectedCenter();
  buildButton.hidden = selected.length === 0;
  stopButton.hidden = selected.length === 0;
  stopButton.disabled = !ready || !selected.some((v) => v.order !== null);
  buildButton.classList.toggle("active", placing);
  const resource = selectedInfo?.kind === "resource" ? world?.resources.find((r) => r.id === selectedInfo?.id) : null;
  const enemy = selectedInfo?.kind === "enemy" ? world?.buildings.find((b) => b.id === selectedInfo?.id) : null;
  selectionLabel.textContent = selectedVillagers.size ? `${selectedVillagers.size} villageois sélectionné${selectedVillagers.size > 1 ? "s" : ""}` : selectedCenter() ? `Centre #${selectedCenter()!.id} · ${selectedCenter()!.hp}/${selectedCenter()!.max_hp} PV` : resource ? `${{ wood: "Bois", stone: "Pierre", gold: "Or" }[resource.kind]} · ${resource.amount} restants` : enemy ? `Base adverse · ${enemy.hp}/${enemy.max_hp} PV` : "Aucune unité sélectionnée";
  if (selected.length === 1) {
    const unit = selected[0];
    const order = unit.order?.kind === "gather" ? "Récolte" : unit.order?.kind === "move" ? "Déplacement" : unit.order?.kind === "build" ? "Construction" : unit.order?.kind === "attack" ? "Attaque" : "Inactif";
    selectionDetail.textContent = `PV ${unit.hp}/${unit.max_hp} · ${order}${unit.cargo ? ` · Charge ${unit.cargo} ${unit.cargo_kind}` : ""}`;
  } else if (selected.length > 1) {
    selectionDetail.textContent = `${selected.filter((v) => v.order === null).length} inactifs · ${selected.length} unités`;
  } else if (selectedCenter()) {
    selectionDetail.textContent = `PV ${selectedCenter()!.hp}/${selectedCenter()!.max_hp} · Produit des villageois · Reçoit les ressources`;
  } else {
    selectionDetail.textContent = resource ? `${resource.amount}/${resource.initial_amount} disponibles` : enemy ? `PV ${enemy.hp}/${enemy.max_hp}` : "";
  }
  commandHelp.textContent = selected.length ? "Clic droit sur le terrain pour déplacer, sur une ressource pour récolter, sur la base rouge pour attaquer." : selectedCenter() ? "Recrutez ici, ou sélectionnez vos villageois sur la carte." : "Clic gauche pour sélectionner ; clic droit pour donner un ordre.";
  view?.select(selectedVillagers, selectedBuilding);
  view?.setPlacing(placing);
}
function onSnapshot(snapshot: WorldSnapshot): void {
  const previousOutcome = world?.outcome;
  world = snapshot;
  for (const id of selectedVillagers) if (!snapshot.villagers.some((v) => v.id === id)) selectedVillagers.delete(id);
  mapSeedLabel.textContent = String(snapshot.seed);
  woodLabel.textContent = String(snapshot.stockpile.wood); stoneLabel.textContent = String(snapshot.stockpile.stone); goldLabel.textContent = String(snapshot.stockpile.gold);
  villagerLabel.textContent = String(snapshot.villagers.length);
  const enemy = snapshot.buildings.find((b) => b.owner === "enemy"); enemyHpLabel.textContent = String(enemy?.hp ?? 0);
  const seconds = Math.floor(snapshot.tick / 10); tickLabel.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  if (graphicsFailed) return;
  try {
    if (view) view.update(snapshot);
    else { view = new WorldView(sceneMount, snapshot, actions); loading.hidden = true; showNotice("Sélectionnez vos villageois, puis clic droit sur une ressource."); }
    updateControls();
    if (view) minimap.draw(snapshot, view.getFocus());
    if (snapshot.outcome !== "playing" && previousOutcome !== snapshot.outcome) showNotice(snapshot.outcome === "victory" ? "Victoire ! La base adverse est détruite." : "Défaite.");
  } catch (error) { console.error(error); graphicsFailed = true; loading.hidden = true; fallback.hidden = false; updateControls(); }
}
function onStatus(next: GameConnectionStatus): void { status = next; connectionBadge.dataset.state = next; connectionLabel.textContent = statusLabels[next]; updateControls(); }
function onCommand(outcome: CommandOutcome): void { if (!outcome.ok) showNotice(errors[outcome.reason] ?? `Ordre refusé (${outcome.reason}).`); }
const connection: GameClient = import.meta.env.VITE_KC3RTS_MODE === "local" ? new LocalGameConnection({ onSnapshot, onStatus, onCommand }) : new GameConnection({ onSnapshot, onStatus, onCommand });
function send(command: GameCommand): void { connection.command(command); }
const actions = {
  select(hit: MapHit, additive: boolean): void {
    if (hit.kind === "villager") {
      if (!additive) selectedVillagers.clear();
      if (additive && selectedVillagers.has(hit.id)) selectedVillagers.delete(hit.id); else selectedVillagers.add(hit.id);
      selectedBuilding = null; selectedInfo = null;
    } else if (hit.kind === "building" && world?.buildings.some((b) => b.id === hit.id && b.owner === "player")) {
      selectedVillagers.clear(); selectedBuilding = hit.id; selectedInfo = null;
    } else if (hit.kind === "resource") {
      selectedVillagers.clear(); selectedBuilding = null; selectedInfo = { kind: "resource", id: hit.id };
    } else if (hit.kind === "building") {
      selectedVillagers.clear(); selectedBuilding = null; selectedInfo = { kind: "enemy", id: hit.id };
    } else if (!additive) { selectedVillagers.clear(); selectedBuilding = null; selectedInfo = null; }
    placing = false; updateControls();
  },
  selectArea(ids: number[], additive: boolean): void { if (!additive) selectedVillagers.clear(); ids.forEach((id) => selectedVillagers.add(id)); selectedBuilding = null; selectedInfo = null; updateControls(); },
  order(hit: MapHit): void {
    placing = false; updateControls(); if (!selectedVillagers.size) return;
    const villager_ids = [...selectedVillagers];
    if (hit.kind === "resource") send({ type: "order", villager_ids, order: { kind: "gather", id: hit.id } });
    else if (hit.kind === "building") {
      const b = world?.buildings.find((item) => item.id === hit.id);
      if (b?.owner === "enemy") send({ type: "order", villager_ids, order: { kind: "attack", id: b.id } });
      else if (b && b.progress < 100) send({ type: "order", villager_ids, order: { kind: "build", id: b.id } });
      else if (b) send({ type: "order", villager_ids, order: { kind: "move", x: b.x + 4, z: b.z } });
    } else if (hit.kind === "ground") send({ type: "order", villager_ids, order: { kind: "move", ...hit.point } });
  },
  place(point: GroundPoint): void { if (!placing) return; placing = false; updateControls(); send({ type: "build", villager_ids: [...selectedVillagers], ...point }); },
  isPlacing: (): boolean => placing,
};
recruitButton.addEventListener("click", () => { const center = selectedCenter(); if (center) send({ type: "spawn_villager", building_id: center.id }); });
stopButton.addEventListener("click", () => { if (selectedVillagers.size) send({ type: "stop", villager_ids: [...selectedVillagers] }); });
buildButton.addEventListener("click", () => { placing = !placing; updateControls(); if (placing) showNotice("Cliquez sur un terrain libre pour placer le centre."); });
window.addEventListener("keydown", (e) => {
  if (e.altKey || e.metaKey || e.repeat) return;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) {
    const number = Number(digit[1]);
    if (e.ctrlKey) {
      e.preventDefault();
      if (selectedVillagers.size) { controlGroups.set(number, [...selectedVillagers]); showNotice(`Groupe ${number} enregistré.`); }
    } else if (!e.shiftKey) {
      const ids = controlGroups.get(number)?.filter((id) => world?.villagers.some((v) => v.id === id)) ?? [];
      if (ids.length) {
        selectedVillagers.clear(); ids.forEach((id) => selectedVillagers.add(id)); selectedBuilding = null; selectedInfo = null;
        if (lastGroup === number && performance.now() - lastGroupTime < 450) {
          const units = world!.villagers.filter((v) => selectedVillagers.has(v.id));
          view?.focus({ x: units.reduce((sum, v) => sum + v.x, 0) / units.length, z: units.reduce((sum, v) => sum + v.z, 0) / units.length });
        }
        lastGroup = number; lastGroupTime = performance.now(); updateControls();
      }
    }
    return;
  }
  if (e.ctrlKey && e.code === "KeyA" && world) {
    e.preventDefault(); world.villagers.forEach((v) => selectedVillagers.add(v.id)); selectedBuilding = null; selectedInfo = null; updateControls(); return;
  }
  if (e.ctrlKey) return;
  if (e.code === "Escape") { placing = false; selectedVillagers.clear(); selectedBuilding = null; selectedInfo = null; updateControls(); }
  if (e.code === "KeyB" && !buildButton.disabled) { placing = !placing; updateControls(); if (placing) showNotice("Cliquez sur un terrain libre pour placer le centre."); }
  if (e.code === "KeyV" && !recruitButton.disabled) recruitButton.click();
  if (e.code === "KeyX" && !stopButton.disabled) stopButton.click();
});
connection.connect();
if (import.meta.hot) import.meta.hot.dispose(() => { connection.disconnect(); view?.dispose(); minimap.dispose(); });
