import { describe, expect, it } from "vitest";
import { applyLocalCommand, createLocalWorld, stepLocalWorld } from "./local_world";

describe("RTS simulation", () => {
  it("starts with villagers, three resource types, centers and a seeded passive enemy", () => {
    const world = createLocalWorld(1234);
    expect(createLocalWorld(1234)).toEqual(world);
    expect(world.villagers).toHaveLength(3);
    expect(new Set(world.resources.map((r) => r.kind))).toEqual(new Set(["wood", "stone", "gold"]));
    expect(world.buildings.map((b) => b.owner)).toEqual(["player", "enemy"]);
    expect(Math.hypot(world.buildings[1].x, world.buildings[1].z)).toBeGreaterThanOrEqual(22);
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
  it("lets villagers destroy the passive enemy base and records victory", () => {
    const start = createLocalWorld(); const enemy = start.buildings[1];
    const nearby = { ...start, villagers: start.villagers.map((v) => ({ ...v, x: enemy.x + 3, z: enemy.z })) };
    const result = applyLocalCommand(nearby, { type: "order", villager_ids: [1, 2, 3], order: { kind: "attack", id: enemy.id } });
    expect(result.ok).toBe(true); if (!result.ok) return;
    const end = stepLocalWorld(result.world, 200);
    expect(end.buildings[1].hp).toBe(0); expect(end.outcome).toBe("victory");
  });
});
