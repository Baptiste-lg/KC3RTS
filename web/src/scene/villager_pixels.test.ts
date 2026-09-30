import { describe, expect, it } from "vitest";
import { generateVillagerPixels } from "./villager_pixels";

describe("generated villager art", () => {
  it("draws an opaque villager on a transparent canvas without image assets", () => {
    const sprite = generateVillagerPixels(1, false);
    const alpha = Array.from(sprite.data.filter((_, index) => index % 4 === 3));

    expect(sprite.width).toBe(24);
    expect(sprite.height).toBe(24);
    expect(alpha[0]).toBe(0);
    expect(alpha.filter((value) => value > 0).length).toBeGreaterThan(150);
  });

  it("is deterministic and shows cargo visually", () => {
    const empty = generateVillagerPixels(7, false);
    expect(generateVillagerPixels(7, false).data).toEqual(empty.data);
    expect(generateVillagerPixels(7, true).data).not.toEqual(empty.data);
    expect(generateVillagerPixels(7, false, 2).data).not.toEqual(generateVillagerPixels(7, false, 1).data);
    expect(generateVillagerPixels(7, false, 2).data).toEqual(generateVillagerPixels(7, false, 2).data);
  });

  it("mirrors the authored silhouette", () => {
    const right = generateVillagerPixels(2, false, 7, "right");
    const left = generateVillagerPixels(2, false, 7, "left");
    for (let y = 0; y < right.height; y += 1) {
      for (let x = 0; x < right.width; x += 1) {
        const pixel = (art: typeof right, px: number) => Array.from(art.data.slice((y * art.width + px) * 4, (y * art.width + px + 1) * 4));
        expect(pixel(left, x)).toEqual(pixel(right, right.width - 1 - x));
      }
    }

  });
  it("keeps faction silhouette separate from team colors", () => {
    const dwarf = generateVillagerPixels(1, false, 1, "right", "kiln.concord.worker");
    const mage = generateVillagerPixels(1, false, 1, "right", "lantern.synod.worker");
    const enemyMage = generateVillagerPixels(1, false, 1, "right", "lantern.synod.worker", true);
    const alpha = (p: typeof dwarf) => p.data.filter((_, i) => i % 4 === 3);
    expect(alpha(dwarf)).not.toEqual(alpha(mage));
    expect(alpha(mage)).toEqual(alpha(enemyMage));
    expect(mage.data).not.toEqual(enemyMage.data);
  });
  it("distinguishes worker, spear and ranged roles for both factions", () => {
    for (const faction of ["kiln.concord", "lantern.synod"]) {
      const roles = ["worker", "spear", "ranged"].map((role) => generateVillagerPixels(1, false, 1, "right", `${faction}.${role}`));
      expect(roles[0].data).not.toEqual(roles[1].data);
      expect(roles[1].data).not.toEqual(roles[2].data);
      expect(roles.every((art) => art.width === 24 && art.height === 24)).toBe(true);
    }
  });
});
