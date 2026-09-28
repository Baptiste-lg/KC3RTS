import type { UnitFacing } from "./unit_facing";

export interface SpritePixels {
  width: 4;
  height: 6;
  data: Uint8ClampedArray;
}

type Color = readonly [number, number, number, number];
const SKINS: Color[] = [
  [244, 193, 139, 255], [211, 151, 102, 255], [170, 111, 76, 255],
  [231, 175, 127, 255],
];
const HAIR: Color[] = [
  [75, 49, 43, 255], [119, 73, 48, 255], [53, 54, 58, 255], [159, 116, 62, 255],
];
const TUNICS: Color[] = [
  [62, 161, 204, 255], [98, 178, 91, 255], [213, 98, 87, 255],
  [153, 114, 205, 255], [221, 150, 66, 255], [54, 180, 158, 255],
  [208, 108, 158, 255], [102, 145, 218, 255], [185, 169, 65, 255],
  [92, 184, 145, 255], [222, 117, 66, 255], [144, 123, 189, 255],
];
const BOOT: Color = [91, 68, 55, 255];
const BAG: Color = [189, 133, 67, 255];

function shade(color: Color, factor: number): Color {
  return [Math.round(color[0] * factor), Math.round(color[1] * factor), Math.round(color[2] * factor), 255];
}

// Four painted rows, with transparent padding to keep the source pixels square on screen.
export function generateVillagerPixels(id: number, carrying: boolean, seed = 1, facing: UnitFacing = "right"): SpritePixels {
  const width = 4 as const;
  const height = 6 as const;
  const data = new Uint8ClampedArray(width * height * 4);
  const tunic = TUNICS[((Math.abs(seed) % TUNICS.length) + Math.abs(id) * 5) % TUNICS.length];
  const skin = SKINS[Math.abs(id + seed) % SKINS.length];
  const hair = HAIR[Math.abs(id * 3 + seed) % HAIR.length];
  const pixel = (x: number, y: number, color: Color): void => {
    const px = facing === "left" ? width - 1 - x : x;
    if (px >= 0 && px < width && y >= 0 && y < height) data.set(color, (y * width + px) * 4);
  };
  const rect = (left: number, top: number, right: number, bottom: number, color: Color): void => {
    for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) pixel(x, y, color);
  };

  // From top to bottom: hair, bare head, tunic, and two separate boots.
  rect(1, 1, 3, 2, hair);
  pixel(0, 2, hair); rect(1, 2, 4, 3, skin);
  rect(0, 3, 4, 4, tunic); pixel(0, 3, shade(tunic, .7));
  pixel(1, 4, BOOT); pixel(3, 4, BOOT);
  if (carrying) pixel(0, 3, BAG);

  return { width, height, data };
}
