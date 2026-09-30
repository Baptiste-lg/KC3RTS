import type { Socket } from "phoenix";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameConnection } from "./connection";
import { createLocalWorld } from "./local_world";
const match = { match_id: "123456789012345678901234", token: "test-token-12345678901234567890" };
const provideMatch = async () => match;
const ready = () => Promise.resolve();
const state = (world: ReturnType<typeof createLocalWorld>, revision: number) => ({ world, revision });
class FakePush {
  handlers = new Map<string, (payload: unknown) => void>();
  receive(status: string, handler: (payload: unknown) => void): this { this.handlers.set(status, handler); return this; }
  resolve(status: string, payload: unknown): void { this.handlers.get(status)?.(payload); }
}
class FakeChannel {
  joinPush = new FakePush(); commandPush = new FakePush(); snapshotPush = new FakePush(); events = new Map<string, (payload: unknown) => void>();
  lastEvent = ""; lastPayload: unknown; onErrorHandler: (() => void) | null = null; onCloseHandler: (() => void) | null = null; leaves = 0;
  on(event: string, handler: (payload: unknown) => void): void { this.events.set(event, handler); }
  onError(handler: () => void): void { this.onErrorHandler = handler; }
  onClose(handler: () => void): void { this.onCloseHandler = handler; }
  join(): FakePush { return this.joinPush; } leave(): void { this.leaves += 1; }
  push(event: string, payload: unknown): FakePush { this.lastEvent = event; this.lastPayload = payload; return event === "request_snapshot" ? this.snapshotPush : this.commandPush; }
  emit(event: string, payload: unknown): void { this.events.get(event)?.(payload); }
}
class FakeSocket {
  gameChannel = new FakeChannel(); connected = false; channels = 0;
  topic = "";
  onCloseHandlers: (() => void)[] = []; onErrorHandlers: (() => void)[] = [];
  onClose(handler: () => void): void { this.onCloseHandlers.push(handler); }
  onError(handler: () => void): void { this.onErrorHandlers.push(handler); }
  disconnect(): void { this.connected = false; } connect(): void { this.connected = true; }
  channel(topic: string): FakeChannel { this.topic = topic; this.channels += 1; return this.channels === 1 ? this.gameChannel : this.gameChannel = new FakeChannel(); }
}
describe("GameConnection", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("joins, validates snapshots and sends RTS commands", async () => {
    const socket = new FakeSocket(); const snapshots: number[] = []; const outcomes: boolean[] = [];
    const connection = new GameConnection({ onSnapshot: (s) => snapshots.push(s.tick), onStatus: () => undefined, onCommand: (o) => outcomes.push(o.ok) }, socket as unknown as Socket, provideMatch);
    connection.connect(); await ready(); expect(socket.connected).toBe(true);
    expect(socket.topic).toBe(`game:${match.match_id}`);
    const world = createLocalWorld(); socket.gameChannel.joinPush.resolve("ok", state(world, 0));
    socket.gameChannel.emit("world_snapshot", state({ ...world, tick: 1 }, 1)); expect(snapshots).toEqual([0, 1]);
    const command = { type: "spawn_villager" as const, building_id: 1 }; connection.command(command);
    expect(socket.gameChannel.lastEvent).toBe("command");
    expect(socket.gameChannel.lastPayload).toMatchObject(command);
    const commandId = (socket.gameChannel.lastPayload as { command_id: string }).command_id;
    socket.gameChannel.commandPush.resolve("ok", { ...state({ ...world, tick: 2 }, 2), command_id: commandId }); expect(outcomes).toEqual([true]);
  });
  it("reports offline, rejected and incompatible states without accepting a bad snapshot", async () => {
    const socket = new FakeSocket(); const statuses: string[] = []; const snapshots: number[] = []; const outcomes: unknown[] = [];
    const connection = new GameConnection({ onSnapshot: (world) => snapshots.push(world.tick), onStatus: (status) => statuses.push(status), onCommand: (outcome) => outcomes.push(outcome) }, socket as unknown as Socket, provideMatch);
    connection.command({ type: "spawn_villager", building_id: 1 });
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "offline" });
    connection.connect(); connection.connect(); await ready();
    expect(socket.channels).toBe(1);
    socket.gameChannel.joinPush.resolve("ok", { world: { protocol_version: 999 }, revision: 0 });
    expect(statuses).toEqual(["connecting", "incompatible"]);
    expect(snapshots).toEqual([]);

    const world = createLocalWorld();
    socket.gameChannel.emit("world_snapshot", state(world, 0));
    expect(statuses.at(-1)).toBe("connected");
    connection.command({ type: "spawn_villager", building_id: 1 });
    socket.gameChannel.commandPush.resolve("error", { reason: "insufficient_resources" });
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "insufficient_resources" });
    socket.gameChannel.commandPush.resolve("error", {});
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "command_rejected" });
    socket.gameChannel.commandPush.resolve("timeout", {});
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "timeout" });
    socket.gameChannel.commandPush.resolve("ok", { world: null, revision: 1, command_id: (socket.gameChannel.lastPayload as { command_id: string }).command_id });
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "invalid_response" });
    expect(statuses.at(-1)).toBe("incompatible");

    socket.gameChannel.emit("world_snapshot", state(world, 1));
    socket.gameChannel.onErrorHandler?.();
    expect(statuses.at(-1)).toBe("offline");
    connection.command({ type: "spawn_villager", building_id: 1 });
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "offline" });
    connection.disconnect();
    expect(socket.gameChannel.leaves).toBe(1);
    expect(socket.connected).toBe(false);
  });
  it("marks failed joins and socket closes offline", async () => {
    const socket = new FakeSocket(); const statuses: string[] = [];
    const connection = new GameConnection({ onSnapshot: () => undefined, onStatus: (status) => statuses.push(status), onCommand: () => undefined }, socket as unknown as Socket, provideMatch);
    connection.connect(); await ready();
    socket.gameChannel.joinPush.resolve("timeout", {});
    expect(statuses.at(-1)).toBe("offline");
    socket.gameChannel.emit("world_snapshot", state(createLocalWorld(), 0));
    socket.onCloseHandlers.forEach((handler) => handler());
    expect(statuses.at(-1)).toBe("offline");
    expect(statuses.filter((status) => status === "offline")).toHaveLength(2);
  });
  it("ignores responses and events from a disconnected channel after reconnecting", async () => {
    const socket = new FakeSocket(); const statuses: string[] = []; const snapshots: number[] = []; const outcomes: unknown[] = [];
    const connection = new GameConnection({ onSnapshot: (world) => snapshots.push(world.tick), onStatus: (status) => statuses.push(status), onCommand: (outcome) => outcomes.push(outcome) }, socket as unknown as Socket, provideMatch);
    const world = createLocalWorld();
    connection.connect(); await ready();
    const oldChannel = socket.gameChannel;
    oldChannel.joinPush.resolve("ok", state(world, 0));
    connection.command({ type: "spawn_villager", building_id: 1 });
    connection.disconnect();
    expect(statuses.at(-1)).toBe("offline");
    connection.connect(); await ready();
    const currentChannel = socket.gameChannel;
    currentChannel.joinPush.resolve("ok", state({ ...world, tick: 2 }, 2));
    oldChannel.emit("world_snapshot", state({ ...world, tick: 99 }, 99));
    oldChannel.joinPush.resolve("timeout", {});
    oldChannel.commandPush.resolve("ok", state({ ...world, tick: 100 }, 100));
    oldChannel.commandPush.resolve("error", { reason: "stale" });
    oldChannel.onCloseHandler?.();
    expect(socket.onCloseHandlers).toHaveLength(1);
    expect(socket.onErrorHandlers).toHaveLength(1);
    expect(snapshots).toEqual([0, 2]);
    expect(outcomes).toEqual([]);
    expect(statuses.at(-1)).toBe("connected");
    connection.command({ type: "spawn_villager", building_id: 1 });
    currentChannel.commandPush.resolve("ok", { ...state({ ...world, tick: 3 }, 3), command_id: (currentChannel.lastPayload as { command_id: string }).command_id });
    expect(snapshots).toEqual([0, 2, 3]);
    expect(outcomes).toEqual([{ ok: true }]);
  });
  it("ignores stale snapshots and accepts one newer revision", async () => {
    const socket = new FakeSocket(); const snapshots: number[] = [];
    const connection = new GameConnection({ onSnapshot: (world) => snapshots.push(world.tick), onStatus: () => undefined, onCommand: () => undefined }, socket as unknown as Socket, provideMatch);
    connection.connect(); await ready();
    const world = createLocalWorld();
    socket.gameChannel.joinPush.resolve("ok", state(world, 10));
    socket.gameChannel.emit("world_snapshot", state({ ...world, tick: 1 }, 9));
    socket.gameChannel.emit("world_snapshot", state({ ...world, tick: 2 }, 10));
    socket.gameChannel.emit("world_snapshot", state({ ...world, tick: 3 }, 11));
    expect(snapshots).toEqual([0, 3]);
  });
  it("applies compact patches and requests a full snapshot after a gap", async () => {
    const socket = new FakeSocket(); const snapshots: number[] = [];
    const connection = new GameConnection({ onSnapshot: (world) => snapshots.push(world.tick), onStatus: () => undefined, onCommand: () => undefined }, socket as unknown as Socket, provideMatch);
    connection.connect(); await ready();
    const world = createLocalWorld();
    socket.gameChannel.joinPush.resolve("ok", state(world, 0));
    const empty = { upsert: [], remove: [] };
    socket.gameChannel.emit("world_patch", { protocol_version: 3, base_revision: 0, revision: 1, tick: 1,
      stockpile: { ...world.stockpile, wood: 29 }, outcome: null, resources: empty, buildings: empty,
      villagers: { upsert: [{ ...world.villagers[0], x: world.villagers[0].x + 0.5 }], remove: [] } });
    expect(snapshots).toEqual([0, 1]);
    socket.gameChannel.emit("world_patch", { protocol_version: 3, base_revision: 2, revision: 3, tick: 3,
      stockpile: null, outcome: null, resources: empty, buildings: empty, villagers: empty });
    expect(socket.gameChannel.lastEvent).toBe("request_snapshot");
    socket.gameChannel.snapshotPush.resolve("ok", state({ ...world, tick: 3 }, 3));
    expect(snapshots).toEqual([0, 1, 3]);
  });
  it("rejects a mismatched command acknowledgement", async () => {
    const socket = new FakeSocket(); const statuses: string[] = []; const outcomes: unknown[] = [];
    const connection = new GameConnection({ onSnapshot: () => undefined, onStatus: (status) => statuses.push(status), onCommand: (outcome) => outcomes.push(outcome) }, socket as unknown as Socket, provideMatch);
    connection.connect(); await ready();
    socket.gameChannel.joinPush.resolve("ok", state(createLocalWorld(), 0));
    connection.command({ type: "spawn_villager", building_id: 1 });
    socket.gameChannel.commandPush.resolve("ok", { ...state(createLocalWorld(), 1), command_id: "another-command" });
    expect(statuses.at(-1)).toBe("incompatible");
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "invalid_response" });
  });
  it("resyncs an invalid patch and reports an unavailable match", async () => {
    const socket = new FakeSocket(); const statuses: string[] = []; const outcomes: unknown[] = [];
    const connection = new GameConnection({ onSnapshot: () => undefined, onStatus: (status) => statuses.push(status), onCommand: (outcome) => outcomes.push(outcome) }, socket as unknown as Socket, provideMatch);
    connection.connect(); await ready();
    socket.gameChannel.joinPush.resolve("ok", state(createLocalWorld(), 0));
    socket.gameChannel.emit("world_patch", { protocol_version: 3, base_revision: 0, revision: 1, tick: 1 });
    expect(socket.gameChannel.lastEvent).toBe("request_snapshot");
    socket.gameChannel.snapshotPush.resolve("error", { reason: "unauthorized" });
    expect(statuses.at(-1)).toBe("offline");
    socket.gameChannel.emit("match_unavailable", {});
    expect(statuses.at(-1)).toBe("expired");
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "match_unavailable" });
  });
  it("retries one expired guest capability with a new match", async () => {
    const socket = new FakeSocket();
    const newer = { ...match, match_id: "abcdefghijklmnopqrstuvwx" };
    const provide = vi.fn().mockResolvedValueOnce(match).mockResolvedValueOnce(newer);
    const connection = new GameConnection({ onSnapshot: () => undefined, onStatus: () => undefined, onCommand: () => undefined }, socket as unknown as Socket, provide);
    connection.connect(); await ready();
    const oldChannel = socket.gameChannel;
    oldChannel.joinPush.resolve("error", { reason: "unauthorized" });
    await ready();
    expect(provide).toHaveBeenCalledTimes(2);
    expect(socket.topic).toBe(`game:${newer.match_id}`);
    expect(oldChannel.leaves).toBe(1);
  });
  it("drops a late match creation after disconnecting", async () => {
    const socket = new FakeSocket();
    let resolve!: (value: typeof match) => void;
    const pending = new Promise<typeof match>((done) => { resolve = done; });
    const connection = new GameConnection({ onSnapshot: () => undefined, onStatus: () => undefined, onCommand: () => undefined }, socket as unknown as Socket, () => pending);
    connection.connect(); connection.disconnect(); resolve(match); await ready();
    expect(socket.channels).toBe(0);
    expect(socket.connected).toBe(false);
  });
  it("creates one guest match and reuses it within the browser tab", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => match });
    vi.stubGlobal("fetch", fetcher);
    const first = new FakeSocket();
    new GameConnection({ onSnapshot: () => undefined, onStatus: () => undefined, onCommand: () => undefined }, first as unknown as Socket).connect();
    await vi.waitFor(() => expect(first.channels).toBe(1));
    const second = new FakeSocket();
    new GameConnection({ onSnapshot: () => undefined, onStatus: () => undefined, onCommand: () => undefined }, second as unknown as Socket).connect();
    await vi.waitFor(() => expect(second.channels).toBe(1));
    expect(first.topic).toBe(`game:${match.match_id}`);
    expect(second.topic).toBe(first.topic);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports a full guest-match pool before opening a socket", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const socket = new FakeSocket(); const statuses: string[] = []; const outcomes: unknown[] = [];
    const connection = new GameConnection({ onSnapshot: () => undefined, onStatus: (status) => statuses.push(status), onCommand: (outcome) => outcomes.push(outcome) }, socket as unknown as Socket);
    connection.connect();
    await vi.waitFor(() => expect(outcomes).toContainEqual({ ok: false, reason: "match_limit" }));
    expect(statuses.at(-1)).toBe("offline");
    expect(socket.channels).toBe(0);
  });
});
