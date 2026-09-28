import type { Building, GameCommand, GroundPoint, ResourceKind, ResourceNode, Villager, WorldSnapshot } from "./protocol";

const MOD = 2_147_483_647;
const SPEED = 0.55;
const CAPACITY = 5;
const COST = { villager: { wood: 5, gold: 5 }, center: { wood: 25, stone: 15 } };
export interface LocalWorld extends WorldSnapshot { nextVillagerId: number; nextBuildingId: number }
export type CommandResult = { ok: true; world: LocalWorld } | { ok: false; reason: string };
const distance = (a: GroundPoint, b: GroundPoint): number => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (p: GroundPoint, radius: number): boolean => Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= radius - 3 && Math.abs(p.z) <= radius - 3;
function next(seed: number, span: number): [number, number] {
  const value = seed * 48_271 % MOD;
  return [Math.round((value / MOD * span * 2 - span) * 10) / 10, value];
}
function spawn(world: LocalWorld, building: Building): LocalWorld {
  const id = world.nextVillagerId;
  return { ...world, villagers: [...world.villagers, { id, x: building.x + (id % 3 - 1) * 0.5, z: building.z + 3.4, hp: 30, max_hp: 30, cargo: 0, cargo_kind: null, order: null }], nextVillagerId: id + 1 };
}
export function createLocalWorld(seed = 12_345): LocalWorld {
  let random = Number.isSafeInteger(seed) ? Math.abs(seed) % (MOD - 1) || 1 : 12_345;
  const mapSeed = random;
  const enemy: Building = { id: 2, owner: "enemy", x: 0, z: 0, hp: 250, max_hp: 250, progress: 100 };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [x, a] = next(random, 48); const [z, b] = next(a, 48); random = b;
    if (Math.hypot(x, z) >= 34) { enemy.x = x; enemy.z = z; break; }
  }
  const resources: ResourceNode[] = [];
  for (let id = 1; id <= 90; id += 1) {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const span = id <= 18 ? 18 : 48;
      const [x, a] = next(random, span); const [z, b] = next(a, span); random = b;
      const p = { x, z };
      if (distance(p, { x: 0, z: 0 }) < 9 || distance(p, enemy) < 7 || resources.some((r) => distance(p, r) < 3)) continue;
      const kind: ResourceKind = (["wood", "stone", "gold"] as const)[(id - 1) % 3];
      resources.push({ id, kind, ...p, amount: 30, initial_amount: 30 }); break;
    }
  }
  let world: LocalWorld = { protocol_version: 2, seed: mapSeed, tick: 0, map_radius: 52, stockpile: { wood: 30, stone: 15, gold: 20 }, resources,
    buildings: [{ id: 1, owner: "player", x: 0, z: 0, hp: 350, max_hp: 350, progress: 100 }, enemy], villagers: [], outcome: "playing", nextVillagerId: 1, nextBuildingId: 3 };
  for (let i = 0; i < 3; i += 1) world = spawn(world, world.buildings[0]);
  return world;
}
export function applyLocalCommand(world: LocalWorld, command: GameCommand): CommandResult {
  if (world.outcome !== "playing") return { ok: false, reason: "game_over" };
  if (command.type === "spawn_villager") {
    const building = world.buildings.find((b) => b.id === command.building_id && b.owner === "player" && b.hp > 0 && b.progress === 100);
    if (!building) return { ok: false, reason: "invalid_building" };
    if (world.stockpile.wood < COST.villager.wood || world.stockpile.gold < COST.villager.gold) return { ok: false, reason: "insufficient_resources" };
    return { ok: true, world: spawn({ ...world, stockpile: { ...world.stockpile, wood: world.stockpile.wood - 5, gold: world.stockpile.gold - 5 } }, building) };
  }
  if (!Array.isArray(command.villager_ids) || command.villager_ids.length === 0 || command.villager_ids.length > 100 || !command.villager_ids.every(Number.isSafeInteger)) return { ok: false, reason: "invalid_selection" };
  const ids = new Set(command.villager_ids);
  if (!world.villagers.some((v) => ids.has(v.id) && v.hp > 0)) return { ok: false, reason: "invalid_selection" };
  if (command.type === "stop") {
    return { ok: true, world: { ...world, villagers: world.villagers.map((v) => ids.has(v.id) ? { ...v, order: null } : v) } };
  }
  if (command.type === "build") {
    const p = { x: command.x, z: command.z };
    if (!inside(p, world.map_radius) || world.buildings.some((b) => b.hp > 0 && distance(p, b) < 8) || world.resources.some((r) => r.amount > 0 && distance(p, r) < 5)) return { ok: false, reason: "invalid_location" };
    if (world.stockpile.wood < COST.center.wood || world.stockpile.stone < COST.center.stone) return { ok: false, reason: "insufficient_resources" };
    const id = world.nextBuildingId;
    const building: Building = { id, owner: "player", ...p, hp: 1, max_hp: 350, progress: 0 };
    return { ok: true, world: { ...world, stockpile: { ...world.stockpile, wood: world.stockpile.wood - 25, stone: world.stockpile.stone - 15 }, buildings: [...world.buildings, building], villagers: world.villagers.map((v) => ids.has(v.id) ? { ...v, order: { kind: "build", id } } : v), nextBuildingId: id + 1 } };
  }
  const order = command.order;
  if (order.kind === "move" && !inside(order, world.map_radius)) return { ok: false, reason: "invalid_location" };
  if (order.kind === "gather" && !world.resources.some((r) => r.id === order.id && r.amount > 0)) return { ok: false, reason: "invalid_target" };
  if (order.kind === "build" && !world.buildings.some((b) => b.id === order.id && b.owner === "player" && b.progress < 100)) return { ok: false, reason: "invalid_target" };
  if (order.kind === "attack" && !world.buildings.some((b) => b.id === order.id && b.owner === "enemy" && b.hp > 0)) return { ok: false, reason: "invalid_target" };
  return { ok: true, world: { ...world, villagers: world.villagers.map((v) => ids.has(v.id) ? { ...v, order } : v) } };
}
function move(v: Villager, p: GroundPoint): Villager {
  const d = distance(v, p); if (d <= SPEED) return { ...v, x: p.x, z: p.z };
  return { ...v, x: v.x + (p.x - v.x) / d * SPEED, z: v.z + (p.z - v.z) / d * SPEED };
}
function nearestCenter(v: Villager, buildings: Building[]): Building | undefined {
  return buildings.filter((b) => b.owner === "player" && b.hp > 0 && b.progress === 100).sort((a, b) => distance(v, a) - distance(v, b))[0];
}
function once(world: LocalWorld): LocalWorld {
  if (world.outcome !== "playing") return world;
  const tick = world.tick + 1;
  const resources = world.resources.map((r) => ({ ...r }));
  const buildings = world.buildings.map((b) => ({ ...b }));
  const stockpile = { ...world.stockpile };
  const villagers = world.villagers.filter((v) => v.hp > 0).map((previous) => {
    let v = { ...previous };
    const order = v.order;
    if (!order) return v;
    if (order.kind === "move") { v = move(v, order); if (distance(v, order) < 0.1) v.order = null; return v; }
    if (order.kind === "gather") {
      const r = resources.find((n) => n.id === order.id);
      const center = nearestCenter(v, buildings);
      if (!r || r.amount <= 0 && v.cargo === 0) return { ...v, order: null };
      if (v.cargo >= CAPACITY || r.amount <= 0 || v.cargo > 0 && v.cargo_kind !== r.kind) {
        if (!center) return v;
        if (distance(v, center) > 3.5) return move(v, center);
        stockpile[v.cargo_kind!] += v.cargo; v.cargo = 0; v.cargo_kind = null;
        if (r.amount <= 0) v.order = null;
        return v;
      }
      if (distance(v, r) > 1.3) return move(v, r);
      if ((tick + v.id) % 3 === 0) { r.amount -= 1; v.cargo += 1; v.cargo_kind = r.kind; }
      return v;
    }
    const b = buildings.find((item) => item.id === order.id);
    if (!b || b.hp <= 0) return { ...v, order: null };
    if (order.kind === "build") {
      if (b.progress >= 100) return { ...v, order: null };
      if (distance(v, b) > 3.5) return move(v, b);
      b.progress = Math.min(100, b.progress + 1); b.hp = Math.max(1, Math.round(b.max_hp * b.progress / 100));
      return v;
    }
    if (distance(v, b) > 3.5) return move(v, b);
    if ((tick + v.id) % 6 === 0) b.hp = Math.max(0, b.hp - 5);
    return v;
  });
  return { ...world, tick, resources, buildings, stockpile, villagers, outcome: buildings.some((b) => b.owner === "enemy" && b.hp > 0) ? "playing" : "victory" };
}
export function stepLocalWorld(world: LocalWorld, count = 1): LocalWorld {
  let current = world; for (let i = 0; i < count; i += 1) current = once(current); return current;
}
