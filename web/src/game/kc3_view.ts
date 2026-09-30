import catalog from "./generated/catalog.json";
import type { WorldSnapshot } from "./protocol";

export const contentHash = catalog.content_hash;
export const definitions = new Map(catalog.catalog.definitions.map((d) => [d.id, d]));
export interface GridMap { width: number; height: number; cell_size: number; origin_x: number; origin_z: number; blocked: number[] }
export interface Entity { id: number; type_id: string; owner: number; hp: number; x: number; z: number; construction: { recipe_id: string; remaining_ticks: number } | null; order: { kind: "move"; path: number[]; offset: { x: number; z: number } } | null }
export interface KC3View {
  protocol_version: 4; ruleset_version: 2; schema_version: 2; content_hash: string; viewer_slot: number;
  seed: number; tick: number; revision: number; map: GridMap; entities: Entity[];
  players: { slot: number; faction_id: string; stocks: Record<string, number> }[];
  outcome: { status: "ongoing"; winner_slot: null; reason: null };
}
export type KC3Command = { type: "move"; entity_ids: number[]; x: number; z: number } | { type: "stop"; entity_ids: number[] };
const record = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const integer = (x: unknown, min = 0): x is number => Number.isSafeInteger(x) && (x as number) >= min;
const coordinate = (x: unknown): x is number => integer(x, -Number.MAX_SAFE_INTEGER);
const unique = (ids: number[]) => new Set(ids).size === ids.length;

function grid(value: unknown): value is GridMap {
  return record(value) && integer(value.width, 1) && value.width <= 32 && integer(value.height, 1) && value.height <= 32 &&
    integer(value.cell_size, 1) && value.cell_size <= 4096 && coordinate(value.origin_x) && coordinate(value.origin_z) &&
    Array.isArray(value.blocked) && value.blocked.every((c) => integer(c) && c < (value.width as number) * (value.height as number)) && unique(value.blocked);
}
function entity(value: unknown, map: GridMap): value is Entity {
  if (!record(value) || !integer(value.id, 1) || typeof value.type_id !== "string" || !["unit", "building"].includes(definitions.get(value.type_id)?.kind ?? "") ||
    !integer(value.owner, 1) || value.owner > 2 || !integer(value.hp, 1) || !coordinate(value.x) || !coordinate(value.z)) return false;
  const c = value.construction, o = value.order;
  if (c !== null && (!record(c) || typeof c.recipe_id !== "string" || definitions.get(c.recipe_id)?.output !== value.type_id || !integer(c.remaining_ticks, 1))) return false;
  return o === null || (record(o) && o.kind === "move" && record(o.offset) && coordinate(o.offset.x) && coordinate(o.offset.z) &&
    Array.isArray(o.path) && o.path.length > 0 && o.path.length <= 1024 && o.path.every((n) => integer(n) && n < map.width * map.height));
}
export function parseKC3View(value: unknown): KC3View | null {
  if (!record(value) || value.protocol_version !== 4 || value.ruleset_version !== 2 || value.schema_version !== 2 || value.content_hash !== contentHash || value.viewer_slot !== 1 ||
    !integer(value.seed, 1) || !integer(value.tick) || !integer(value.revision, 1) || !grid(value.map)) return null;
  const map = value.map;
  if (!Array.isArray(value.entities) || value.entities.length > 512 || !value.entities.every((e) => entity(e, map)) || !unique(value.entities.map((e) => e.id))) return null;
  if (!Array.isArray(value.players) || value.players.length !== 2 || !value.players.every((p, i) => record(p) && p.slot === i + 1 && typeof p.faction_id === "string" &&
    definitions.get(p.faction_id)?.kind === "faction" && record(p.stocks) && Object.entries(p.stocks).every(([id, amount]) => definitions.get(id)?.kind === "resource" && integer(amount)))) return null;
  if (!record(value.outcome) || value.outcome.status !== "ongoing" || value.outcome.winner_slot !== null || value.outcome.reason !== null) return null;
  return value as unknown as KC3View;
}
export function artFor(entity: Entity, view: KC3View): string {
  const faction = view.players.find((p) => p.slot === entity.owner)?.faction_id;
  return definitions.get(faction ?? "")?.overrides?.find((o) => o.target === entity.type_id)?.art ?? definitions.get(entity.type_id)?.art ?? "core.worker";
}
export function cellPoint(map: GridMap, cell: number): { x: number; z: number } {
  return { x: (map.origin_x + (cell % map.width + .5) * map.cell_size) / 256,
    z: (map.origin_z + (Math.floor(cell / map.width) + .5) * map.cell_size) / 256 };
}
// One-way presentation bridge. Remove at P05 when the legacy renderer model retires.
// The attached canonical view remains the source for commands, labels and resources.
export function presentKC3(view: KC3View): WorldSnapshot {
  const units = view.entities.filter((e) => definitions.get(e.type_id)?.kind === "unit");
  const buildings = view.entities.filter((e) => definitions.get(e.type_id)?.kind === "building");
  const stocks = view.players.find((p) => p.slot === view.viewer_slot)!.stocks;
  return { protocol_version: 3, ruleset_version: 2, seed: view.seed, tick: view.tick,
    map_radius: Math.max(view.map.width, view.map.height) * view.map.cell_size / 512,
    stockpile: { wood: stocks["core.wood"] ?? 0, stone: stocks["core.stone"] ?? 0, gold: stocks["core.gold"] ?? 0 }, outcome: "playing", kc3: view,
    resources: view.map.blocked.map((cell) => ({ id: cell + 1, kind: cell % 3 === 0 ? "stone" : "wood", ...cellPoint(view.map, cell), amount: 1, initial_amount: 1 })),
    buildings: buildings.map((e) => ({ id: e.id, x: e.x / 256, z: e.z / 256, owner: e.owner === view.viewer_slot ? "player" : "enemy", hp: e.hp,
      max_hp: definitions.get(e.type_id)?.hp ?? e.hp, progress: e.construction ? 0 : 100, art: artFor(e, view), label: definitions.get(e.type_id)!.label })),
    villagers: units.map((e) => ({ id: e.id, x: e.x / 256, z: e.z / 256, owner: e.owner === view.viewer_slot ? "player" : "enemy", hp: e.hp,
      max_hp: definitions.get(e.type_id)?.hp ?? e.hp, attack_interval_ticks: 1, cargo: 0, cargo_kind: null, art: artFor(e, view), label: definitions.get(e.type_id)!.label,
      order: e.order ? { kind: "move", ...cellPoint(view.map, e.order.path.at(-1)!) } : null })) };
}
