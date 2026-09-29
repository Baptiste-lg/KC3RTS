import type { Building, GameCommand, GroundPoint, ResourceNode, Villager, WorldSnapshot } from "./protocol";
import { ATTACK_RANGE, DEFAULT_ATTACK_INTERVAL_TICKS, GATHER_INTERVAL_TICKS, UNIT_HITBOX_RADIUS, gatherRange } from "./action_rules";
import { generateMap } from "./map_generation";

const MOD = 2_147_483_647;
const SPEED = 0.55;
const UNIT_SPACING = UNIT_HITBOX_RADIUS * 2;
const DIAGONAL = 0.7071067811865476;
const SPAWN_DIRECTIONS = [[0, 1], [DIAGONAL, DIAGONAL], [1, 0], [DIAGONAL, -DIAGONAL], [0, -1], [-DIAGONAL, -DIAGONAL], [-1, 0], [-DIAGONAL, DIAGONAL]];
const CAPACITY = 5;
const COST = { villager: { wood: 5, gold: 5 }, center: { wood: 25, stone: 15 } };
export interface LocalWorld extends WorldSnapshot { nextVillagerId: number; nextBuildingId: number }
export type CommandResult = { ok: true; world: LocalWorld } | { ok: false; reason: string };
const distance = (a: GroundPoint, b: GroundPoint): number => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
const buildClearance = (resource: ResourceNode): number => resource.kind === "wood" ? 5 : 7.5;
const inside = (p: GroundPoint, radius: number): boolean => Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) <= radius - 3 && Math.abs(p.z) <= radius - 3;
function free(point: GroundPoint, villagers: Villager[], radius: number): boolean {
  return inside(point, radius) && villagers.every((v) => {
    const dx = point.x - v.x; const dz = point.z - v.z;
    return v.hp <= 0 || dx * dx + dz * dz >= UNIT_SPACING * UNIT_SPACING - 1e-9;
  });
}
function spawn(world: LocalWorld, building: Building): LocalWorld | null {
  const id = world.nextVillagerId;
  for (let slot = 0; slot < 256; slot += 1) {
    const [dx, dz] = SPAWN_DIRECTIONS[slot % 8];
    const ringRadius = 3.4 + Math.floor(slot / 8) * 1.05;
    const point = { x: building.x + dx * ringRadius, z: building.z + dz * ringRadius };
    if (free(point, world.villagers, world.map_radius)) {
      return { ...world, villagers: [...world.villagers, { id, ...point, hp: 30, max_hp: 30, attack_interval_ticks: DEFAULT_ATTACK_INTERVAL_TICKS, cargo: 0, cargo_kind: null, order: null }], nextVillagerId: id + 1 };
    }
  }
  return null;
}
export function createLocalWorld(seed = 12_345): LocalWorld {
  const mapSeed = Number.isSafeInteger(seed) ? Math.abs(seed) % (MOD - 1) || 1 : 12_345;
  const { enemy, resources } = generateMap(mapSeed);
  let world: LocalWorld = { protocol_version: 3, seed: mapSeed, tick: 0, map_radius: 52, stockpile: { wood: 30, stone: 15, gold: 20 }, resources,
    buildings: [{ id: 1, owner: "player", x: 0, z: 0, hp: 350, max_hp: 350, progress: 100 }, enemy], villagers: [], outcome: "playing", nextVillagerId: 1, nextBuildingId: 3 };
  for (let i = 0; i < 3; i += 1) world = spawn(world, world.buildings[0])!;
  return world;
}
export function applyLocalCommand(world: LocalWorld, command: GameCommand): CommandResult {
  if (world.outcome !== "playing") return { ok: false, reason: "game_over" };
  if (command.type === "spawn_villager") {
    const building = world.buildings.find((b) => b.id === command.building_id && b.owner === "player" && b.hp > 0 && b.progress === 100);
    if (!building) return { ok: false, reason: "invalid_building" };
    if (world.stockpile.wood < COST.villager.wood || world.stockpile.gold < COST.villager.gold) return { ok: false, reason: "insufficient_resources" };
    const recruited = spawn(world, building);
    if (!recruited) return { ok: false, reason: "no_spawn_space" };
    return { ok: true, world: { ...recruited, stockpile: { ...recruited.stockpile, wood: recruited.stockpile.wood - 5, gold: recruited.stockpile.gold - 5 } } };
  }
  if (!Array.isArray(command.villager_ids) || command.villager_ids.length === 0 || command.villager_ids.length > 100 || !command.villager_ids.every((id) => Number.isSafeInteger(id) && id > 0)) return { ok: false, reason: "invalid_selection" };
  const ids = new Set(command.villager_ids);
  const livingIds = new Set(world.villagers.filter((v) => v.hp > 0).map((v) => v.id));
  if (ids.size !== command.villager_ids.length || !command.villager_ids.every((id) => livingIds.has(id))) return { ok: false, reason: "invalid_selection" };
  if (command.type === "stop") {
    return { ok: true, world: { ...world, villagers: world.villagers.map((v) => ids.has(v.id) ? { ...v, order: null } : v) } };
  }
  if (command.type === "build") {
    const p = { x: command.x, z: command.z };
    if (!inside(p, world.map_radius) || world.buildings.some((b) => b.hp > 0 && distance(p, b) < 8) || world.resources.some((r) => r.amount > 0 && distance(p, r) < buildClearance(r))) return { ok: false, reason: "invalid_location" };
    if (world.stockpile.wood < COST.center.wood || world.stockpile.stone < COST.center.stone) return { ok: false, reason: "insufficient_resources" };
    const id = world.nextBuildingId;
    const building: Building = { id, owner: "player", ...p, hp: 1, max_hp: 350, progress: 0 };
    return { ok: true, world: { ...world, stockpile: { ...world.stockpile, wood: world.stockpile.wood - 25, stone: world.stockpile.stone - 15 }, buildings: [...world.buildings, building], villagers: world.villagers.map((v) => ids.has(v.id) ? { ...v, order: { kind: "build", id } } : v), nextBuildingId: id + 1 } };
  }
  const order = command.order;
  if (!order || typeof order !== "object") return { ok: false, reason: "invalid_target" };
  if (order.kind === "move" && !inside(order, world.map_radius)) return { ok: false, reason: "invalid_location" };
  if (order.kind === "gather" && !world.resources.some((r) => r.id === order.id && r.amount > 0)) return { ok: false, reason: "invalid_target" };
  if (order.kind === "build" && !world.buildings.some((b) => b.id === order.id && b.owner === "player" && b.progress < 100)) return { ok: false, reason: "invalid_target" };
  if (order.kind === "attack" && !world.buildings.some((b) => b.id === order.id && b.owner === "enemy" && b.hp > 0)) return { ok: false, reason: "invalid_target" };
  if (!["move", "gather", "build", "attack"].includes(order.kind)) return { ok: false, reason: "invalid_target" };
  return { ok: true, world: { ...world, villagers: world.villagers.map((v) => ids.has(v.id) ? { ...v, order } : v) } };
}
function move(v: Villager, p: GroundPoint, range: number, blockers: Villager[], radius: number): Villager {
  const d = distance(v, p);
  if (d <= range) return v;
  const dx = (p.x - v.x) / d; const dz = (p.z - v.z) / d;
  const step = Math.min(SPEED, d - range);
  const direct = { x: v.x + dx * step, z: v.z + dz * step };
  if (free(direct, blockers, radius)) return { ...v, ...direct };
  const side = v.id % 2 === 1 ? 1 : -1;
  for (const [cosine, sine] of [[DIAGONAL, side * DIAGONAL], [DIAGONAL, -side * DIAGONAL], [0, side], [0, -side], [-DIAGONAL, side * DIAGONAL], [-DIAGONAL, -side * DIAGONAL], [-1, 0]]) {
    const candidate = { x: v.x + (dx * cosine - dz * sine) * SPEED, z: v.z + (dx * sine + dz * cosine) * SPEED };
    if (free(candidate, blockers, radius)) return { ...v, ...candidate };
  }
  return v;
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
  const positions = new Map(world.villagers.filter((v) => v.hp > 0).map((v) => [v.id, v]));
  const villagers = world.villagers.filter((v) => v.hp > 0).map((previous) => {
    let v = { ...previous };
    const blockers = [...positions.values()].filter((unit) => unit.id !== v.id);
    const finish = (updated: Villager): Villager => { positions.set(updated.id, updated); return updated; };
    const order = v.order;
    if (!order) return finish(v);
    if (order.kind === "move") {
      v = move(v, order, 0, blockers, world.map_radius);
      const sharedGoal = blockers.some((unit) => distance(unit, order) < UNIT_SPACING);
      if (distance(v, order) < 0.1 || sharedGoal && distance(v, order) <= UNIT_SPACING * 2) v.order = null;
      return finish(v);
    }
    if (order.kind === "gather") {
      const r = resources.find((n) => n.id === order.id);
      const center = nearestCenter(v, buildings);
      if (!r || r.amount <= 0 && v.cargo === 0) return finish({ ...v, order: null });
      if (v.cargo >= CAPACITY || r.amount <= 0 || v.cargo > 0 && v.cargo_kind !== r.kind) {
        if (!center) return finish(v);
        if (distance(v, center) > 3.5) return finish(move(v, center, 3.5, blockers, world.map_radius));
        stockpile[v.cargo_kind!] += v.cargo; v.cargo = 0; v.cargo_kind = null;
        if (r.amount <= 0) v.order = null;
        return finish(v);
      }
      if (distance(v, r) > gatherRange(r.kind) + .01) return finish(move(v, r, gatherRange(r.kind), blockers, world.map_radius));
      if ((tick + v.id) % GATHER_INTERVAL_TICKS === 0) { r.amount -= 1; v.cargo += 1; v.cargo_kind = r.kind; }
      return finish(v);
    }
    const b = buildings.find((item) => item.id === order.id);
    if (!b || b.hp <= 0) return finish({ ...v, order: null });
    if (order.kind === "build") {
      if (b.progress >= 100) return finish({ ...v, order: null });
      if (distance(v, b) > 3.5) return finish(move(v, b, 3.5, blockers, world.map_radius));
      b.progress = Math.min(100, b.progress + 1); b.hp = Math.max(1, Math.round(b.max_hp * b.progress / 100));
      return finish(v);
    }
    if (distance(v, b) > ATTACK_RANGE + .01) return finish(move(v, b, ATTACK_RANGE, blockers, world.map_radius));
    if ((tick + v.id) % v.attack_interval_ticks === 0) b.hp = Math.max(0, b.hp - 5);
    return finish(v);
  });
  return { ...world, tick, resources, buildings, stockpile, villagers, outcome: buildings.some((b) => b.owner === "enemy" && b.hp > 0) ? "playing" : "victory" };
}
export function stepLocalWorld(world: LocalWorld, count = 1): LocalWorld {
  let current = world; for (let i = 0; i < count; i += 1) current = once(current); return current;
}
