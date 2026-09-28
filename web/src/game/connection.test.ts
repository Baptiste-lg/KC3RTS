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
  lastEvent = ""; lastPayload: unknown;
  on(event: string, handler: (payload: unknown) => void): void { this.events.set(event, handler); }
  onError(): void {} onClose(): void {} join(): FakePush { return this.joinPush; } leave(): void {}
  push(event: string, payload: unknown): FakePush { this.lastEvent = event; this.lastPayload = payload; return this.commandPush; }
  emit(event: string, payload: unknown): void { this.events.get(event)?.(payload); }
}
class FakeSocket {
  gameChannel = new FakeChannel(); connected = false;
  onClose(): void {} onError(): void {} disconnect(): void { this.connected = false; } connect(): void { this.connected = true; }
  channel(): FakeChannel { return this.gameChannel; }
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
});
