import { describe, expect, it } from "vitest";
import { RESOURCE_AMOUNTS, RESOURCE_COUNTS } from "./map_generation";
import { UNIT_HITBOX_RADIUS } from "./action_rules";
import { applyLocalCommand, createLocalWorld, stepLocalWorld, type LocalWorld } from "./local_world";

function expectSpaced(world: LocalWorld): void {
  let closest = Number.POSITIVE_INFINITY;
  let pair = "";
  for (let i = 0; i < world.villagers.length; i += 1) {
    for (let j = i + 1; j < world.villagers.length; j += 1) {
      const left = world.villagers[i]; const right = world.villagers[j];
      const distance = Math.hypot(left.x - right.x, left.z - right.z);
      if (distance < closest) { closest = distance; pair = `${left.id} and ${right.id}`; }
    }
  }
  expect(closest, `villagers ${pair} overlap`).toBeGreaterThanOrEqual(UNIT_HITBOX_RADIUS * 2 - 1e-8);
}

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
  it("keeps earlier snapshots intact when gathering, building and attacking", () => {
    const start = createLocalWorld(1234);
    const resource = start.resources.find((r) => r.kind === "wood")!;
    const gathering = { ...start, villagers: start.villagers.map((v) => v.id === 1 ? { ...v, x: resource.x + 3, z: resource.z, order: { kind: "gather" as const, id: resource.id } } : v) };
    const gathered = stepLocalWorld(gathering, 2);
    expect(gathered.resources.find((r) => r.id === resource.id)!.amount).toBe(resource.amount - 1);
    expect(gathering.resources.find((r) => r.id === resource.id)!.amount).toBe(resource.amount);

    const site = { id: 3, owner: "player" as const, x: 22, z: -22, hp: 1, max_hp: 350, progress: 0 };
    const building = { ...start, buildings: [...start.buildings, site], villagers: start.villagers.map((v) => v.id === 1 ? { ...v, x: 25, z: -22, order: { kind: "build" as const, id: site.id } } : v) };
    const built = stepLocalWorld(building);
    expect(built.buildings[2].progress).toBe(1);
    expect(building.buildings[2].progress).toBe(0);

    const enemy = start.buildings[1];
    const attacking = { ...start, villagers: start.villagers.map((v) => v.id === 1 ? { ...v, x: enemy.x + 3, z: enemy.z, order: { kind: "attack" as const, id: enemy.id } } : v) };
    const attacked = stepLocalWorld(attacking, 5);
    expect(attacked.buildings[1].hp).toBeLessThan(enemy.hp);
    expect(attacking.buildings[1].hp).toBe(enemy.hp);
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
  it("rejects mixed, dead and duplicate selections before changing state", () => {
    const start = createLocalWorld(1234);
    const world = { ...start, villagers: start.villagers.map((v) => v.id === 3 ? { ...v, hp: 0 } : v) };
    for (const villager_ids of [[1, 999], [1, 0], [1, -2], [1, 3], [1, 1], [], Array(101).fill(1)]) {
      expect(applyLocalCommand(world, { type: "stop", villager_ids })).toEqual({ ok: false, reason: "invalid_selection" });
      expect(applyLocalCommand(world, { type: "order", villager_ids, order: { kind: "move", x: 5, z: 5 } })).toEqual({ ok: false, reason: "invalid_selection" });
      expect(applyLocalCommand(world, { type: "build", villager_ids, x: 22, z: -22 })).toEqual({ ok: false, reason: "invalid_selection" });
    }
    expect(world).toEqual({ ...start, villagers: world.villagers });
  });
  it("rejects nonfinite points and unknown orders at the runtime boundary", () => {
    const world = createLocalWorld(1234);
    expect(applyLocalCommand(world, { type: "build", villager_ids: [1], x: Number.NaN, z: 4 })).toEqual({ ok: false, reason: "invalid_location" });
    expect(applyLocalCommand(world, { type: "order", villager_ids: [1], order: { kind: "move", x: Number.POSITIVE_INFINITY, z: 0 } })).toEqual({ ok: false, reason: "invalid_location" });
    expect(applyLocalCommand(world, { type: "order", villager_ids: [1], order: { kind: "dance" } as never })).toEqual({ ok: false, reason: "invalid_target" });
  });
  it("moves villagers quickly enough to cross the expanded map", () => {
    const start = createLocalWorld();
    const ordered = applyLocalCommand(start, { type: "order", villager_ids: [1], order: { kind: "move", x: 40, z: 0 } });
    expect(ordered.ok).toBe(true); if (!ordered.ok) return;
    const moved = stepLocalWorld(ordered.world, 100).villagers[0];
    expect(moved.x).toBe(40);
    expect(moved.order).toBeNull();
  });
  it("recruits into free spaces and does not charge when no spawn position exists", () => {
    let world = { ...createLocalWorld(1234), stockpile: { wood: 1000, stone: 15, gold: 1000 } };
    for (let i = 0; i < 37; i += 1) {
      const result = applyLocalCommand(world, { type: "spawn_villager", building_id: 1 });
      expect(result.ok).toBe(true); if (!result.ok) return;
      world = result.world;
      expectSpaced(world);
    }
    expect(world.villagers).toHaveLength(40);
    const full = { ...world, map_radius: 4 };
    expect(applyLocalCommand(full, { type: "spawn_villager", building_id: 1 })).toEqual({ ok: false, reason: "no_spawn_space" });
    expect(full.stockpile).toEqual(world.stockpile);
  });
  it("keeps a crowd separated while moving to a shared point", () => {
    let world = { ...createLocalWorld(1234), stockpile: { wood: 1000, stone: 15, gold: 1000 } };
    for (let i = 0; i < 21; i += 1) {
      const result = applyLocalCommand(world, { type: "spawn_villager", building_id: 1 });
      expect(result.ok).toBe(true); if (!result.ok) return;
      world = result.world;
    }
    const ordered = applyLocalCommand(world, { type: "order", villager_ids: world.villagers.map((v) => v.id), order: { kind: "move", x: 13, z: 13 } });
    expect(ordered.ok).toBe(true); if (!ordered.ok) return;
    world = ordered.world;
    for (let tick = 0; tick < 90; tick += 1) {
      world = stepLocalWorld(world);
      expectSpaced(world);
    }
    expect(world.villagers.some((v) => Math.hypot(v.x - 13, v.z - 13) < 2)).toBe(true);
  });
  it("keeps one hundred recruited villagers separated around a shared destination", () => {
    let world = { ...createLocalWorld(7), stockpile: { wood: 1000, stone: 15, gold: 1000 } };
    for (let i = 0; i < 97; i += 1) {
      const result = applyLocalCommand(world, { type: "spawn_villager", building_id: 1 });
      expect(result.ok).toBe(true); if (!result.ok) return;
      world = result.world;
    }
    const ordered = applyLocalCommand(world, { type: "order", villager_ids: world.villagers.map((v) => v.id), order: { kind: "move", x: 13, z: 13 } });
    expect(ordered.ok).toBe(true); if (!ordered.ok) return;
    world = ordered.world;
    for (let tick = 1; tick <= 120; tick += 1) {
      world = stepLocalWorld(world);
      if (tick % 10 === 0) expectSpaced(world);
    }
  });
  it("steers opposing movers around one another", () => {
    const start = createLocalWorld(1234);
    let world = { ...start, villagers: start.villagers.map((v) => v.id === 1 ? { ...v, x: -2, z: 0 } : v.id === 2 ? { ...v, x: 2, z: 0 } : { ...v, x: 0, z: 5 }) };
    const first = applyLocalCommand(world, { type: "order", villager_ids: [1], order: { kind: "move", x: 2, z: 0 } });
    expect(first.ok).toBe(true); if (!first.ok) return; world = first.world;
    const second = applyLocalCommand(world, { type: "order", villager_ids: [2], order: { kind: "move", x: -2, z: 0 } });
    expect(second.ok).toBe(true); if (!second.ok) return; world = second.world;
    for (let tick = 0; tick < 30; tick += 1) { world = stepLocalWorld(world); expectSpaced(world); }
    expect(world.villagers[0].x).toBeGreaterThan(0);
    expect(world.villagers[1].x).toBeLessThan(0);
  });
  it("lets villagers destroy the passive enemy base and records victory", () => {
    const start = createLocalWorld(); const enemy = start.buildings[1];
    const nearby = { ...start, villagers: start.villagers.map((v) => ({ ...v, x: enemy.x + 3, z: enemy.z + v.id - 2 })) };
    expectSpaced(nearby);
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
