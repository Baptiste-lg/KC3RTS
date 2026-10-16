import { definitions } from "../game/kc3_view";
import type { WorldSnapshot } from "../game/protocol";

// Selection is presentation only: active KC3 tasks may have no movement order.
export function idleWorkerIds(world: WorldSnapshot | null): number[] {
  if (!world || world.outcome !== "playing") return [];
  if (world.kc3) {
    const view = world.kc3;
    return view.entities.filter((entity) => {
      const definition = definitions.get(entity.type_id);
      const capabilities = (definition?.capabilities ?? []) as string[];
      return entity.owner === view.viewer_slot && entity.hp > 0 &&
        definition?.kind === "unit" && capabilities.some((c) => ["gather", "build", "repair"].includes(c)) &&
        entity.construction === null && entity.order === null && entity.task === null && entity.queue.length === 0;
    }).map((entity) => entity.id).sort((a, b) => a - b);
  }
  return world.villagers.filter((unit) => unit.owner !== "enemy" && unit.hp > 0 && unit.order === null)
    .map((unit) => unit.id).sort((a, b) => a - b);
}

// IDs remain stable as workers become busy, die or join the idle set.
export function nextIdleWorker(ids: readonly number[], previous: number | null): number | null {
  return ids.find((id) => previous === null || id > previous) ?? ids[0] ?? null;
}
