import { PALETTE, PixelArt, type Ink } from "./pixel_art";
import type { UnitFacing } from "./unit_facing";

export interface SpritePixels { width: number; height: number; data: Uint8ClampedArray }
// Kiln apron and lantern mantle silhouettes.
const DWARF = [
  "    oooooo    ", "   occcccco   ", "  ocCCCCccco  ", "  occcccccco  ",
  "   osssssso   ", "   osSossso   ", "  otobBBbo    ", " ottobBBbot   ",
  "oTttobBbotto  ", "oTtttooottoo  ", " ossotttooso  ", "  ooottttoo   ",
  "   owwwwwo    ", "   otTttto    ", "   ottttto    ", "   ooooooo    ",
  "   owwowwo    ", "  owwwowwwo   ",
];
const MAGE = [
  "     ooo      ", "    oiiio     ", "   oiIIiio    ", "  oiiiiiiio   ",
  "   osssso     ", "   osSoso     ", "    oLLoo     ", "   oiLLiio    ",
  "  oiLIIiiio   ", " ooLiiiiiiio  ", "ossLiiiiooso  ", " ooLiIiiiooo  ",
  "   oiIiiio    ", "  oiIiiiiio   ", "  oiIiiiiio   ", " oLLLLLLLLLo  ",
  "  oooooooo    ", "   owwowwo    ",
];
export function generateVillagerPixels(id: number, carrying: boolean, seed = 1, facing: UnitFacing = "right", artKey = "kiln.concord.worker", enemy = false): SpritePixels {
  const art = new PixelArt(24, 24);
  const mage = artKey.startsWith("lantern.");
  const ink: Record<string, Ink> = { o: PALETTE.ink, c: PALETTE.copper, C: PALETTE.copperLight, s: (id + seed) % 2 ? PALETTE.skin : PALETTE.skinShade,
    S: PALETTE.skinShade, b: PALETTE.beardShade, B: PALETTE.beard, t: PALETTE.teal, T: PALETTE.tealLight, w: PALETTE.wood,
    i: PALETTE.indigo, I: PALETTE.indigoLight, L: PALETTE.ivory };
  (mage ? MAGE : DWARF).forEach((row, y) => [...row].forEach((c, x) => { if (ink[c]) art.pixel(x + 5, y + 4, ink[c]); }));
  // Team cloth uses an independent ramp; faction materials never encode allegiance.
  art.rect(9, 13, 2, 3, enemy ? PALETTE.red : PALETTE.blue);
  if (mage) {
    art.rect(20, 10, 1, 11, PALETTE.wood); art.rect(19, 9, 3, 5, PALETTE.ink);
    art.rect(20, 10, 1, 3, PALETTE.goldLight);
  } else {
    art.rect(3, 10, 1, 11, PALETTE.wood); art.rect(1, 9, 6, 2, PALETTE.stoneShade); art.rect(2, 9, 4, 1, PALETTE.stoneLight);
  }
  if (artKey.endsWith(".scout")) { art.rect(16, 4, 1, 8, PALETTE.wood); art.rect(17, 4, 3, 3, enemy ? PALETTE.red : PALETTE.blue); }
  if (carrying) { art.rect(5, 13, 4, 5, PALETTE.wood); art.rect(6, 13, 3, 4, PALETTE.copper); }
  if (facing === "left") {
    const mirrored = new Uint8ClampedArray(art.data.length);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) mirrored.set(art.data.subarray((y * 24 + x) * 4, (y * 24 + x + 1) * 4), (y * 24 + 23 - x) * 4);
    return { width: 24, height: 24, data: mirrored };
  }
  return { width: art.width, height: art.height, data: art.data };
}
