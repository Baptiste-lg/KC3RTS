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
    expect(parseSnapshot({ ...world, buildings: [{ ...world.buildings[0], hp: 9999 }] })).toBeNull();
    expect(parseSnapshot({ ...world, resources: [{ ...world.resources[0], kind: "crystal" }] })).toBeNull();
  });
});
