import { afterEach, describe, expect, it, vi } from "vitest";
import { Group, Mesh, RingGeometry, Sprite } from "three";
import { UNIT_HITBOX_RADIUS } from "../game/action_rules";
import type { WorldSnapshot } from "../game/protocol";
import { SceneModel } from "./scene_model";

afterEach(() => vi.unstubAllGlobals());

describe("SceneModel", () => {
  it("turns the four-pixel peon on screen and makes its travel a sequence of hops", () => {
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({
        createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: () => undefined,
      }) }),
    });
    const world: WorldSnapshot = {
      protocol_version: 3, seed: 12345, tick: 0, map_radius: 32,
      stockpile: { wood: 30, stone: 15, gold: 20 }, outcome: "playing",
      resources: [], buildings: [],
      villagers: [{ id: 1, x: 0, z: 0, cargo: 0, cargo_kind: null, hp: 30, max_hp: 30, attack_interval_ticks: 6, order: null }],
    };
    const model = new SceneModel(world);
    const selection = model.root.children.find((child) => child instanceof Mesh && child.geometry instanceof RingGeometry) as Mesh<RingGeometry>;
    expect(selection.geometry.parameters.outerRadius).toBe(UNIT_HITBOX_RADIUS);
    model.update({ ...world, tick: 1, villagers: [{ ...world.villagers[0], x: 1, z: 0 }] });
    let sprite = model.root.getObjectByName("villager-1") as Sprite;
    expect(sprite.userData.facing).toBe("right");
    model.advance(Math.log(2) / 20);
    expect(sprite.position.y).toBeGreaterThan(.6);
    model.update({ ...world, tick: 2, villagers: [{ ...world.villagers[0], x: 0, z: 1 }] });
    sprite = model.root.getObjectByName("villager-1") as Sprite;
    expect(sprite.userData.facing).toBe("left");
    model.update({ ...world, tick: 3, villagers: [{ ...world.villagers[0], x: 1, z: 2 }] });
    expect((model.root.getObjectByName("villager-1") as Sprite).userData.facing).toBe("left");
    model.dispose();
  });

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
      protocol_version: 3, seed: 12345, tick: 0, map_radius: 32,
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
      villagers: [{ id: 1, x: 1, z: 2, cargo: 2, cargo_kind: "wood", hp: 30, max_hp: 30, attack_interval_ticks: 6, order: null }],
    });

    expect(resource.visible).toBe(false);
    const villager = model.root.getObjectByName("villager-1") as Sprite;
    expect(villager).toBeInstanceOf(Sprite);
    expect(villager.position.x).toBe(1);
    expect(villager.position.z).toBe(2);
  });

  it("moves the visible sprite toward a resource while its selection stays at the standing point", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: () => undefined,
        }),
      }),
    });
    const world: WorldSnapshot = {
      protocol_version: 3, seed: 12345, tick: 2, map_radius: 32,
      stockpile: { wood: 30, stone: 15, gold: 20 }, outcome: "playing",
      resources: [{ id: 1, kind: "wood", x: 8, z: 3, amount: 10, initial_amount: 10 }],
      buildings: [{ id: 1, owner: "player", x: 0, z: 0, hp: 350, max_hp: 350, progress: 100 }],
      villagers: [{ id: 1, x: 5, z: 3, cargo: 0, cargo_kind: null, hp: 30, max_hp: 30, attack_interval_ticks: 6, order: { kind: "gather", id: 1 } }],
    };
    const model = new SceneModel(world);
    model.advance(0);
    const sprite = model.root.getObjectByName("villager-1") as Sprite;
    expect(sprite.position.x).toBeGreaterThan(5);
    expect(world.villagers[0].x).toBe(5);
    model.update({ ...world, tick: 4 });
    model.advance(0);
    expect(sprite.position.x).toBe(5);
    model.dispose();
  });

  it("lunges toward the enemy base on its attack tick", () => {
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData: () => undefined,
        }),
      }),
    });
    const world: WorldSnapshot = {
      protocol_version: 3, seed: 12345, tick: 5, map_radius: 32,
      stockpile: { wood: 30, stone: 15, gold: 20 }, outcome: "playing",
      resources: [],
      buildings: [
        { id: 1, owner: "player", x: 0, z: 0, hp: 350, max_hp: 350, progress: 100 },
        { id: 2, owner: "enemy", x: 11, z: 3, hp: 250, max_hp: 250, progress: 100 },
      ],
      villagers: [{ id: 1, x: 5, z: 3, cargo: 0, cargo_kind: null, hp: 30, max_hp: 30, attack_interval_ticks: 6, order: { kind: "attack", id: 2 } }],
    };
    const model = new SceneModel(world);
    model.advance(0);
    expect((model.root.getObjectByName("villager-1") as Sprite).position.x).toBeGreaterThan(5);
    model.dispose();
  });
});
