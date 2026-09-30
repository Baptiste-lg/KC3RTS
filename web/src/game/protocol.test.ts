import { describe, expect, it } from "vitest";
import { parseSnapshot } from "./protocol";
import { createLocalWorld } from "./local_world";

describe("parseSnapshot", () => {
  it("accepts a complete versioned RTS snapshot", () => {
    const snapshot = createLocalWorld();
    expect(parseSnapshot(snapshot)).toEqual(snapshot);
  });
  it("rejects malformed health, resource types and protocol versions", () => {
    const world = createLocalWorld();
    expect(parseSnapshot({ ...world, protocol_version: 1 })).toBeNull();
    expect(parseSnapshot({ ...world, ruleset_version: 1 })).toBeNull();
    expect(parseSnapshot({ ...world, buildings: [{ ...world.buildings[0], hp: 9999 }] })).toBeNull();
    expect(parseSnapshot({ ...world, resources: [{ ...world.resources[0], kind: "crystal" }] })).toBeNull();
    expect(parseSnapshot({ ...world, villagers: [{ ...world.villagers[0], attack_interval_ticks: 0 }] })).toBeNull();
  });
  it("rejects duplicate IDs and orders pointing outside their entity type", () => {
    const world = createLocalWorld();
    expect(parseSnapshot({ ...world, villagers: [world.villagers[0], world.villagers[0]] })).toBeNull();
    expect(parseSnapshot({ ...world, resources: [world.resources[0], world.resources[0]] })).toBeNull();
    expect(parseSnapshot({ ...world, buildings: [world.buildings[0], world.buildings[0]] })).toBeNull();
    expect(parseSnapshot({ ...world, villagers: [{ ...world.villagers[0], order: { kind: "gather", id: 9999 } }] })).toBeNull();
    expect(parseSnapshot({ ...world, villagers: [{ ...world.villagers[0], order: { kind: "attack", id: 1 } }] })).toBeNull();
  });
});
