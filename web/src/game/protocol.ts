export interface GroundPoint { x: number; z: number }
export type ResourceKind = "wood" | "stone" | "gold";
export type Stockpile = Record<ResourceKind, number>;
export interface ResourceNode extends GroundPoint {
  id: number; kind: ResourceKind; amount: number; initial_amount: number;
}
export interface Building extends GroundPoint {
  id: number; owner: "player" | "enemy"; hp: number; max_hp: number; progress: number;
}
export type VillagerOrder =
  | { kind: "move"; x: number; z: number }
  | { kind: "gather"; id: number }
  | { kind: "build"; id: number }
  | { kind: "attack"; id: number }
  | null;
export interface Villager extends GroundPoint {
  id: number; hp: number; max_hp: number; cargo: number; cargo_kind: ResourceKind | null;
  order: VillagerOrder;
}
export interface WorldSnapshot {
  protocol_version: 2; seed: number; tick: number; map_radius: number; stockpile: Stockpile;
  resources: ResourceNode[]; buildings: Building[]; villagers: Villager[];
  outcome: "playing" | "victory" | "defeat";
}
export type GameCommand =
  | { type: "spawn_villager"; building_id: number }
  | { type: "order"; villager_ids: number[]; order: Exclude<VillagerOrder, null> }
  | { type: "build"; villager_ids: number[]; x: number; z: number }
  | { type: "stop"; villager_ids: number[] };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number => count(value) && value > 0;
const point = (value: unknown): value is GroundPoint => record(value) && finite(value.x) && finite(value.z);
const kind = (value: unknown): value is ResourceKind => value === "wood" || value === "stone" || value === "gold";
const stockpile = (value: unknown): value is Stockpile => record(value) && count(value.wood) && count(value.stone) && count(value.gold);
const resource = (value: unknown): value is ResourceNode => record(value) && point(value) && positive(value.id) && kind(value.kind) && count(value.amount) && positive(value.initial_amount) && value.amount <= value.initial_amount;
const building = (value: unknown): value is Building => record(value) && point(value) && positive(value.id) && (value.owner === "player" || value.owner === "enemy") && count(value.hp) && positive(value.max_hp) && value.hp <= value.max_hp && count(value.progress) && value.progress <= 100;
const order = (value: unknown): value is VillagerOrder => value === null || (record(value) && (
  (value.kind === "move" && point(value)) ||
  ((value.kind === "gather" || value.kind === "build" || value.kind === "attack") && positive(value.id))
));
const villager = (value: unknown): value is Villager => record(value) && point(value) && positive(value.id) && count(value.hp) && positive(value.max_hp) && value.hp <= value.max_hp && count(value.cargo) && (value.cargo_kind === null || kind(value.cargo_kind)) && order(value.order);

export function parseSnapshot(value: unknown): WorldSnapshot | null {
  if (!record(value) || value.protocol_version !== 2 || !positive(value.seed) || !count(value.tick) || !finite(value.map_radius) || value.map_radius <= 0) return null;
  if (!stockpile(value.stockpile) || !Array.isArray(value.resources) || !value.resources.every(resource)) return null;
  if (!Array.isArray(value.buildings) || !value.buildings.every(building) || !Array.isArray(value.villagers) || !value.villagers.every(villager)) return null;
  if (value.outcome !== "playing" && value.outcome !== "victory" && value.outcome !== "defeat") return null;
  return value as unknown as WorldSnapshot;
}
