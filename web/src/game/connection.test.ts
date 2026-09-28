import type { Socket } from "phoenix";
import { describe, expect, it } from "vitest";
import { GameConnection } from "./connection";

const world = {
  protocol_version: 1,
  tick: 0,
  map_radius: 32,
  town_center: { x: 0, z: 0 },
  stockpile: 20,
  resources: [],
  villagers: [],
};

class FakePush {
  private readonly handlers = new Map<string, (payload: unknown) => void>();

  receive(status: string, handler: (payload: unknown) => void): this {
    this.handlers.set(status, handler);
    return this;
  }

  resolve(status: string, payload: unknown): void {
    this.handlers.get(status)?.(payload);
  }
}

class FakeChannel {
  readonly joinPush = new FakePush();
  readonly commandPush = new FakePush();
  readonly events = new Map<string, (payload: unknown) => void>();
  lastCommand = "";

  on(event: string, handler: (payload: unknown) => void): void {
    this.events.set(event, handler);
  }

  onError(): void {}
  onClose(): void {}
  join(): FakePush { return this.joinPush; }
  leave(): void {}

  push(event: string): FakePush {
    this.lastCommand = event;
    return this.commandPush;
  }

  emit(event: string, payload: unknown): void {
    this.events.get(event)?.(payload);
  }
}

class FakeSocket {
  readonly gameChannel = new FakeChannel();
  topic = "";
  connected = false;

  onClose(): void {}
  onError(): void {}
  disconnect(): void { this.connected = false; }
  connect(): void { this.connected = true; }

  channel(topic: string): FakeChannel {
    this.topic = topic;
    return this.gameChannel;
  }
}

describe("GameConnection", () => {
  it("joins the lobby, accepts live snapshots and recruits through the channel", () => {
    const socket = new FakeSocket();
    const snapshots: number[] = [];
    const statuses: string[] = [];
    const outcomes: boolean[] = [];
    const connection = new GameConnection({
      onSnapshot: (snapshot) => snapshots.push(snapshot.tick),
      onStatus: (status) => statuses.push(status),
      onRecruitment: (outcome) => outcomes.push(outcome.ok),
    }, socket as unknown as Socket);

    connection.connect();
    expect(socket.connected).toBe(true);
    expect(socket.topic).toBe("game:lobby");

    socket.gameChannel.joinPush.resolve("ok", { world });
    socket.gameChannel.emit("world_snapshot", { world: { ...world, tick: 1 } });
    socket.gameChannel.emit("world_snapshot", { world: { ...world, protocol_version: 99 } });
    expect(snapshots).toEqual([0, 1]);
    expect(statuses).toContain("connected");
    expect(statuses.at(-1)).toBe("incompatible");

    socket.gameChannel.emit("world_snapshot", { world: { ...world, tick: 2 } });
    expect(snapshots).toEqual([0, 1, 2]);
    expect(statuses.at(-1)).toBe("connected");

    connection.spawnVillager();
    expect(socket.gameChannel.lastCommand).toBe("spawn_villager");
    socket.gameChannel.commandPush.resolve("ok", { world: { ...world, stockpile: 15 } });
    expect(outcomes).toEqual([true]);
  });

  it("reports rejected recruitment without inventing resources", () => {
    const socket = new FakeSocket();
    const outcomes: { ok: boolean; reason?: string }[] = [];
    const connection = new GameConnection({
      onSnapshot: () => undefined,
      onStatus: () => undefined,
      onRecruitment: (outcome) => outcomes.push(outcome),
    }, socket as unknown as Socket);

    connection.connect();
    socket.gameChannel.joinPush.resolve("ok", { world });
    connection.spawnVillager();
    socket.gameChannel.commandPush.resolve("error", { reason: "insufficient_resources" });

    expect(outcomes).toEqual([{ ok: false, reason: "insufficient_resources" }]);
  });
});
