import { describe, expect, it } from "vitest";
import { createLocalWorld, recruitLocalVillager, stepLocalWorld } from "./local_world";

describe("local world", () => {
  it("places seeded resources deterministically across the map", () => {
    const first = createLocalWorld(12_345);
    expect(createLocalWorld(12_345)).toEqual(first);
    expect(createLocalWorld(7).resources).not.toEqual(first.resources);
    expect(first.resources).toHaveLength(24);
    expect(first.resources.slice(0, 5).map(({ x, z }) => [x, z])).toEqual([
      [-12.9, 13.1], [11.5, 25.6], [-5, 12.8], [-7.2, -5], [4.4, 9.4],
    ]);
    expect(first.stockpile).toBe(20);
    expect(first.resources.every((node) =>
      Math.abs(node.x) < first.map_radius && Math.abs(node.z) < first.map_radius &&
      Math.hypot(node.x, node.z) >= 8
    )).toBe(true);
    expect(first.resources.every((node, index) => first.resources.slice(index + 1).every((other) =>
      Math.hypot(node.x - other.x, node.z - other.z) >= 3
    ))).toBe(true);
  });

  it("recruits villagers for five resources and refuses an empty stockpile", () => {
    let world = createLocalWorld();
    for (let id = 1; id <= 4; id += 1) {
      const result = recruitLocalVillager(world);
      expect(result.ok).toBe(true);
      if (result.ok) {
        world = result.world;
        expect(world.villagers.at(-1)?.id).toBe(id);
      }
    }
    expect(world.stockpile).toBe(0);
    expect(recruitLocalVillager(world)).toEqual({ ok: false, reason: "insufficient_resources" });
  });

  it("gathers and delivers cargo while keeping previous snapshots immutable", () => {
    const initial = createLocalWorld();
    const recruited = recruitLocalVillager(initial);
    expect(recruited.ok).toBe(true);
    if (!recruited.ok) return;

    const later = stepLocalWorld(recruited.world, 700);
    expect(later.tick).toBe(700);
    expect(later.stockpile).toBeGreaterThan(recruited.world.stockpile);
    expect(later.resources.reduce((sum, node) => sum + node.amount, 0)).toBeLessThan(240);
    expect(initial.tick).toBe(0);
    expect(initial.stockpile).toBe(20);
    expect(recruited.world.tick).toBe(0);
    expect(recruited.world.resources.every((node) => node.amount === 10)).toBe(true);
  });
});
