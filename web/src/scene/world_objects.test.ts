import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasTexture, Group, Mesh, Sprite } from "three";
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
    expect((stone.children[0] as Sprite).scale.x).toBe(6.6);
    expect((stone.children[0] as Sprite).scale.y).toBe(6.6);
    expect((gold.children[0] as Sprite).scale.x).toBe(6.6);
    expect((gold.children[0] as Sprite).scale.y).toBe(6.6);
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
    expect(sprite.scale.x).toBe(1.3);
    expect(sprite.scale.y).toBe(1.95);
    expect(sprite.userData.facing).toBe("right");
    expect(painted).toHaveBeenCalledOnce();
  });
});
