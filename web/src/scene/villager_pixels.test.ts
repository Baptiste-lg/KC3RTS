import { describe, expect, it } from "vitest";
import { generateVillagerPixels } from "./villager_pixels";

describe("generated villager art", () => {
  it("draws an opaque villager on a transparent canvas without image assets", () => {
    const sprite = generateVillagerPixels(1, false);
    const alpha = Array.from(sprite.data.filter((_, index) => index % 4 === 3));

    expect(sprite.width).toBe(16);
    expect(sprite.height).toBe(24);
    expect(alpha[0]).toBe(0);
    expect(alpha.filter((value) => value > 0).length).toBeGreaterThan(100);
  });

  it("is deterministic and shows cargo visually", () => {
    const empty = generateVillagerPixels(7, false);
    expect(generateVillagerPixels(7, false).data).toEqual(empty.data);
    expect(generateVillagerPixels(7, true).data).not.toEqual(empty.data);
    expect(generateVillagerPixels(7, false, 2).data).not.toEqual(generateVillagerPixels(7, false, 1).data);
    expect(generateVillagerPixels(7, false, 2).data).toEqual(generateVillagerPixels(7, false, 2).data);
  });
});
