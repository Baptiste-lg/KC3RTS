import type { Socket } from "phoenix";
import { describe, expect, it } from "vitest";
import { GameConnection } from "./connection";
import { createLocalWorld } from "./local_world";
class FakePush {
  handlers = new Map<string, (payload: unknown) => void>();
  receive(status: string, handler: (payload: unknown) => void): this { this.handlers.set(status, handler); return this; }
  resolve(status: string, payload: unknown): void { this.handlers.get(status)?.(payload); }
}
class FakeChannel {
  joinPush = new FakePush(); commandPush = new FakePush(); events = new Map<string, (payload: unknown) => void>();
  lastEvent = ""; lastPayload: unknown; onErrorHandler: (() => void) | null = null; onCloseHandler: (() => void) | null = null; leaves = 0;
  on(event: string, handler: (payload: unknown) => void): void { this.events.set(event, handler); }
  onError(handler: () => void): void { this.onErrorHandler = handler; }
  onClose(handler: () => void): void { this.onCloseHandler = handler; }
  join(): FakePush { return this.joinPush; } leave(): void { this.leaves += 1; }
  push(event: string, payload: unknown): FakePush { this.lastEvent = event; this.lastPayload = payload; return this.commandPush; }
  emit(event: string, payload: unknown): void { this.events.get(event)?.(payload); }
}
class FakeSocket {
  gameChannel = new FakeChannel(); connected = false; channels = 0;
  onCloseHandlers: (() => void)[] = []; onErrorHandlers: (() => void)[] = [];
  onClose(handler: () => void): void { this.onCloseHandlers.push(handler); }
  onError(handler: () => void): void { this.onErrorHandlers.push(handler); }
  disconnect(): void { this.connected = false; } connect(): void { this.connected = true; }
  channel(): FakeChannel { this.channels += 1; return this.channels === 1 ? this.gameChannel : this.gameChannel = new FakeChannel(); }
}
describe("GameConnection", () => {
  it("joins, validates snapshots and sends RTS commands", () => {
    const socket = new FakeSocket(); const snapshots: number[] = []; const outcomes: boolean[] = [];
    const connection = new GameConnection({ onSnapshot: (s) => snapshots.push(s.tick), onStatus: () => undefined, onCommand: (o) => outcomes.push(o.ok) }, socket as unknown as Socket);
    connection.connect(); expect(socket.connected).toBe(true);
    const world = createLocalWorld(); socket.gameChannel.joinPush.resolve("ok", { world });
    socket.gameChannel.emit("world_snapshot", { world: { ...world, tick: 1 } }); expect(snapshots).toEqual([0, 1]);
    const command = { type: "spawn_villager" as const, building_id: 1 }; connection.command(command);
    expect(socket.gameChannel.lastEvent).toBe("command"); expect(socket.gameChannel.lastPayload).toEqual(command);
    socket.gameChannel.commandPush.resolve("ok", { world: { ...world, tick: 2 } }); expect(outcomes).toEqual([true]);
  });
  it("reports offline, rejected and incompatible states without accepting a bad snapshot", () => {
    const socket = new FakeSocket(); const statuses: string[] = []; const snapshots: number[] = []; const outcomes: unknown[] = [];
    const connection = new GameConnection({ onSnapshot: (world) => snapshots.push(world.tick), onStatus: (status) => statuses.push(status), onCommand: (outcome) => outcomes.push(outcome) }, socket as unknown as Socket);
    connection.command({ type: "spawn_villager", building_id: 1 });
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "offline" });
    connection.connect(); connection.connect();
    expect(socket.channels).toBe(1);
    socket.gameChannel.joinPush.resolve("ok", { world: { protocol_version: 999 } });
    expect(statuses).toEqual(["connecting", "incompatible"]);
    expect(snapshots).toEqual([]);

    const world = createLocalWorld();
    socket.gameChannel.emit("world_snapshot", { world });
    expect(statuses.at(-1)).toBe("connected");
    connection.command({ type: "spawn_villager", building_id: 1 });
    socket.gameChannel.commandPush.resolve("error", { reason: "insufficient_resources" });
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "insufficient_resources" });
    socket.gameChannel.commandPush.resolve("error", {});
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "command_rejected" });
    socket.gameChannel.commandPush.resolve("timeout", {});
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "timeout" });
    socket.gameChannel.commandPush.resolve("ok", { world: null });
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "invalid_response" });
    expect(statuses.at(-1)).toBe("incompatible");

    socket.gameChannel.emit("world_snapshot", { world });
    socket.gameChannel.onErrorHandler?.();
    expect(statuses.at(-1)).toBe("offline");
    connection.command({ type: "spawn_villager", building_id: 1 });
    expect(outcomes.at(-1)).toEqual({ ok: false, reason: "offline" });
    connection.disconnect();
    expect(socket.gameChannel.leaves).toBe(1);
    expect(socket.connected).toBe(false);
  });
  it("marks failed joins and socket closes offline", () => {
    const socket = new FakeSocket(); const statuses: string[] = [];
    const connection = new GameConnection({ onSnapshot: () => undefined, onStatus: (status) => statuses.push(status), onCommand: () => undefined }, socket as unknown as Socket);
    connection.connect();
    socket.gameChannel.joinPush.resolve("timeout", {});
    expect(statuses.at(-1)).toBe("offline");
    socket.gameChannel.emit("world_snapshot", { world: createLocalWorld() });
    socket.onCloseHandlers.forEach((handler) => handler());
    expect(statuses.at(-1)).toBe("offline");
    expect(statuses.filter((status) => status === "offline")).toHaveLength(2);
  });
  it("ignores responses and events from a disconnected channel after reconnecting", () => {
    const socket = new FakeSocket(); const statuses: string[] = []; const snapshots: number[] = []; const outcomes: unknown[] = [];
    const connection = new GameConnection({ onSnapshot: (world) => snapshots.push(world.tick), onStatus: (status) => statuses.push(status), onCommand: (outcome) => outcomes.push(outcome) }, socket as unknown as Socket);
    const world = createLocalWorld();
    connection.connect();
    const oldChannel = socket.gameChannel;
    oldChannel.joinPush.resolve("ok", { world });
    connection.command({ type: "spawn_villager", building_id: 1 });
    connection.disconnect();
    expect(statuses.at(-1)).toBe("offline");
    connection.connect();
    const currentChannel = socket.gameChannel;
    currentChannel.joinPush.resolve("ok", { world: { ...world, tick: 2 } });
    oldChannel.emit("world_snapshot", { world: { ...world, tick: 99 } });
    oldChannel.joinPush.resolve("timeout", {});
    oldChannel.commandPush.resolve("ok", { world: { ...world, tick: 100 } });
    oldChannel.commandPush.resolve("error", { reason: "stale" });
    oldChannel.onCloseHandler?.();
    expect(socket.onCloseHandlers).toHaveLength(1);
    expect(socket.onErrorHandlers).toHaveLength(1);
    expect(snapshots).toEqual([0, 2]);
    expect(outcomes).toEqual([]);
    expect(statuses.at(-1)).toBe("connected");
    connection.command({ type: "spawn_villager", building_id: 1 });
    currentChannel.commandPush.resolve("ok", { world: { ...world, tick: 3 } });
    expect(snapshots).toEqual([0, 2, 3]);
    expect(outcomes).toEqual([{ ok: true }]);
  });
});
