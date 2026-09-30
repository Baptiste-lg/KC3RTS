import { definitions, rules, type Entity, type KC3Command, type KC3View } from "../game/kc3_view";
import type { MapHit } from "../scene/world_view";

export const economyReasons: Record<string, string> = {
  cargo_mismatch: "Return carried resources to storage before changing resource kind.",
  farm_busy: "A farm supports one worker. Stop its current worker to reassign it.",
  empty_cargo: "These workers have no cargo to deliver.",
  no_depot: "No reachable storage accepts this cargo. Build a depot or clear the route.",
  storage_full: "Storage is full. Spend resources before delivering or cancelling.",
  queue_full: "Queue full. Wait or cancel an entry.",
  population_full: "Population reserved. Complete a house before queueing more units.",
  population_blocked: "Waiting for population capacity. Complete a house.",
  exit_blocked: "Exit blocked. Move units away or set a rally point.",
  invalid_queue: "That queue entry has already completed or been cancelled.",
  depleted: "Resource exhausted. Assign another task.",
  unknown_content: "This recipe is unavailable in the current catalog.",
  prerequisite_required: "Complete the required technology first.",
  invalid_producer: "Select an owned, completed producer or a capable worker.",
  entity_limit: "The development match has reached its entity limit.",
};
export interface ContextAction {
  id: string; label: string; detail: string; disabled: string | null;
  command?: KC3Command; build?: { entity_id: number; recipe_id: string };
}
const has = (e: Entity, capability: string) => ((definitions.get(e.type_id)?.capabilities ?? []) as string[]).includes(capability);
const costs = (cost: Record<string, number>) => Object.entries(cost).map(([id, amount]) => `${amount} ${definitions.get(id)?.label ?? id}`).join(" · ");
export function contextActions(view: KC3View, selected: number[], building: number | null): ContextAction[] {
  const owned = view.entities.filter((e) => e.owner === view.viewer_slot);
  const producer = building === null ? owned.find((e) => selected.includes(e.id) && has(e, "build")) : owned.find((e) => e.id === building);
  if (!producer) return [];
  if (producer.construction) return [{ id: "cancel-build", label: "Cancel construction", detail: `Refund: ${rules.building_cancel_percent}% of the unbuilt cost`, disabled: null, command: { type: "cancel_build", entity_id: producer.id } }];
  const player = view.players.find((p) => p.slot === view.viewer_slot)!;
  const allowed = definitions.get(player.faction_id)?.recipes ?? [];
  const result: ContextAction[] = [];
  for (const recipe of definitions.values()) {
    if (recipe.kind !== "recipe" || recipe.producer !== producer.type_id || !allowed.includes(recipe.id)) continue;
    const output = definitions.get(recipe.output!)!, build = output.kind === "building";
    const cost = Object.fromEntries(Object.entries(recipe.cost!).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
    const missing = Object.entries(cost).filter(([id, amount]) => player.stocks[id] < amount);
    const disabled = missing.length ? `Need ${costs(Object.fromEntries(missing))}` :
      recipe.prerequisites!.length ? "Technology required" :
      !build && producer.queue.length >= (definitions.get(producer.type_id)?.queue_capacity ?? 0) ? "Queue full" :
      !build && player.population.used + player.population.reserved + (output.population ?? 0) > player.population.cap ? "Population reserved — build a house" : null;
    result.push({ id: recipe.id, label: recipe.label, detail: `${costs(cost)} · ${recipe.ticks! / 10}s`, disabled,
      ...(build ? { build: { entity_id: producer.id, recipe_id: recipe.id } } : { command: { type: "produce" as const, entity_id: producer.id, recipe_id: recipe.id, x: 0, z: 0 } }) });
  }
  for (const job of producer.queue) result.push({ id: `cancel-${job.id}`, label: `${definitions.get(job.recipe_id)?.label ?? job.recipe_id} · ${job.remaining_ticks / 10}s`,
    detail: `Cancel · ${job.started ? rules.started_cancel_percent : 100}% refund${job.remaining_ticks === 0 ? " · waiting" : ""}`, disabled: null, command: { type: "cancel", entity_id: producer.id, queue_id: job.id } });
  return result;
}
export function contextOrder(view: KC3View, selected: number[], building: number | null, hit: MapHit): { command?: KC3Command; reason?: string } {
  const units = view.entities.filter((e) => selected.includes(e.id) && e.owner === view.viewer_slot);
  const workers = units.filter((e) => has(e, "gather"));
  const producer = view.entities.find((e) => e.id === building && e.owner === view.viewer_slot && !e.construction && has(e, "train"));
  if (hit.kind === "ground") {
    const point = { x: Math.round(hit.point.x * 256), z: Math.round(hit.point.z * 256) };
    if (units.length) return { command: { type: "move", entity_ids: units.map((e) => e.id), ...point } };
    return producer ? { command: { type: "rally", entity_id: producer.id, ...point } } : { reason: "Select your units or a production building." };
  }
  if (hit.kind === "resource" && workers.length) return { command: { type: "gather", entity_ids: workers.map((e) => e.id), target_kind: "node", target_id: hit.id } };
  if (hit.kind === "building") {
    const target = view.entities.find((e) => e.id === hit.id);
    if (target?.owner !== view.viewer_slot) return { reason: "Work orders require your own building." };
    const definition = definitions.get(target.type_id)!;
    if (target.construction) {
      const builders = units.filter((e) => has(e, "build"));
      if (builders.length) return { command: { type: "work", entity_ids: builders.map((e) => e.id), target_id: target.id } };
    } else if (definition.yield && workers.length) return { command: { type: "gather", entity_ids: [workers[0].id], target_kind: "farm", target_id: target.id } };
    else if (target.hp < target.max_hp) {
      const repairers = units.filter((e) => has(e, "repair"));
      if (repairers.length) return { command: { type: "repair", entity_ids: repairers.map((e) => e.id), target_id: target.id } };
    } else if (definition.storage?.length) {
      const carrying = workers.filter((e) => e.cargo);
      if (carrying.length) return { command: { type: "deliver", entity_ids: carrying.map((e) => e.id) } };
      return { reason: "Select workers carrying resources to deliver here." };
    }
  }
  return { reason: "Select a worker for gathering, construction or repair." };
}
export function describeEntity(entity: Entity): string {
  const task = entity.task;
  const action = task?.kind === "gather" ? task.phase === "deliver" ? "Returning cargo" : `Gathering ${definitions.get(task.resource_id)?.label ?? task.resource_id}` :
    task?.kind === "work" ? "Building" : task?.kind === "repair" ? "Repairing" : entity.order ? "Moving" : "Idle";
  const cargo = entity.cargo ? ` · ${entity.cargo.amount} ${definitions.get(entity.cargo.resource_id)?.label ?? entity.cargo.resource_id}` : "";
  return `HP ${entity.hp}/${entity.max_hp} · ${entity.construction ? "Under construction" : action}${cargo}${entity.status ? ` · ${economyReasons[entity.status] ?? entity.status}` : ""}`;
}
// Keep button nodes stable across ticks so progress updates cannot swallow clicks.
export class EconomyPanel {
  private buttons = new Map<string, HTMLButtonElement>();
  constructor(private readonly mount: HTMLElement, private readonly activate: (action: ContextAction) => void) {}
  update(actions: ContextAction[], ready: boolean): void {
    const ids = new Set(actions.map((a) => a.id));
    for (const [id, button] of this.buttons) if (!ids.has(id)) { button.remove(); this.buttons.delete(id); }
    for (const action of actions) {
      let button = this.buttons.get(action.id);
      if (!button) { button = document.createElement("button"); button.type = "button"; button.dataset.action = action.id; this.buttons.set(action.id, button); this.mount.append(button); }
      button.textContent = `${action.label}\n${action.disabled ?? action.detail}`;
      button.title = action.disabled ?? action.detail;
      button.disabled = !ready || !!action.disabled;
      button.onclick = () => this.activate(action);
    }
    this.mount.hidden = actions.length === 0;
  }
}
