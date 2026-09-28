import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasTexture, Group, Mesh, Sprite } from "three";
import { createGround, createResourceNode, createTownCenter, createVillagerSprite } from "./world_objects";

afterEach(() => vi.unstubAllGlobals());

describe("procedural world objects", () => {
  it("builds a 3D field, town center and resource nodes from geometry", () => {
    const ground = createGround(32);
    const center = createTownCenter();
    const resource = createResourceNode({ id: 1, x: 8, z: 3, amount: 10, initial_amount: 10 });

    expect(ground).toBeInstanceOf(Group);
    expect(center).toBeInstanceOf(Group);
    expect(resource).toBeInstanceOf(Group);
    expect(ground.children.some((child) => child instanceof Mesh)).toBe(true);
    expect(center.children.some((child) => child instanceof Mesh)).toBe(true);
    expect(resource.children.some((child) => child instanceof Mesh)).toBe(true);
    expect(resource.position.x).toBe(8);
    expect(resource.position.z).toBe(3);
  });

  it("creates a canvas-textured camera-facing villager sprite", () => {
    const putImageData = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (width: number, height: number) => ({
          width,
          height,
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData,
      }),
    };
    vi.stubGlobal("document", { createElement: () => canvas });

    const sprite = createVillagerSprite(2, true);

    expect(sprite).toBeInstanceOf(Sprite);
    expect(sprite.material.map).toBeInstanceOf(CanvasTexture);
    expect(sprite.center.y).toBe(0);
    expect(putImageData).toHaveBeenCalledOnce();
  });
});
