import { describe, expect, it } from "vitest";
import { generateMap, RESOURCE_COUNTS } from "./map_generation";

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe("map generation", () => {
  it("places reliable forests and sparse, durable ore across many seeds", () => {
    for (let seed = 1; seed <= 80; seed += 1) {
      const map = generateMap(seed);
      expect(generateMap(seed)).toEqual(map);
      for (const kind of ["wood", "stone", "gold"] as const) {
        expect(map.resources.filter((r) => r.kind === kind)).toHaveLength(RESOURCE_COUNTS[kind]);
      }
      expect(map.resources.filter((r) => r.kind === "wood" && distance(r, { x: 13, z: 13 }) < 8).length).toBeGreaterThanOrEqual(8);
      expect(map.resources.every((r) => Math.abs(r.x) <= 48 && Math.abs(r.z) <= 48 && distance(r, { x: 0, z: 0 }) >= 9)).toBe(true);
      expect(distance(map.enemy, { x: 0, z: 0 })).toBeGreaterThanOrEqual(34);
    }
  });
});
