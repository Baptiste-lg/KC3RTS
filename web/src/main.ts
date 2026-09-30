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
if (new URLSearchParams(window.location.search).has("profile")) {
  (window as Window & { __kc3rtsStats?: () => ReturnType<WorldView["getRenderInfo"]> | null }).__kc3rtsStats = () => view?.getRenderInfo() ?? null;
}
let status: GameConnectionStatus = "connecting", graphicsFailed = false, placing = false, noticeTimer = 0;
let selectedBuilding: number | null = 1;
let selectedInfo: { kind: "resource" | "enemy"; id: number } | null = null;
const selectedVillagers = new Set<number>();
const controlGroups = new Map<number, number[]>();
let lastGroup = 0, lastGroupTime = 0;
const minimap = new Minimap(minimapCanvas, (point) => { view?.focus(point); if (world && view) minimap.draw(world, view.getFocus(), view.getViewport()); });
const statusLabels: Record<GameConnectionStatus, string> = { connecting: "Connecting…", connected: "Connected game", local: "Solo game", offline: "Server offline", expired: "Match unavailable", incompatible: "Incompatible version" };
const errors: Record<string, string> = { insufficient_resources: "Not enough resources.", invalid_location: "Site too close to an obstacle or outside the map.", invalid_target: "Target unavailable.", invalid_selection: "Select a villager.", invalid_building: "Select a completed town center.", offline: "Connection lost.", rate_limited: "Too many orders. Try again in a moment.", match_limit: "The server is full. Try again later.", match_unavailable: "This match ended. Reload to start a new match.", game_over: "The game has ended." };
function showNotice(message: string): void { window.clearTimeout(noticeTimer); notice.textContent = message; noticeTimer = window.setTimeout(() => { notice.textContent = "Left click: select · right click: issue an order."; }, 5_000); }
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
  selectionLabel.textContent = selectedVillagers.size ? `${selectedVillagers.size} ${selectedVillagers.size === 1 ? "villager" : "villagers"} selected` : selectedCenter() ? `Town center #${selectedCenter()!.id} · ${selectedCenter()!.hp}/${selectedCenter()!.max_hp} HP` : resource ? `${{ wood: "Wood", stone: "Stone", gold: "Gold" }[resource.kind]} · ${resource.amount} remaining` : enemy ? `Enemy base · ${enemy.hp}/${enemy.max_hp} HP` : "No unit selected";
  if (selected.length === 1) {
    const unit = selected[0];
    const order = unit.order?.kind === "gather" ? "Gathering" : unit.order?.kind === "move" ? "Moving" : unit.order?.kind === "build" ? "Building" : unit.order?.kind === "attack" ? "Attacking" : "Idle";
    selectionDetail.textContent = `HP ${unit.hp}/${unit.max_hp} · ${order}${unit.cargo ? ` · Carrying ${unit.cargo} ${unit.cargo_kind}` : ""}`;
  } else if (selected.length > 1) {
    selectionDetail.textContent = `${selected.filter((v) => v.order === null).length} idle · ${selected.length} units`;
  } else if (selectedCenter()) {
    selectionDetail.textContent = `HP ${selectedCenter()!.hp}/${selectedCenter()!.max_hp} · Trains villagers · Receives resources`;
  } else {
    selectionDetail.textContent = resource ? `${resource.amount}/${resource.initial_amount} available` : enemy ? `HP ${enemy.hp}/${enemy.max_hp}` : "";
  }
  commandHelp.textContent = selected.length ? "Right click terrain to move, a resource to gather, or the red base to attack." : selectedCenter() ? "Recruit here, or select your villagers on the map." : "Left click to select; right click to issue an order.";
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
    else { view = new WorldView(sceneMount, snapshot, actions); loading.hidden = true; showNotice("Select your villagers, then right click a resource."); }
    updateControls();
    if (view) minimap.draw(snapshot, view.getFocus(), view.getViewport());
    if (snapshot.outcome !== "playing" && previousOutcome !== snapshot.outcome) showNotice(snapshot.outcome === "victory" ? "Victory! The enemy base is destroyed." : "Defeat.");
  } catch (error) { console.error(error); graphicsFailed = true; loading.hidden = true; fallback.hidden = false; updateControls(); }
}
function onStatus(next: GameConnectionStatus): void { status = next; connectionBadge.dataset.state = next; connectionLabel.textContent = statusLabels[next]; updateControls(); }
function onCommand(outcome: CommandOutcome): void { if (!outcome.ok) showNotice(errors[outcome.reason] ?? `Order rejected (${outcome.reason}).`); }
const requestedSeed = Number(new URLSearchParams(location.search).get("seed"));
const localSeed = Number.isSafeInteger(requestedSeed) && requestedSeed > 0 ? requestedSeed : undefined;
const connection: GameClient = import.meta.env.VITE_KC3RTS_MODE === "local" ? new LocalGameConnection({ onSnapshot, onStatus, onCommand }, localSeed) : new GameConnection({ onSnapshot, onStatus, onCommand });
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
  order(hit: MapHit): boolean {
    placing = false; updateControls(); if (!selectedVillagers.size) return false;
    const villager_ids = [...selectedVillagers];
    if (hit.kind === "resource") send({ type: "order", villager_ids, order: { kind: "gather", id: hit.id } });
    else if (hit.kind === "building") {
      const b = world?.buildings.find((item) => item.id === hit.id);
      if (b?.owner === "enemy") send({ type: "order", villager_ids, order: { kind: "attack", id: b.id } });
      else if (b && b.progress < 100) send({ type: "order", villager_ids, order: { kind: "build", id: b.id } });
      else if (b) send({ type: "order", villager_ids, order: { kind: "move", x: b.x + 4, z: b.z } });
      else return false;
    } else if (hit.kind === "ground") send({ type: "order", villager_ids, order: { kind: "move", ...hit.point } });
    return true;
  },
  place(point: GroundPoint): void { if (!placing) return; placing = false; updateControls(); send({ type: "build", villager_ids: [...selectedVillagers], ...point }); },
  isPlacing: (): boolean => placing,
};
recruitButton.addEventListener("click", () => { const center = selectedCenter(); if (center) send({ type: "spawn_villager", building_id: center.id }); });
stopButton.addEventListener("click", () => { if (selectedVillagers.size) send({ type: "stop", villager_ids: [...selectedVillagers] }); });
buildButton.addEventListener("click", () => { placing = !placing; updateControls(); if (placing) showNotice("Click open ground to place the town center."); });
window.addEventListener("keydown", (e) => {
  if (e.altKey || e.metaKey || e.repeat) return;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) {
    const number = Number(digit[1]);
    if (e.ctrlKey) {
      e.preventDefault();
      if (selectedVillagers.size) { controlGroups.set(number, [...selectedVillagers]); showNotice(`Group ${number} saved.`); }
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
  if (e.code === "KeyB" && !buildButton.disabled) { placing = !placing; updateControls(); if (placing) showNotice("Click open ground to place the town center."); }
  if (e.code === "KeyV" && !recruitButton.disabled) recruitButton.click();
  if (e.code === "KeyX" && !stopButton.disabled) stopButton.click();
});
connection.connect();
if (import.meta.hot) import.meta.hot.dispose(() => { connection.disconnect(); view?.dispose(); minimap.dispose(); });
