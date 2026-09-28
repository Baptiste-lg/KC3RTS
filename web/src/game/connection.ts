import { Socket, type Channel } from "phoenix";
import { parseSnapshot, type GameCommand, type WorldSnapshot } from "./protocol";

export type GameConnectionStatus = "connecting" | "connected" | "local" | "offline" | "incompatible";
export type CommandOutcome = { ok: true } | { ok: false; reason: string };
export interface GameConnectionHandlers {
  onSnapshot(snapshot: WorldSnapshot): void;
  onStatus(status: GameConnectionStatus): void;
  onCommand(outcome: CommandOutcome): void;
}
export interface GameClient { connect(): void; command(command: GameCommand): void; disconnect(): void }
function readWorld(payload: unknown): WorldSnapshot | null {
  if (typeof payload !== "object" || payload === null || !("world" in payload)) return null;
  return parseSnapshot(payload.world);
}
function reason(payload: unknown): string {
  return typeof payload === "object" && payload !== null && "reason" in payload && typeof payload.reason === "string" ? payload.reason : "command_rejected";
}
export class GameConnection implements GameClient {
  private channel: Channel | null = null;
  private ready = false;
  private started = false;
  private status: GameConnectionStatus | null = null;
  constructor(private readonly handlers: GameConnectionHandlers, private readonly socket: Socket = new Socket("/socket")) {}
  connect(): void {
    if (this.started) return;
    this.started = true; this.setStatus("connecting");
    this.socket.onClose(() => this.markOffline()); this.socket.onError(() => this.markOffline()); this.socket.connect();
    const channel = this.socket.channel("game:lobby", {}); this.channel = channel;
    channel.on("world_snapshot", (payload) => this.acceptSnapshot(payload));
    channel.onError(() => this.markOffline()); channel.onClose(() => this.markOffline());
    channel.join().receive("ok", (payload) => this.acceptSnapshot(payload))
      .receive("error", () => this.markOffline()).receive("timeout", () => this.markOffline());
  }
  command(command: GameCommand): void {
    if (!this.ready || !this.channel) { this.handlers.onCommand({ ok: false, reason: "offline" }); return; }
    this.channel.push("command", command).receive("ok", (payload) => {
      const world = readWorld(payload);
      if (!world) { this.ready = false; this.setStatus("incompatible"); this.handlers.onCommand({ ok: false, reason: "invalid_response" }); return; }
      this.handlers.onSnapshot(world); this.handlers.onCommand({ ok: true });
    }).receive("error", (payload) => this.handlers.onCommand({ ok: false, reason: reason(payload) }))
      .receive("timeout", () => this.handlers.onCommand({ ok: false, reason: "timeout" }));
  }
  disconnect(): void { this.ready = false; this.started = false; this.channel?.leave(); this.channel = null; this.socket.disconnect(); }
  private acceptSnapshot(payload: unknown): void {
    const world = readWorld(payload);
    if (!world) { this.ready = false; this.setStatus("incompatible"); return; }
    this.ready = true; this.handlers.onSnapshot(world); this.setStatus("connected");
  }
  private markOffline(): void { this.ready = false; this.setStatus("offline"); }
  private setStatus(status: GameConnectionStatus): void { if (this.status !== status) { this.status = status; this.handlers.onStatus(status); } }
}
