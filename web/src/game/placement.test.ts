import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/kc3_opening_v4.json";
import { parseKC3View, type KC3View } from "./kc3_view";
import { buildingAt, validBuildSite } from "./placement";
const opening = () => parseKC3View({ ...structuredClone(fixture.state), protocol_version: 6, ruleset_version: 4, viewer_slot: 1 })!;
const empty = (): KC3View => ({ ...opening(), entities: [], nodes: [] });
describe("authoritative footprint presentation", () => {
  it("checks the whole footprint at map edges and blocked tiles", () => {
    const view = empty();
    expect(validBuildSite(view, { x: -6144 + 512, z: 0 }, 1024)).toBe(true);
    expect(validBuildSite(view, { x: -6144 + 511, z: 0 }, 1024)).toBe(false);
    view.map.blocked = [65];
    expect(validBuildSite(view, { x: 0, z: 512 }, 1024)).toBe(false);
    expect(validBuildSite(view, { x: 512, z: 512 }, 1024)).toBe(true);
  });
  it("uses resource footprints until depletion", () => {
    const view = empty(); view.nodes = [{ id: 1, x: 512, z: 512, resource_id: "core.wood", amount: 1 }];
    expect(validBuildSite(view, { x: 1023, z: 512 }, 1024)).toBe(false);
    expect(validBuildSite(view, { x: 1536, z: 512 }, 1024)).toBe(true);
    view.nodes[0].amount = 0;
    expect(validBuildSite(view, { x: 512, z: 512 }, 1024)).toBe(true);
  });
  it("picks building foundations using catalog footprints", () => {
    const view = opening(), hall = view.entities[0];
    expect(buildingAt(view, { x: hall.x + 511, z: hall.z })).toBe(hall.id);
    expect(buildingAt(view, { x: hall.x + 512, z: hall.z })).toBeNull();
    expect(validBuildSite(view, { x: hall.x, z: hall.z }, 1024)).toBe(false);
    const worker = view.entities[1];
    expect(validBuildSite(view, { x: worker.x, z: worker.z }, 128)).toBe(false);
  });
});
