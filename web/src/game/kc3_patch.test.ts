import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/kc3_opening_v4.json";
import { parseKC3View } from "./kc3_view";
import { applyKC3Patch } from "./kc3_patch";
const opening = () => parseKC3View({ ...structuredClone(fixture.state), protocol_version: 6, ruleset_version: 4, viewer_slot: 1 })!;
const patch = () => ({ protocol_version: 6, ruleset_version: 4, content_hash: fixture.content_hash, base_revision: 1, revision: 2, tick: 1,
  next_entity_id: 15, next_job_id: 1, players: null, outcome: null, entities: { upsert: [{ id: 2, x: -1472 }], remove: [] }, nodes: { upsert: [], remove: [] } });
describe("KC3 compact patches", () => {
  it("applies changed fields without losing entity state or mutating the previous view", () => {
    const before = opening(), after = applyKC3Patch(before, patch())!;
    expect(after.entities[1]).toEqual({ ...before.entities[1], x: -1472 });
    expect(before.entities[1].x).toBe(-1536);
    expect(after.revision).toBe(2); expect(after.tick).toBe(1);
  });
  it("rejects missing revisions, mixed content and malformed updates", () => {
    const before = opening();
    for (const bad of [null, {}, { ...patch(), base_revision: 0 }, { ...patch(), revision: 1 }, { ...patch(), content_hash: "stale" },
      { ...patch(), entities: { upsert: [{ id: 2, x: .5 }], remove: [] } }, { ...patch(), entities: { upsert: [{ id: 2 }, { id: 2 }], remove: [] } },
      { ...patch(), entities: { upsert: [{ id: 15, x: 10 }], remove: [] } }, { ...patch(), entities: { upsert: [{ id: 2 }], remove: [2] } },
      { ...patch(), entities: { upsert: [], remove: [999] } }]) expect(applyKC3Patch(before, bad)).toBeNull();
  });
  it("adds full entities, removes depleted nodes and replaces player stocks", () => {
    const before = opening(), p = patch();
    const added = { ...before.entities[1], id: 15 };
    const after = applyKC3Patch(before, { ...p, next_entity_id: 16, entities: { upsert: [added], remove: [3] }, nodes: { upsert: [], remove: [18] },
      players: before.players.map((player) => ({ ...player, stocks: { ...player.stocks, "core.food": 150 } })) })!;
    expect(after.entities.find((e) => e.id === 15)).toEqual(added);
    expect(after.entities.some((e) => e.id === 3)).toBe(false);
    expect(after.nodes.some((e) => e.id === 18)).toBe(false);
    expect(after.players[0].stocks["core.food"]).toBe(150);
  });
});
