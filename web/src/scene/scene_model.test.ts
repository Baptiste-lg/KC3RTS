import { afterEach, describe, expect, it, vi } from "vitest";
import { Group, Sprite } from "three";
import type { WorldSnapshot } from "../game/protocol";
import { SceneModel } from "./scene_model";

afterEach(() => vi.unstubAllGlobals());

describe("SceneModel", () => {
  it("tracks depleted resources and arriving villagers from server snapshots", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: () => undefined,
        }),
      }),
    });

    const initial: WorldSnapshot = {
      protocol_version: 2, seed: 12345, tick: 0, map_radius: 32,
      stockpile: { wood: 30, stone: 15, gold: 20 }, outcome: "playing",
      resources: [{ id: 1, kind: "wood", x: 8, z: 3, amount: 10, initial_amount: 10 }],
      buildings: [{ id: 1, owner: "player", x: 0, z: 0, hp: 350, max_hp: 350, progress: 100 }],
      villagers: [],
    };
    const model = new SceneModel(initial);
    const resource = model.root.getObjectByName("resource-1") as Group;

    expect(resource).toBeInstanceOf(Group);
    expect(model.root.getObjectByName("town-center")).toBeInstanceOf(Group);

    model.update({
      ...initial,
      tick: 1,
      resources: [{ ...initial.resources[0], amount: 0 }],
      villagers: [{ id: 1, x: 1, z: 2, cargo: 2, cargo_kind: "wood", hp: 30, max_hp: 30, order: null }],
    });

    expect(resource.visible).toBe(false);
    const villager = model.root.getObjectByName("villager-1") as Sprite;
    expect(villager).toBeInstanceOf(Sprite);
    expect(villager.position.x).toBe(1);
    expect(villager.position.z).toBe(2);
  });
});
