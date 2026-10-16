import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/kc3_opening_v4.json";
import { definitions, parseKC3View, presentKC3 } from "../game/kc3_view";
import { idleWorkerIds, nextIdleWorker } from "./idle_workers";

const opening = () => presentKC3(parseKC3View({ ...structuredClone(fixture.state), protocol_version: 6, ruleset_version: 4, viewer_slot: 1 })!);

describe("idle worker selection", () => {
  it("uses owned economic capabilities rather than mobile units or type names", () => {
    const world = opening();
    expect(idleWorkerIds(world)).toEqual([2, 3, 4, 5, 6]);
    world.kc3!.viewer_slot = 2;
    expect(idleWorkerIds(world)).toEqual([9, 10, 11, 12, 13]);
    const worker = structuredClone(definitions.get("core.worker")!);
    if (!worker.capabilities) throw new Error("Worker fixture lacks capabilities");
    worker.id = "test.builder"; worker.capabilities = ["move", "build"];
    definitions.set(worker.id, worker);
    try {
      world.kc3!.entities[8].type_id = "test.builder";
      expect(idleWorkerIds(world)).toContain(9);
    } finally { definitions.delete("test.builder"); }
  });
  it("does not confuse stationary work, repair, delivery or planning with idleness", () => {
    const world = opening(); const entities = world.kc3!.entities;
    entities[1].task = { kind: "gather", target_kind: "node", target_id: 1, resource_id: "core.food", phase: "deliver", progress: 0 };
    entities[1].status = "no_depot";
    entities[2].task = { kind: "work", target_id: 1, progress: 0 };
    entities[3].task = { kind: "repair", target_id: 1, progress: 0 };
    entities[4].order = { kind: "move", goal: 1 }; entities[4].status = "planning";
    expect(idleWorkerIds(world)).toEqual([6]);
  });
  it("includes stopped cargo carriers and failed routes, but excludes dead, unfinished or queued workers", () => {
    const world = opening(); const entities = world.kc3!.entities;
    entities[1].cargo = { resource_id: "core.wood", amount: 3 }; entities[1].status = "blocked";
    entities[2].hp = 0;
    entities[3].construction = { recipe_id: "test.recipe", remaining_ticks: 1, paid: {} };
    entities[4].queue = [{ id: 1, recipe_id: "test.recipe", remaining_ticks: 1, started: true, paid: {} }];
    entities[5].type_id = "unknown.unit";
    expect(idleWorkerIds(world)).toEqual([2]);
  });
  it("sorts a copy without mutating authoritative state", () => {
    const world = opening(); world.kc3!.entities.reverse(); const before = structuredClone(world);
    expect(idleWorkerIds(world)).toEqual([2, 3, 4, 5, 6]);
    expect(world).toEqual(before);
  });
  it("supports legacy views and excludes busy, enemy or dead villagers", () => {
    const world = opening(); delete world.kc3;
    world.villagers[0].order = { kind: "move", x: 0, z: 0 };
    world.villagers[1].hp = 0;
    world.villagers[2].owner = undefined;
    expect(idleWorkerIds(world)).toEqual([4, 5, 6, 7]);
    world.outcome = "victory";
    expect(idleWorkerIds(world)).toEqual([]);
    expect(idleWorkerIds(null)).toEqual([]);
  });
  it("cycles, wraps and tolerates workers leaving the idle set", () => {
    expect(nextIdleWorker([2, 4, 6], null)).toBe(2);
    expect(nextIdleWorker([2, 4, 6], 2)).toBe(4);
    expect(nextIdleWorker([2, 4, 6], 3)).toBe(4);
    expect(nextIdleWorker([2, 4, 6], 6)).toBe(2);
    expect(nextIdleWorker([2], 2)).toBe(2);
    expect(nextIdleWorker([], 2)).toBeNull();
  });
});
