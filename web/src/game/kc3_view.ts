import catalog from "./generated/catalog.json";
import type { VillagerOrder, WorldSnapshot } from "./protocol";

export const rules = catalog.catalog.rules;
export const contentHash = catalog.content_hash;
export const definitions = new Map(catalog.catalog.definitions.map((d) => [d.id, d]));
export interface GridMap { width: number; height: number; cell_size: number; origin_x: number; origin_z: number; blocked: number[] }
export interface Point { x: number; z: number }
export interface QueueItem { id: number; recipe_id: string; remaining_ticks: number; started: boolean; paid: Record<string, number> }
export type Task = { kind: "gather"; target_kind: "node" | "farm"; target_id: number; resource_id: string; phase: "gather" | "deliver"; progress: number } | { kind: "work" | "repair"; target_id: number; progress: number };
export interface Entity extends Point {
  id: number; type_id: string; owner: number; hp: number; max_hp: number;
  construction: { recipe_id: string; remaining_ticks: number; paid: Record<string, number> } | null;
  order: { kind: "move"; path: number[]; offset: Point } | null;
  task: Task | null; cargo: { resource_id: string; amount: number } | null;
  queue: QueueItem[]; rally: Point | null; status: string | null;
}
export interface ResourceNode extends Point { id: number; resource_id: string; amount: number }
export interface KC3View {
  protocol_version: 5; ruleset_version: 3; schema_version: 3; content_hash: string; viewer_slot: number;
  seed: number; tick: number; revision: number; next_job_id: number; next_entity_id: number;
  map: GridMap; entities: Entity[]; nodes: ResourceNode[];
  players: { slot: number; faction_id: string; stocks: Record<string, number>; population: { used: number; reserved: number; cap: number } }[];
  outcome: { status: "ongoing"; winner_slot: null; reason: null };
}
export type KC3Command =
  | { type: "move"; entity_ids: number[]; x: number; z: number }
  | { type: "stop" | "deliver"; entity_ids: number[] }
  | { type: "gather"; entity_ids: number[]; target_kind: "node" | "farm"; target_id: number }
  | { type: "work" | "repair"; entity_ids: number[]; target_id: number }
  | { type: "produce"; entity_id: number; recipe_id: string; x: number; z: number }
  | { type: "cancel"; entity_id: number; queue_id: number }
  | { type: "cancel_build"; entity_id: number }
  | { type: "rally"; entity_id: number; x: number; z: number };
const record = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const integer = (x: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): x is number => Number.isSafeInteger(x) && (x as number) >= min && (x as number) <= max;
const point = (x: unknown): x is Point => record(x) && integer(x.x, -Number.MAX_SAFE_INTEGER) && integer(x.z, -Number.MAX_SAFE_INTEGER);
const unique = (ids: number[]) => new Set(ids).size === ids.length;
const amounts = (x: unknown): x is Record<string, number> => record(x) && Object.entries(x).every(([id, amount]) => definitions.get(id)?.kind === "resource" && integer(amount, 0, definitions.get(id)!.cap));
const resourceIds = [...definitions.values()].filter((d) => d.kind === "resource").map((d) => d.id);
const statuses = new Set([null, "unreachable", "no_depot", "depleted", "storage_full", "insufficient_resources", "population_blocked", "exit_blocked"]);
function grid(v: unknown): v is GridMap {
  return record(v) && integer(v.width, 1, 32) && integer(v.height, 1, 32) && integer(v.cell_size, 1, 4096) && point({ x: v.origin_x, z: v.origin_z }) &&
    Array.isArray(v.blocked) && v.blocked.every((c) => integer(c) && c < (v.width as number) * (v.height as number)) && unique(v.blocked);
}
function task(v: unknown): v is Task | null {
  if (v === null) return true;
  if (!record(v) || !integer(v.target_id) || !integer(v.progress, 0, Math.max(99, rules.repair_interval))) return false;
  return v.kind === "gather" ? ["node", "farm"].includes(String(v.target_kind)) && ["gather", "deliver"].includes(String(v.phase)) && v.progress < 100 &&
    typeof v.resource_id === "string" && definitions.get(v.resource_id)?.kind === "resource" :
    ["work", "repair"].includes(String(v.kind)) && v.target_id > 0 && v.progress <= rules.repair_interval;
}
function entity(v: unknown, map: GridMap, nextJob: number): v is Entity {
  if (!record(v) || !integer(v.id, 1) || typeof v.type_id !== "string" || !["unit", "building"].includes(definitions.get(v.type_id)?.kind ?? "") ||
    !integer(v.owner, 1, 2) || !integer(v.max_hp, 1, 1_000_000) || !integer(v.hp, 1, v.max_hp) || !point(v) || !task(v.task) || !statuses.has(v.status as string | null)) return false;
  const c = v.construction, o = v.order, cargo = v.cargo, definition = definitions.get(v.type_id)!;
  if (c !== null && (!record(c) || typeof c.recipe_id !== "string" || definitions.get(c.recipe_id)?.output !== v.type_id || !integer(c.remaining_ticks, 1, definitions.get(c.recipe_id)?.ticks) || !amounts(c.paid))) return false;
  if (o !== null && (!record(o) || o.kind !== "move" || !point(o.offset) || !Array.isArray(o.path) || o.path.length < 1 || o.path.length > 1024 || !o.path.every((n) => integer(n, 0, map.width * map.height - 1)))) return false;
  if (cargo !== null && (!record(cargo) || typeof cargo.resource_id !== "string" || definitions.get(cargo.resource_id)?.kind !== "resource" || !integer(cargo.amount, 1, definition.cargo_capacity))) return false;
  return (v.rally === null || point(v.rally)) && Array.isArray(v.queue) && v.queue.length <= (definition.queue_capacity ?? 0) && v.queue.every((q) => record(q) &&
    integer(q.id, 1, nextJob - 1) && typeof q.recipe_id === "string" && definitions.get(q.recipe_id)?.producer === v.type_id &&
    integer(q.remaining_ticks, 0, definitions.get(q.recipe_id)?.ticks) && typeof q.started === "boolean" && amounts(q.paid));
}
export function parseKC3View(v: unknown): KC3View | null {
  if (!record(v) || v.protocol_version !== 5 || v.ruleset_version !== 3 || v.schema_version !== 3 || v.content_hash !== contentHash || v.viewer_slot !== 1 ||
    !integer(v.seed, 1, 2147483646) || !integer(v.tick) || !integer(v.revision, 1) || !integer(v.next_job_id, 1) || !integer(v.next_entity_id, 1) || !grid(v.map)) return null;
  const map = v.map, nextJob = v.next_job_id;
  if (!Array.isArray(v.entities) || v.entities.length > 512 || !v.entities.every((e) => entity(e, map, nextJob)) || !unique(v.entities.map((e) => e.id)) || !v.entities.every((e) => e.id < (v.next_entity_id as number))) return null;
  const jobs = v.entities.flatMap((e) => e.queue.map((q: QueueItem) => q.id));
  if (!unique(jobs) || jobs.length + v.entities.length > 512) return null;
  if (!Array.isArray(v.nodes) || v.nodes.length > 1024 || !v.nodes.every((n) => record(n) && integer(n.id, 1) && typeof n.resource_id === "string" &&
    definitions.get(n.resource_id)?.sources?.includes("node") && integer(n.amount, 0, definitions.get(n.resource_id)?.cap) && point(n) &&
    n.x >= map.origin_x && n.z >= map.origin_z && n.x < map.origin_x + map.width * map.cell_size && n.z < map.origin_z + map.height * map.cell_size) || !unique(v.nodes.map((n) => n.id))) return null;
  if (!Array.isArray(v.players) || v.players.length !== 2 || !v.players.every((p, i) => record(p) && p.slot === i + 1 && typeof p.faction_id === "string" &&
    definitions.get(p.faction_id)?.kind === "faction" && amounts(p.stocks) && Object.keys(p.stocks).length === resourceIds.length && resourceIds.every((id) => id in (p.stocks as object)) &&
    record(p.population) && integer(p.population.used, 0, 5120) && integer(p.population.reserved, 0, 5120) && integer(p.population.cap, 0, 60))) return null;
  if (!record(v.outcome) || v.outcome.status !== "ongoing" || v.outcome.winner_slot !== null || v.outcome.reason !== null) return null;
  return v as unknown as KC3View;
}
export function artFor(entity: Entity, view: KC3View): string {
  const faction = view.players.find((p) => p.slot === entity.owner)?.faction_id;
  return definitions.get(faction ?? "")?.overrides?.find((o) => o.target === entity.type_id)?.art ?? definitions.get(entity.type_id)?.art ?? "core.worker";
}
export function cellPoint(map: GridMap, cell: number): Point {
  return { x: (map.origin_x + (cell % map.width + .5) * map.cell_size) / 256, z: (map.origin_z + (Math.floor(cell / map.width) + .5) * map.cell_size) / 256 };
}
const visualKind = (id: string): "wood" | "stone" | "gold" => id === "core.wood" ? "wood" : id === "core.gold" ? "gold" : "stone";
function orderFor(e: Entity, view: KC3View): VillagerOrder {
  if (e.order) return { kind: "move", ...cellPoint(view.map, e.order.path.at(-1)!) };
  if (e.task?.kind === "gather") return { kind: "gather", id: e.task.target_id };
  return e.task ? { kind: "build", id: e.task.target_id } : null;
}
// One-way presentation bridge; remove at P05. Canonical state supplies all commands.
export function presentKC3(view: KC3View): WorldSnapshot {
  const stocks = view.players.find((p) => p.slot === view.viewer_slot)!.stocks;
  return { protocol_version: 3, ruleset_version: 2, seed: view.seed, tick: view.tick,
    map_radius: Math.max(view.map.width, view.map.height) * view.map.cell_size / 512,
    stockpile: { wood: stocks["core.wood"] ?? 0, stone: stocks["core.stone"] ?? 0, gold: stocks["core.gold"] ?? 0 }, outcome: "playing", kc3: view,
    resources: view.nodes.filter((n) => n.amount > 0).map((n) => ({ id: n.id, resource_id: n.resource_id, art: definitions.get(n.resource_id)?.art, label: definitions.get(n.resource_id)?.label,
      kind: visualKind(n.resource_id), x: n.x / 256, z: n.z / 256, amount: n.amount, initial_amount: n.amount })),
    buildings: view.entities.filter((e) => definitions.get(e.type_id)?.kind === "building").map((e) => ({ id: e.id, x: e.x / 256, z: e.z / 256, owner: e.owner === view.viewer_slot ? "player" : "enemy", hp: e.hp,
      max_hp: e.max_hp, progress: e.construction ? 100 * (1 - e.construction.remaining_ticks / definitions.get(e.construction.recipe_id)!.ticks!) : 100, art: artFor(e, view), label: definitions.get(e.type_id)!.label })),
    villagers: view.entities.filter((e) => definitions.get(e.type_id)?.kind === "unit").map((e) => ({ id: e.id, x: e.x / 256, z: e.z / 256, owner: e.owner === view.viewer_slot ? "player" : "enemy", hp: e.hp,
      max_hp: e.max_hp, attack_interval_ticks: 1, cargo: e.cargo?.amount ?? 0, cargo_kind: e.cargo ? visualKind(e.cargo.resource_id) : null, art: artFor(e, view), label: definitions.get(e.type_id)!.label, order: orderFor(e, view) })) };
}
