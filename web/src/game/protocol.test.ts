import { describe, expect, it } from "vitest";
import { parseSnapshot } from "./protocol";

const world = {
  protocol_version: 1,
  tick: 0,
  map_radius: 32,
  town_center: { x: 0, z: 0 },
  stockpile: 20,
  resources: [{ id: 1, x: 8, z: 3, amount: 10, initial_amount: 10 }],
  villagers: [{ id: 1, x: 0, z: 0, cargo: 0, target: { kind: "resource", id: 1 } }],
};

describe("parseSnapshot", () => {
  it("accepts a complete versioned world snapshot", () => {
    expect(parseSnapshot(world)).toEqual(world);
  });

  it("rejects incompatible and malformed server data", () => {
    expect(parseSnapshot({ ...world, protocol_version: 2 })).toBeNull();
    expect(parseSnapshot({ ...world, resources: [{ ...world.resources[0], x: Infinity }] })).toBeNull();
    expect(parseSnapshot({ ...world, villagers: [{ ...world.villagers[0], target: ["resource", 1] }] })).toBeNull();
  });
});
