import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/kc3_opening_v2.json";
import { artFor, contentHash, parseKC3View, presentKC3 } from "./kc3_view";
const opening = () => ({ ...structuredClone(fixture.state), protocol_version: 4, ruleset_version: 2, viewer_slot: 1 });
describe("KC3 presentation contract", () => {
  it("preserves canonical IDs and ownership while resolving faction art from the catalog", () => {
    const view = parseKC3View(opening())!;
    expect(view).not.toBeNull(); expect(view.content_hash).toBe(contentHash);
    const presented = presentKC3(view);
    expect(presented.kc3).toBe(view);
    expect(presented.villagers.filter((u) => u.owner === "player")).toHaveLength(6);
    expect(artFor(view.entities[1], view)).toBe("kiln.concord.worker");
    expect(artFor(view.entities[8], view)).toBe("lantern.synod.worker");
    expect(presented.resources).toHaveLength(view.map.blocked.length);
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
});
