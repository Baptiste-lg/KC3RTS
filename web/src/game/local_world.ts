import type { GroundPoint, ResourceNode, Villager, VillagerTarget, WorldSnapshot } from "./protocol";

const RANDOM_MODULUS = 2_147_483_647;
const RESOURCE_AMOUNT = 10;
const RESOURCE_MIN_CENTER_DISTANCE = 8;
const RESOURCE_MIN_SPACING = 3;
const GATHER_INTERVAL = 5;
const GATHER_RANGE = 1.1;
const DELIVERY_RANGE = 3.4;
const MOVE_SPEED = 0.18;
const VILLAGER_CAPACITY = 5;
const VILLAGER_COST = 5;

export interface LocalWorld extends WorldSnapshot {
  nextVillagerId: number;
}

export type RecruitmentResult =
  | { ok: true; world: LocalWorld }
  | { ok: false; reason: "insufficient_resources" };

function distance(left: GroundPoint, right: GroundPoint): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function randomCoordinate(seed: number): [number, number] {
  const nextSeed = (seed * 48_271) % RANDOM_MODULUS;
  const coordinate = Math.round((nextSeed / RANDOM_MODULUS * 58 - 29) * 10) / 10;
  return [coordinate, nextSeed];
}

export function createLocalWorld(seed = 12_345): LocalWorld {
  const normalized = Number.isSafeInteger(seed) ? Math.abs(seed) % (RANDOM_MODULUS - 1) : 12_345;
  let randomSeed = normalized || 1;
  const resources: ResourceNode[] = [];

  for (let id = 1; id <= 24; id += 1) {
    let placed = false;
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const [x, xSeed] = randomCoordinate(randomSeed);
      const [z, zSeed] = randomCoordinate(xSeed);
      randomSeed = zSeed;
      const point = { x, z };
      if (distance(point, { x: 0, z: 0 }) < RESOURCE_MIN_CENTER_DISTANCE ||
          resources.some((resource) => distance(point, resource) < RESOURCE_MIN_SPACING)) continue;
      resources.push({ id, ...point, amount: RESOURCE_AMOUNT, initial_amount: RESOURCE_AMOUNT });
      placed = true;
      break;
    }
    if (!placed) break;
  }

  return {
    protocol_version: 1,
    tick: 0,
    map_radius: 32,
    town_center: { x: 0, z: 0 },
    stockpile: 20,
    resources,
    villagers: [],
    nextVillagerId: 1,
  };
}

export function recruitLocalVillager(world: LocalWorld): RecruitmentResult {
  if (world.stockpile < VILLAGER_COST) return { ok: false, reason: "insufficient_resources" };
  const id = world.nextVillagerId;
  const villager: Villager = {
    id,
    x: world.town_center.x + ((id - 1) % 3) * 0.45,
    z: world.town_center.z + 3.2,
    cargo: 0,
    target: null,
  };
  return {
    ok: true,
    world: {
      ...world,
      stockpile: world.stockpile - VILLAGER_COST,
      villagers: [...world.villagers, villager],
      nextVillagerId: id + 1,
    },
  };
}

function nearestResource(villager: Villager, resources: ResourceNode[]): ResourceNode | undefined {
  let nearest: ResourceNode | undefined;
  let nearestDistance = Infinity;
  for (const resource of resources) {
    if (resource.amount <= 0) continue;
    const candidateDistance = distance(villager, resource);
    if (candidateDistance < nearestDistance) {
      nearest = resource;
      nearestDistance = candidateDistance;
    }
  }
  return nearest;
}

function chooseTarget(villager: Villager, resources: ResourceNode[]): VillagerTarget {
  if (villager.cargo >= VILLAGER_CAPACITY ||
      (villager.target?.kind === "town_center" && villager.cargo > 0)) {
    return { kind: "town_center" };
  }
  const previousTarget = villager.target;
  if (previousTarget?.kind === "resource" &&
      resources.some((resource) => resource.id === previousTarget.id && resource.amount > 0)) {
    return previousTarget;
  }
  const nearest = nearestResource(villager, resources);
  if (nearest) return { kind: "resource", id: nearest.id };
  return villager.cargo > 0 ? { kind: "town_center" } : null;
}

function moveTowards(villager: Villager, point: GroundPoint): Villager {
  const gap = distance(villager, point);
  if (gap <= MOVE_SPEED) return { ...villager, x: point.x, z: point.z };
  return {
    ...villager,
    x: villager.x + (point.x - villager.x) / gap * MOVE_SPEED,
    z: villager.z + (point.z - villager.z) / gap * MOVE_SPEED,
  };
}

function stepOnce(world: LocalWorld): LocalWorld {
  const tick = world.tick + 1;
  let stockpile = world.stockpile;
  let resources = world.resources;
  const villagers = world.villagers.map((previous) => {
    const target = chooseTarget(previous, resources);
    const villager = { ...previous, target };
    if (target?.kind === "town_center") {
      if (distance(villager, world.town_center) <= DELIVERY_RANGE) {
        stockpile += villager.cargo;
        return { ...villager, cargo: 0, target: null };
      }
      return moveTowards(villager, world.town_center);
    }
    if (target?.kind !== "resource") return villager;
    const resource = resources.find((node) => node.id === target.id);
    if (!resource) return villager;
    if (distance(villager, resource) > GATHER_RANGE) return moveTowards(villager, resource);
    if ((tick + villager.id) % GATHER_INTERVAL !== 0) return villager;
    resources = resources.map((node) => node.id === target.id ? { ...node, amount: node.amount - 1 } : node);
    return { ...villager, cargo: villager.cargo + 1 };
  });
  return { ...world, tick, resources, villagers, stockpile };
}

export function stepLocalWorld(world: LocalWorld, count = 1): LocalWorld {
  let current = world;
  for (let step = 0; step < count; step += 1) current = stepOnce(current);
  return current;
}
