import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasTexture, Group, Mesh, Sprite, NearestFilter } from "three";
import { createEnemyBase, createGround, createResourceNode, createTownCenter, createVillagerSprite } from "./world_objects";

afterEach(() => vi.unstubAllGlobals());

function canvasStub() {
  const putImageData = vi.fn();
  vi.stubGlobal("document", { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData,
    }),
  }) });
  return putImageData;
}

describe("pixel art world objects", () => {
  it("builds a textured flat map and camera-facing sprites for all scenery", () => {
    const painted = canvasStub();
    const ground = createGround(52);
    const center = createTownCenter();
    const enemy = createEnemyBase();
    const wood = createResourceNode({ id: 1, kind: "wood", x: 8, z: 3, amount: 10, initial_amount: 10 });
    const stone = createResourceNode({ id: 2, kind: "stone", x: 9, z: 3, amount: 10, initial_amount: 10 });
    const gold = createResourceNode({ id: 3, kind: "gold", x: 10, z: 3, amount: 10, initial_amount: 10 });

    expect(ground).toBeInstanceOf(Group);
    expect(ground.children.every((child) => child instanceof Mesh && child.geometry.type === "PlaneGeometry")).toBe(true);
    for (const object of [center, enemy, wood, stone, gold]) {
      expect(object.children).toHaveLength(1);
      expect(object.children[0]).toBeInstanceOf(Sprite);
      expect((object.children[0] as Sprite).material.map).toBeInstanceOf(CanvasTexture);
    }
    for (const object of [center, enemy, wood, stone, gold]) {
      const sprite = object.children[0] as Sprite;
      expect(sprite.scale.x / (sprite.material.map!.image as HTMLCanvasElement).width).toBe(1 / 8);
      expect(sprite.scale.y / (sprite.material.map!.image as HTMLCanvasElement).height).toBe(1 / 8);
      expect(sprite.material.map!.magFilter).toBe(NearestFilter);
    }
    expect(wood.position.x).toBe(8);
    expect(wood.position.z).toBe(3);
    expect(painted).toHaveBeenCalledTimes(6);
  });

  it("keeps villager sprites facing the camera", () => {
    const painted = canvasStub();
    const sprite = createVillagerSprite(2, true);

    expect(sprite).toBeInstanceOf(Sprite);
    expect(sprite.material.map).toBeInstanceOf(CanvasTexture);
    expect(sprite.center.y).toBe(0);
    expect(sprite.scale.x).toBe(3);
    expect(sprite.scale.y).toBe(3);
    expect(sprite.userData.facing).toBe("right");
    expect(painted).toHaveBeenCalledOnce();
  });
  it("gives economy buildings distinct silhouettes at the same pixel density", () => {
    const painted = canvasStub();
    const signatures = new Set<string>();
    for (const kind of ["house", "depot", "farm", "barracks", "range"]) {
      for (const faction of ["kiln.concord", "lantern.synod"]) {
        const object = createTownCenter(`${faction}.${kind}`);
        const sprite = object.children[0] as Sprite;
        const texture = sprite.material.map!;
        expect(sprite.scale.x / (texture.image as HTMLCanvasElement).width).toBe(1 / 8);
        expect(sprite.scale.y / (texture.image as HTMLCanvasElement).height).toBe(1 / 8);
        expect(texture.magFilter).toBe(NearestFilter);
        signatures.add(Buffer.from(painted.mock.calls.at(-1)![0].data).toString("base64"));
      }
    }
    expect(signatures.size).toBe(10);
    createResourceNode({ id: 39, kind: "stone", art: "core.food", x: 0, z: 0, amount: 20, initial_amount: 20 });
    expect(painted.mock.calls.at(-1)![0].width).toBe(32);
  });
});
