import "./style.css";
import { GameConnection, type GameClient, type GameConnectionStatus, type RecruitmentOutcome } from "./game/connection";
import { LocalGameConnection } from "./game/local_connection";
import type { WorldSnapshot } from "./game/protocol";
import { WorldView } from "./scene/world_view";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}

const sceneMount = element<HTMLDivElement>("scene");
const stockpileLabel = element<HTMLElement>("stockpile");
const villagerLabel = element<HTMLElement>("villagers");
const remainingLabel = element<HTMLElement>("remaining");
const tickLabel = element<HTMLElement>("tick");
const connectionBadge = element<HTMLElement>("connection");
const connectionLabel = element<HTMLElement>("connection-label");
const recruitButton = element<HTMLButtonElement>("recruit");
const notice = element<HTMLElement>("notice");
const loading = element<HTMLElement>("loading");
const fallback = element<HTMLElement>("fallback");

let view: WorldView | null = null;
let currentWorld: WorldSnapshot | null = null;
let connectionState: GameConnectionStatus = "connecting";
let graphicsFailed = false;
let noticeTimer = 0;

const statusLabels: Record<GameConnectionStatus, string> = {
  connecting: "Connexion au village…",
  connected: "Village connecté",
  local: "Partie solo · navigateur",
  offline: "Serveur hors ligne",
  incompatible: "Version du serveur incompatible",
};

const errorLabels: Record<string, string> = {
  insufficient_resources: "Pas assez de ressources pour recruter.",
  offline: "La connexion au village est interrompue.",
  timeout: "Le serveur ne répond pas. Réessayez.",
  invalid_response: "Le serveur a envoyé une réponse invalide.",
};

function updateButton(): void {
  recruitButton.disabled = graphicsFailed || (connectionState !== "connected" && connectionState !== "local") ||
    currentWorld === null || currentWorld.stockpile < 5;
}

function showNotice(message: string): void {
  window.clearTimeout(noticeTimer);
  notice.textContent = message;
  noticeTimer = window.setTimeout(() => {
    notice.textContent = "Les villageois récoltent automatiquement.";
  }, 4_000);
}

function updateWorld(snapshot: WorldSnapshot): void {
  currentWorld = snapshot;
  stockpileLabel.textContent = String(snapshot.stockpile);
  villagerLabel.textContent = String(snapshot.villagers.length);
  remainingLabel.textContent = String(snapshot.resources.reduce((sum, node) => sum + node.amount, 0));
  const seconds = Math.floor(snapshot.tick / 10);
  tickLabel.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  updateButton();

  if (graphicsFailed) return;
  try {
    if (view) {
      view.update(snapshot);
    } else {
      view = new WorldView(sceneMount, snapshot);
      loading.hidden = true;
      showNotice("Le village est prêt. Recrutez votre premier villageois !");
    }
  } catch {
    graphicsFailed = true;
    loading.hidden = true;
    fallback.hidden = false;
    updateButton();
  }
}

function updateStatus(status: GameConnectionStatus): void {
  connectionState = status;
  connectionBadge.dataset.state = status;
  connectionLabel.textContent = statusLabels[status];
  updateButton();
  if (status === "offline") showNotice("Connexion perdue. Reconnexion en cours…");
  if (status === "incompatible") showNotice("Version du serveur incompatible avec ce jeu.");
}

function showRecruitment(outcome: RecruitmentOutcome): void {
  if (outcome.ok) {
    showNotice("Un nouveau villageois rejoint le centre.");
  } else {
    showNotice(errorLabels[outcome.reason] ?? "Le recrutement a été refusé.");
  }
}

const handlers = {
  onSnapshot: updateWorld,
  onStatus: updateStatus,
  onRecruitment: showRecruitment,
};
const connection: GameClient = import.meta.env.VITE_KC3RTS_MODE === "local"
  ? new LocalGameConnection(handlers)
  : new GameConnection(handlers);

recruitButton.addEventListener("click", () => connection.spawnVillager());
window.addEventListener("keydown", (event) => {
  if (event.code === "KeyB" && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (!recruitButton.disabled) connection.spawnVillager();
  }
});
connection.connect();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    connection.disconnect();
    view?.dispose();
  });
}
