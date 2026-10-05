import { contentHash, parseKC3View, type KC3View } from "./kc3_view";
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const id = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
function mergeRows<T extends { id: number }>(before: T[], delta: unknown): unknown[] | null {
  if (!record(delta) || !Array.isArray(delta.upsert) || !Array.isArray(delta.remove) || !delta.remove.every(id)) return null;
  const rows = new Map<number, unknown>(before.map((row) => [row.id, row]));
  const touched = new Set<number>();
  for (const removed of delta.remove) {
    if (touched.has(removed) || !rows.delete(removed)) return null;
    touched.add(removed);
  }
  for (const changed of delta.upsert) {
    if (!record(changed) || !id(changed.id) || touched.has(changed.id)) return null;
    touched.add(changed.id);
    rows.set(changed.id, { ...(rows.get(changed.id) as object | undefined), ...changed });
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row);
}
export function applyKC3Patch(before: KC3View, patch: unknown): KC3View | null {
  if (!record(patch) || patch.protocol_version !== 6 || patch.ruleset_version !== 4 || patch.content_hash !== contentHash ||
      patch.base_revision !== before.revision || !id(patch.revision) || patch.revision <= before.revision ||
      !Number.isSafeInteger(patch.tick) || (patch.tick as number) < before.tick) return null;
  const entities = mergeRows(before.entities, patch.entities), nodes = mergeRows(before.nodes, patch.nodes);
  if (!entities || !nodes) return null;
  return parseKC3View({ ...before, revision: patch.revision, tick: patch.tick, next_entity_id: patch.next_entity_id, next_job_id: patch.next_job_id,
    players: patch.players === null ? before.players : patch.players, outcome: patch.outcome === null ? before.outcome : patch.outcome, entities, nodes });
}
