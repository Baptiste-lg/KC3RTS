import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/kc3_opening_v3.json";
import { artFor, contentHash, parseKC3View, presentKC3 } from "./kc3_view";
const opening = () => ({ ...structuredClone(fixture.state), protocol_version: 5, ruleset_version: 3, viewer_slot: 1 });
describe("KC3 presentation contract", () => {
  it("preserves canonical IDs and ownership while resolving faction art from the catalog", () => {
    const view = parseKC3View(opening())!;
    expect(view).not.toBeNull(); expect(view.content_hash).toBe(contentHash);
    const presented = presentKC3(view);
    expect(presented.kc3).toBe(view);
    expect(presented.villagers.filter((u) => u.owner === "player")).toHaveLength(6);
    expect(artFor(view.entities[1], view)).toBe("kiln.concord.worker");
    expect(artFor(view.entities[8], view)).toBe("lantern.synod.worker");
    expect(presented.resources).toHaveLength(view.nodes.length);
  });
  it("rejects stale content, fractional coordinates, invalid paths and owners", () => {
    expect(parseKC3View({ ...opening(), content_hash: "old" })).toBeNull();
    const bad = opening(); bad.entities[1].owner = 3; expect(parseKC3View(bad)).toBeNull();
    const fractional = opening(); fractional.entities[1].x = .5; expect(parseKC3View(fractional)).toBeNull();
    const badPath = opening();
    Object.assign(badPath.entities[1], { order: { kind: "move", path: [120], offset: { x: 0, z: 0 } } });
    expect(parseKC3View(badPath)).toBeNull();
    const duplicate = opening(); duplicate.entities[1].id = duplicate.entities[0].id; expect(parseKC3View(duplicate)).toBeNull();
  });
  it("checks paid jobs, cargo limits, nodes and task progress", () => {
    const job = { id: 1, recipe_id: "core.train_worker", remaining_ticks: 150, started: false, paid: { "core.food": 50 } };
    const valid = opening(); valid.next_job_id = 2;
    Object.assign(valid.entities[0], { queue: [job] });
    Object.assign(valid.entities[1], { cargo: { resource_id: "core.food", amount: 10 } });
    expect(parseKC3View(valid)).not.toBeNull();
    const invalid: unknown[] = [];
    for (const fields of [{ queue: [job, job] }, { queue: [{ ...job, id: 2 }] }, { queue: [{ ...job, paid: { "missing.ore": 4 } }] }]) {
      const v = structuredClone(valid); Object.assign(v.entities[0], fields); invalid.push(v);
    }
    for (const fields of [{ cargo: { resource_id: "core.food", amount: 11 } }, { task: { kind: "repair", target_id: 1, progress: 101 } }, { status: "unknown" }]) {
      const v = structuredClone(valid); Object.assign(v.entities[1], fields); invalid.push(v);
    }
    for (const fields of [{ amount: -1 }, { resource_id: "core.worker" }, { x: 99999 }]) {
      const v = structuredClone(valid); Object.assign(v.nodes[0], fields); invalid.push(v);
    }
    for (const v of invalid) expect(parseKC3View(v)).toBeNull();
    valid.nodes[0].amount = 0;
    expect(presentKC3(parseKC3View(valid)!).resources.some((n) => n.id === valid.nodes[0].id)).toBe(false);
  });
});
