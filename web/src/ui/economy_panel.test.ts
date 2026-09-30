import { describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/kc3_opening_v3.json";
import { parseKC3View, type Entity } from "../game/kc3_view";
import { contextActions, contextOrder, describeEntity, EconomyPanel } from "./economy_panel";
const opening = () => parseKC3View({ ...structuredClone(fixture.state), protocol_version: 5, ruleset_version: 3, viewer_slot: 1 })!;
describe("catalog-driven economy commands", () => {
  it("offers a paid worker queue at the hall and every allowed building at a worker", () => {
    const view = opening();
    expect(contextActions(view, [], 1).map((a) => a.id)).toContain("core.train_worker");
    expect(contextActions(view, [2], null).map((a) => a.id)).toEqual(expect.arrayContaining(["core.build_house", "core.build_depot", "core.build_farm", "core.build_barracks", "core.build_range"]));
    expect(contextActions(view, [7], null)).toEqual([]);
    expect(contextActions(view, [], 8)).toEqual([]);
  });
  it("explains resource, population and queue limits before sending commands", () => {
    const view = opening();
    view.players[0].stocks["core.food"] = 0;
    expect(contextActions(view, [], 1)[0].disabled).toContain("Food");
    view.players[0].stocks["core.food"] = 200;
    view.players[0].population.reserved = 4;
    expect(contextActions(view, [], 1)[0].disabled).toContain("Population");
    view.players[0].population.reserved = 0;
    view.entities[0].queue = Array.from({ length: 5 }, (_, id) => ({ id: id + 1, recipe_id: "core.train_worker", remaining_ticks: 150, started: false, paid: { "core.food": 50 } }));
    expect(contextActions(view, [], 1)[0].disabled).toContain("Queue");
  });
  it("routes context orders to the capability of owned entities", () => {
    const view = opening();
    expect(contextOrder(view, [2, 7], null, { kind: "resource", id: 39 }).command).toEqual({ type: "gather", entity_ids: [2], target_kind: "node", target_id: 39 });
    expect(contextOrder(view, [9], null, { kind: "ground", point: { x: 0, z: 0 } }).command).toBeUndefined();
    expect(contextOrder(view, [], 1, { kind: "ground", point: { x: 6, z: 2 } }).command).toEqual({ type: "rally", entity_id: 1, x: 1536, z: 512 });
    expect(contextOrder(view, [2], null, { kind: "building", id: 8 }).reason).toContain("own");
  });
  it("distinguishes farms, repair and unfinished construction", () => {
    const view = opening();
    const building: Entity = { ...structuredClone(view.entities[0]), id: 15, type_id: "core.farm", hp: 200, max_hp: 200 };
    view.entities.push(building);
    expect(contextOrder(view, [2], null, { kind: "building", id: 15 }).command).toMatchObject({ type: "gather", target_kind: "farm" });
    building.construction = { recipe_id: "core.build_farm", remaining_ticks: 20, paid: { "core.wood": 50 } };
    expect(contextOrder(view, [2], null, { kind: "building", id: 15 }).command).toMatchObject({ type: "work" });
    expect(contextActions(view, [], 15)[0].command).toEqual({ type: "cancel_build", entity_id: 15 });
    building.construction = null; building.hp = 100; building.type_id = "core.house";
    expect(contextOrder(view, [2], null, { kind: "building", id: 15 }).command).toMatchObject({ type: "repair" });
  });
  it("uses paid queue IDs for cancellation and labels cargo without resource switches", () => {
    const view = opening();
    view.entities[0].queue = [{ id: 42, recipe_id: "core.train_worker", remaining_ticks: 130, started: true, paid: { "core.food": 50 } }];
    expect(contextActions(view, [], 1).find((a) => a.id === "cancel-42")?.command).toEqual({ type: "cancel", entity_id: 1, queue_id: 42 });
    view.entities[1].cargo = { resource_id: "core.food", amount: 4 };
    view.entities[1].status = "no_depot";
    expect(describeEntity(view.entities[1])).toContain("4 Food");
    expect(describeEntity(view.entities[1])).toContain("storage");
    expect(contextOrder(view, [2], null, { kind: "building", id: 1 }).command).toEqual({ type: "deliver", entity_ids: [2] });
  });
});

// A tick may update the label between pointer-down and click; retain the node.
it("keeps command buttons stable and invokes the latest action", () => {
  const buttons: { remove: ReturnType<typeof vi.fn>; dataset: Record<string, string>; onclick?: () => void; disabled?: boolean }[] = [];
  vi.stubGlobal("document", { createElement: () => { const b = { remove: vi.fn(), dataset: {} }; buttons.push(b); return b; } });
  try {
    const mount = { append: vi.fn(), hidden: false };
    const activate = vi.fn();
    const panel = new EconomyPanel(mount as unknown as HTMLElement, activate);
    const action = { id: "train", label: "Worker", detail: "15s", disabled: null };
    panel.update([action], true);
    panel.update([{ ...action, detail: "14s" }], false);
    expect(buttons).toHaveLength(1); expect(buttons[0].disabled).toBe(true);
    panel.update([{ ...action, detail: "13s" }], true);
    buttons[0].onclick!();
    expect(activate).toHaveBeenCalledWith({ ...action, detail: "13s" });
    panel.update([], true);
    expect(buttons[0].remove).toHaveBeenCalledOnce(); expect(mount.hidden).toBe(true);
  } finally { vi.unstubAllGlobals(); }
});
