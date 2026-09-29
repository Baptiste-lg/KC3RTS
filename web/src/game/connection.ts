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
  constructor(private readonly handlers: GameConnectionHandlers, private readonly socket: Socket = new Socket("/socket")) {
    this.socket.onClose(() => this.markOffline(this.channel));
    this.socket.onError(() => this.markOffline(this.channel));
  }
  connect(): void {
    if (this.started) return;
    this.started = true; this.setStatus("connecting");
    const channel = this.socket.channel("game:lobby", {}); this.channel = channel;
    this.socket.connect();
    channel.on("world_snapshot", (payload) => this.acceptSnapshot(channel, payload));
    channel.onError(() => this.markOffline(channel)); channel.onClose(() => this.markOffline(channel));
    channel.join().receive("ok", (payload) => this.acceptSnapshot(channel, payload))
      .receive("error", () => this.markOffline(channel)).receive("timeout", () => this.markOffline(channel));
  }
  command(command: GameCommand): void {
    if (!this.ready || !this.channel) { this.handlers.onCommand({ ok: false, reason: "offline" }); return; }
    const channel = this.channel;
    channel.push("command", command, 30_000).receive("ok", (payload) => {
      if (this.channel !== channel) return;
      const world = readWorld(payload);
      if (!world) { this.ready = false; this.setStatus("incompatible"); this.handlers.onCommand({ ok: false, reason: "invalid_response" }); return; }
      this.handlers.onSnapshot(world); this.handlers.onCommand({ ok: true });
    }).receive("error", (payload) => { if (this.channel === channel) this.handlers.onCommand({ ok: false, reason: reason(payload) }); })
      .receive("timeout", () => { if (this.channel === channel) this.handlers.onCommand({ ok: false, reason: "timeout" }); });
  }
  disconnect(): void {
    const channel = this.channel;
    this.ready = false; this.started = false; this.channel = null;
    channel?.leave(); this.socket.disconnect(); this.setStatus("offline");
  }
  private acceptSnapshot(channel: Channel, payload: unknown): void {
    if (this.channel !== channel) return;
    const world = readWorld(payload);
    if (!world) { this.ready = false; this.setStatus("incompatible"); return; }
    this.ready = true; this.handlers.onSnapshot(world); this.setStatus("connected");
  }
  private markOffline(channel: Channel | null): void {
    if (!channel || this.channel !== channel) return;
    this.ready = false; this.setStatus("offline");
  }
  private setStatus(status: GameConnectionStatus): void { if (this.status !== status) { this.status = status; this.handlers.onStatus(status); } }
}
