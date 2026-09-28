export interface GroundPoint {
  x: number;
  z: number;
}

export interface ResourceNode extends GroundPoint {
  id: number;
  amount: number;
  initial_amount: number;
}

export type VillagerTarget =
  | { kind: "resource"; id: number }
  | { kind: "town_center" }
  | null;

export interface Villager extends GroundPoint {
  id: number;
  cargo: number;
  target: VillagerTarget;
}

export interface WorldSnapshot {
  protocol_version: 1;
  tick: number;
  map_radius: number;
  town_center: GroundPoint;
  stockpile: number;
  resources: ResourceNode[];
  villagers: Villager[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveId(value: unknown): value is number {
  return isCount(value) && value > 0;
}

function isPoint(value: unknown): value is GroundPoint & Record<string, unknown> {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.z);
}

function isResource(value: unknown): value is ResourceNode {
  return (
    isPoint(value) &&
    isPositiveId(value.id) &&
    isCount(value.amount) &&
    isPositiveId(value.initial_amount) &&
    value.amount <= value.initial_amount
  );
}

function isTarget(value: unknown): value is VillagerTarget {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (value.kind === "town_center") return true;
  return value.kind === "resource" && isPositiveId(value.id);
}

function isVillager(value: unknown): value is Villager {
  return (
    isPoint(value) &&
    isPositiveId(value.id) &&
    isCount(value.cargo) &&
    isTarget(value.target)
  );
}

export function parseSnapshot(value: unknown): WorldSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.protocol_version !== 1 || !isCount(value.tick)) return null;
  if (!isFiniteNumber(value.map_radius) || value.map_radius <= 0) return null;
  if (!isPoint(value.town_center) || !isCount(value.stockpile)) return null;
  if (!Array.isArray(value.resources) || !value.resources.every(isResource)) return null;
  if (!Array.isArray(value.villagers) || !value.villagers.every(isVillager)) return null;
  return value as unknown as WorldSnapshot;
}
