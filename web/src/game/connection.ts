import { Socket, type Channel } from "phoenix";
import { parseSnapshot, type GameCommand, type WorldSnapshot } from "./protocol";

export type GameConnectionStatus = "connecting" | "connected" | "local" | "offline" | "expired" | "incompatible";
export type CommandOutcome = { ok: true } | { ok: false; reason: string };
export interface GameConnectionHandlers {
  onSnapshot(snapshot: WorldSnapshot): void;
  onStatus(status: GameConnectionStatus): void;
  onCommand(outcome: CommandOutcome): void;
}
export interface GameClient { connect(): void; command(command: GameCommand): void; disconnect(): void }
interface GuestMatch { match_id: string; token: string }
const SESSION_KEY = "kc3rts-guest-match-v1";
function storedMatch(): string | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(SESSION_KEY); }
  catch { return null; }
}
function saveMatch(match: GuestMatch): void {
  try { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_KEY, JSON.stringify(match)); }
  catch { /* The match remains usable for this page load. */ }
}
function forgetMatch(): void {
  try { if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(SESSION_KEY); }
  catch { /* A blocked store cannot prevent a fresh match. */ }
}
async function guestMatch(): Promise<GuestMatch> {
  const saved = storedMatch();
  if (saved) {
    try {
      const parsed: unknown = JSON.parse(saved);
      if (validMatch(parsed)) return parsed;
    } catch { /* A damaged session starts a fresh match. */ }
  }
  const response = await fetch("/api/matches", { method: "POST", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 429 ? "match_limit" : "match_unavailable");
  const created: unknown = await response.json();
  if (!validMatch(created)) throw new Error("invalid_response");
  saveMatch(created);
  return created;
}
function validMatch(value: unknown): value is GuestMatch {
  return typeof value === "object" && value !== null && "match_id" in value && "token" in value &&
    typeof value.match_id === "string" && /^[A-Za-z0-9_-]{24}$/.test(value.match_id) &&
    typeof value.token === "string" && value.token.length > 20;
}
function readWorld(payload: unknown): { world: WorldSnapshot; revision: number } | null {
  if (typeof payload !== "object" || payload === null || !("world" in payload) || !("revision" in payload)) return null;
  if (!Number.isSafeInteger(payload.revision) || (payload.revision as number) < 0) return null;
  const world = parseSnapshot(payload.world);
  return world ? { world, revision: payload.revision as number } : null;
}
function reason(payload: unknown): string {
  return typeof payload === "object" && payload !== null && "reason" in payload && typeof payload.reason === "string" ? payload.reason : "command_rejected";
}
export class GameConnection implements GameClient {
  private readonly socket: Socket;
  private channel: Channel | null = null;
  private match: GuestMatch | null = null;
  private generation = 0;
  private revision = -1;
  private currentWorld: WorldSnapshot | null = null;
  private resyncing = false;
  private refreshAttempts = 0;
  private ready = false;
  private started = false;
  private status: GameConnectionStatus | null = null;
  constructor(private readonly handlers: GameConnectionHandlers, socket?: Socket, private readonly matchProvider: () => Promise<GuestMatch> = guestMatch) {
    this.socket = socket ?? new Socket("/socket", { params: () => ({ token: this.match?.token }) });
    this.socket.onClose(() => this.markOffline(this.channel));
    this.socket.onError(() => this.markOffline(this.channel));
  }
  connect(): void {
    if (this.started) return;
    this.started = true; this.setStatus("connecting");
    const generation = ++this.generation;
    void this.joinMatch(generation);
  }
  private async joinMatch(generation: number): Promise<void> {
    try {
      const match = await this.matchProvider();
      if (this.generation !== generation) return;
      if (this.match?.match_id !== match.match_id) { this.revision = -1; this.currentWorld = null; }
      this.match = match;
    }
    catch (error) {
      if (this.generation === generation) {
        this.setStatus("offline");
        if (error instanceof Error && error.message === "match_limit")
          this.handlers.onCommand({ ok: false, reason: "match_limit" });
      }
      return;
    }
    if (this.generation !== generation || !this.match) return;
    const channel = this.socket.channel(`game:${this.match.match_id}`, {}); this.channel = channel;
    this.socket.connect();
    channel.on("world_snapshot", (payload) => { this.acceptSnapshot(channel, payload); });
    channel.on("world_patch", (payload) => this.acceptPatch(channel, payload));
    channel.on("match_unavailable", () => {
      if (this.channel !== channel) return;
      forgetMatch();
      this.ready = false; this.setStatus("expired"); this.handlers.onCommand({ ok: false, reason: "match_unavailable" });
    });
    channel.onError(() => this.markOffline(channel)); channel.onClose(() => this.markOffline(channel));
    channel.join().receive("ok", (payload) => { this.refreshAttempts = 0; this.acceptSnapshot(channel, payload); })
      .receive("error", (payload) => {
        if (this.channel !== channel) return;
        if (["unauthorized", "game_unavailable"].includes(reason(payload)) && this.refreshAttempts < 1) {
          this.refreshAttempts += 1;
          forgetMatch();
          this.match = null; this.disconnect(); this.connect();
        } else this.markOffline(channel);
      }).receive("timeout", () => this.markOffline(channel));
  }
  command(command: GameCommand): void {
    if (!this.ready || !this.channel) { this.handlers.onCommand({ ok: false, reason: "offline" }); return; }
    const channel = this.channel;
    const commandId = crypto.randomUUID();
    channel.push("command", { ...command, command_id: commandId }, 30_000).receive("ok", (payload) => {
      if (this.channel !== channel) return;
      if (typeof payload !== "object" || payload === null || !("command_id" in payload) || payload.command_id !== commandId) {
        this.ready = false; this.setStatus("incompatible"); this.handlers.onCommand({ ok: false, reason: "invalid_response" }); return;
      }
      if (!this.acceptSnapshot(channel, payload)) { this.handlers.onCommand({ ok: false, reason: "invalid_response" }); return; }
      this.handlers.onCommand({ ok: true });
    }).receive("error", (payload) => { if (this.channel === channel) this.handlers.onCommand({ ok: false, reason: reason(payload) }); })
      .receive("timeout", () => { if (this.channel === channel) this.handlers.onCommand({ ok: false, reason: "timeout" }); });
  }
  disconnect(): void {
    const channel = this.channel;
    ++this.generation; this.ready = false; this.started = false; this.channel = null;
    this.resyncing = false;
    channel?.leave(); this.socket.disconnect(); this.setStatus("offline");
  }
  private acceptSnapshot(channel: Channel, payload: unknown): boolean {
    if (this.channel !== channel) return false;
    const state = readWorld(payload);
    if (!state) { this.ready = false; this.setStatus("incompatible"); return false; }
    if (state.revision < this.revision) return true;
    if (state.revision > this.revision) {
      this.revision = state.revision; this.currentWorld = state.world; this.handlers.onSnapshot(state.world);
    }
    this.ready = true; this.setStatus("connected"); return true;
  }
  private acceptPatch(channel: Channel, payload: unknown): void {
    if (this.channel !== channel || !this.currentWorld || typeof payload !== "object" || payload === null) return;
    if (!("protocol_version" in payload) || payload.protocol_version !== 3 ||
      !("ruleset_version" in payload) || payload.ruleset_version !== 2 ||
      !("base_revision" in payload) || !Number.isSafeInteger(payload.base_revision) ||
      !("revision" in payload) || !Number.isSafeInteger(payload.revision)) {
      this.ready = false; this.setStatus("incompatible"); return;
    }
    const base = payload.base_revision as number, revision = payload.revision as number;
    if (revision <= this.revision) return;
    if (base !== this.revision || revision <= base) { this.requestResync(channel); return; }
    const old = this.currentWorld;
    const resources = applyEntities(old.resources, "resources" in payload ? payload.resources : null);
    const buildings = applyEntities(old.buildings, "buildings" in payload ? payload.buildings : null);
    const villagers = applyEntities(old.villagers, "villagers" in payload ? payload.villagers : null);
    if (!resources || !buildings || !villagers || !("tick" in payload)) { this.requestResync(channel); return; }
    const candidate = parseSnapshot({ ...old, tick: payload.tick,
      stockpile: "stockpile" in payload && payload.stockpile !== null ? payload.stockpile : old.stockpile,
      outcome: "outcome" in payload && payload.outcome !== null ? payload.outcome : old.outcome,
      resources, buildings, villagers });
    if (!candidate) { this.requestResync(channel); return; }
    this.revision = revision; this.currentWorld = candidate; this.handlers.onSnapshot(candidate);
  }
  private requestResync(channel: Channel): void {
    if (this.resyncing || this.channel !== channel) return;
    this.resyncing = true;
    channel.push("request_snapshot", {}, 10_000).receive("ok", (payload) => {
      if (this.channel !== channel) return;
      this.resyncing = false; this.acceptSnapshot(channel, payload);
    }).receive("error", () => { if (this.channel === channel) { this.resyncing = false; this.markOffline(channel); } })
      .receive("timeout", () => { if (this.channel === channel) { this.resyncing = false; this.markOffline(channel); } });
  }
  private markOffline(channel: Channel | null): void {
    if (!channel || this.channel !== channel) return;
    this.ready = false; this.setStatus("offline");
  }
  private setStatus(status: GameConnectionStatus): void { if (this.status !== status) { this.status = status; this.handlers.onStatus(status); } }
}
function applyEntities<T extends { id: number }>(previous: T[], delta: unknown): T[] | null {
  if (typeof delta !== "object" || delta === null || !("upsert" in delta) || !("remove" in delta) ||
    !Array.isArray(delta.upsert) || !Array.isArray(delta.remove)) return null;
  if (!delta.remove.every((id: unknown) => Number.isSafeInteger(id) && (id as number) > 0) ||
    !delta.upsert.every((item: unknown) => typeof item === "object" && item !== null && "id" in item && Number.isSafeInteger(item.id))) return null;
  const removed = new Set<number>(delta.remove);
  const updates = new Map<number, T>(delta.upsert.map((item: T) => [item.id, item]));
  const result = previous.filter((item) => !removed.has(item.id)).map((item) => updates.get(item.id) ?? item);
  const existing = new Set(previous.map((item) => item.id));
  for (const item of updates.values()) if (!existing.has(item.id)) result.push(item);
  return result;
}
