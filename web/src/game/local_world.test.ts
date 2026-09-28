import { describe, expect, it } from "vitest";
import { RESOURCE_AMOUNTS, RESOURCE_COUNTS } from "./map_generation";
import { applyLocalCommand, createLocalWorld, stepLocalWorld } from "./local_world";

describe("RTS simulation", () => {
  it("starts with villagers, three resource types, centers and a seeded passive enemy", () => {
    const world = createLocalWorld(1234);
    expect(createLocalWorld(1234)).toEqual(world);
    expect(world.villagers).toHaveLength(3);
    expect(world.map_radius).toBe(52);
    expect(world.resources).toHaveLength(118);
    for (const kind of ["wood", "stone", "gold"] as const) {
      const nodes = world.resources.filter((r) => r.kind === kind);
      expect(nodes).toHaveLength(RESOURCE_COUNTS[kind]);
      expect(nodes.every((r) => r.amount === RESOURCE_AMOUNTS[kind])).toBe(true);
    }
    expect(new Set(world.resources.map((r) => r.kind))).toEqual(new Set(["wood", "stone", "gold"]));
    expect(world.buildings.map((b) => b.owner)).toEqual(["player", "enemy"]);
    expect(Math.hypot(world.buildings[1].x, world.buildings[1].z)).toBeGreaterThanOrEqual(34);
    expect(world.villagers.every((v) => v.hp === v.max_hp)).toBe(true);
  });
  it("requires a gather order and delivers the correct resource", () => {
    const start = createLocalWorld(); const node = start.resources.find((r) => r.kind === "wood")!;
    expect(stepLocalWorld(start, 200).stockpile).toEqual(start.stockpile);
    const ordered = applyLocalCommand(start, { type: "order", villager_ids: [1], order: { kind: "gather", id: node.id } });
    expect(ordered.ok).toBe(true); if (!ordered.ok) return;
    const later = stepLocalWorld(ordered.world, 500);
    expect(later.stockpile.wood).toBeGreaterThan(start.stockpile.wood);
    expect(later.stockpile.stone).toBe(start.stockpile.stone);
    expect(later.resources.find((r) => r.id === node.id)!.amount).toBeLessThan(node.amount);
  });
  it("stops at the edge of a resource before gathering", () => {
    const start = createLocalWorld(1234);
    const node = start.resources.find((r) => r.kind === "wood")!;
    const nearby = { ...start, villagers: start.villagers.map((v) => v.id === 1 ? { ...v, x: node.x + 3.4, z: node.z } : v) };
    const ordered = applyLocalCommand(nearby, { type: "order", villager_ids: [1], order: { kind: "gather", id: node.id } });
    expect(ordered.ok).toBe(true); if (!ordered.ok) return;
    const worker = stepLocalWorld(ordered.world).villagers[0];
    expect(Math.hypot(worker.x - node.x, worker.z - node.z)).toBeCloseTo(3);
    expect(stepLocalWorld(ordered.world, 2).resources.find((r) => r.id === node.id)!.amount).toBe(node.amount - 1);
  });
  it("reserves a larger building footprint around stone and gold", () => {
    const world = createLocalWorld(1234);
    const ore = world.resources.find((r) => r.kind === "stone")!;
    expect(applyLocalCommand(world, { type: "build", villager_ids: [1], x: ore.x + 6, z: ore.z })).toEqual({ ok: false, reason: "invalid_location" });
  });
  it("builds only a center in free space, then recruits with separate costs", () => {
    const start = createLocalWorld();
    expect(applyLocalCommand(start, { type: "build", villager_ids: [1], x: 0, z: 0 })).toEqual({ ok: false, reason: "invalid_location" });
    const site = { x: 22, z: -22 };
    const cleared = { ...start, resources: start.resources.filter((r) => Math.hypot(r.x - site.x, r.z - site.z) >= 5) };
    const result = applyLocalCommand(cleared, { type: "build", villager_ids: [1, 2, 3], ...site });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.world.buildings.at(-1)?.progress).toBe(0);
    const built = stepLocalWorld(result.world, 300);
    expect(built.buildings.at(-1)?.progress).toBe(100);
    const recruit = applyLocalCommand(built, { type: "spawn_villager", building_id: built.buildings.at(-1)!.id });
    expect(recruit.ok).toBe(true);
  });
  it("stops selected villagers without changing other orders", () => {
    const start = createLocalWorld();
    const moving = applyLocalCommand(start, { type: "order", villager_ids: [1, 2], order: { kind: "move", x: 10, z: 0 } });
    expect(moving.ok).toBe(true); if (!moving.ok) return;
    const stopped = applyLocalCommand(moving.world, { type: "stop", villager_ids: [1] });
    expect(stopped.ok).toBe(true); if (!stopped.ok) return;
    expect(stopped.world.villagers[0].order).toBeNull();
    expect(stopped.world.villagers[1].order).toEqual({ kind: "move", x: 10, z: 0 });
  });
  it("moves villagers quickly enough to cross the expanded map", () => {
    const start = createLocalWorld();
    const ordered = applyLocalCommand(start, { type: "order", villager_ids: [1], order: { kind: "move", x: 40, z: 0 } });
    expect(ordered.ok).toBe(true); if (!ordered.ok) return;
    const moved = stepLocalWorld(ordered.world, 100).villagers[0];
    expect(moved.x).toBe(40);
    expect(moved.order).toBeNull();
  });
  it("lets villagers destroy the passive enemy base and records victory", () => {
    const start = createLocalWorld(); const enemy = start.buildings[1];
    const nearby = { ...start, villagers: start.villagers.map((v) => ({ ...v, x: enemy.x + 3, z: enemy.z })) };
    const result = applyLocalCommand(nearby, { type: "order", villager_ids: [1, 2, 3], order: { kind: "attack", id: enemy.id } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    const end = stepLocalWorld(result.world, 200);
    expect(end.buildings[1].hp).toBe(0); expect(end.outcome).toBe("victory");
  });
  it("attacks from beside the enemy base and lets faster units strike more often", () => {
    const start = createLocalWorld(1234);
    const enemy = start.buildings[1];
    const nearby = { ...start, villagers: start.villagers.map((v) => v.id === 1 ? { ...v, x: enemy.x + 5.8, z: enemy.z } : v) };
    const normal = applyLocalCommand(nearby, { type: "order", villager_ids: [1], order: { kind: "attack", id: enemy.id } });
    expect(normal.ok).toBe(true); if (!normal.ok) return;
    const fast = { ...normal.world, villagers: normal.world.villagers.map((v) => v.id === 1 ? { ...v, attack_interval_ticks: 3 } : v) };
    expect(stepLocalWorld(normal.world, 6).buildings[1].hp).toBe(245);
    expect(stepLocalWorld(fast, 6).buildings[1].hp).toBe(240);
  });
});
