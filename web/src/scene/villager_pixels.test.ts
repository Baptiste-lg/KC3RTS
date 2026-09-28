import { describe, expect, it } from "vitest";
import { generateVillagerPixels } from "./villager_pixels";

describe("generated villager art", () => {
  it("draws an opaque villager on a transparent canvas without image assets", () => {
    const sprite = generateVillagerPixels(1, false);
    const alpha = Array.from(sprite.data.filter((_, index) => index % 4 === 3));

    expect(sprite.width).toBe(4);
    expect(sprite.height).toBe(6);
    expect(alpha[0]).toBe(0);
    expect(alpha.filter((value) => value > 0).length).toBe(12);
  });

  it("is deterministic and shows cargo visually", () => {
    const empty = generateVillagerPixels(7, false);
    expect(generateVillagerPixels(7, false).data).toEqual(empty.data);
    expect(generateVillagerPixels(7, true).data).not.toEqual(empty.data);
    expect(generateVillagerPixels(7, false, 2).data).not.toEqual(generateVillagerPixels(7, false, 1).data);
    expect(generateVillagerPixels(7, false, 2).data).toEqual(generateVillagerPixels(7, false, 2).data);
  });

  it("mirrors the side view and leaves the face blank", () => {
    const right = generateVillagerPixels(2, false, 7, "right");
    const left = generateVillagerPixels(2, false, 7, "left");
    for (let y = 0; y < right.height; y += 1) {
      for (let x = 0; x < right.width; x += 1) {
        const pixel = (art: typeof right, px: number) => Array.from(art.data.slice((y * art.width + px) * 4, (y * art.width + px + 1) * 4));
        expect(pixel(left, x)).toEqual(pixel(right, right.width - 1 - x));
      }
    }
    // All three exposed head pixels are a flat skin tone, with no features.
    const face = [1, 2, 3].map((x) => Array.from(right.data.slice((2 * right.width + x) * 4, (2 * right.width + x + 1) * 4)));
    expect(face[1]).toEqual(face[0]);
    expect(face[2]).toEqual(face[0]);
  });
});
