export interface SpritePixels {
  width: 16;
  height: 24;
  data: Uint8ClampedArray;
}

type Color = readonly [number, number, number, number];

const INK: Color = [38, 37, 44, 255];
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
const BELT: Color = [127, 86, 55, 255];
const BAG: Color = [189, 133, 67, 255];

function shade(color: Color, factor: number): Color {
  return [Math.round(color[0] * factor), Math.round(color[1] * factor), Math.round(color[2] * factor), 255];
}

// A deliberately small, front-facing sprite: each source pixel remains visible at game scale.
export function generateVillagerPixels(id: number, carrying: boolean, seed = 1): SpritePixels {
  const width = 16 as const;
  const height = 24 as const;
  const data = new Uint8ClampedArray(width * height * 4);
  const tunic = TUNICS[((Math.abs(seed) % TUNICS.length) + Math.abs(id) * 5) % TUNICS.length];
  const skin = SKINS[Math.abs(id + seed) % SKINS.length];
  const hair = HAIR[Math.abs(id * 3 + seed) % HAIR.length];

  const pixel = (x: number, y: number, color: Color): void => {
    if (x >= 0 && x < width && y >= 0 && y < height) data.set(color, (y * width + x) * 4);
  };
  const rect = (left: number, top: number, right: number, bottom: number, color: Color): void => {
    for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) pixel(x, y, color);
  };

  // Boots and two separate legs give the unit a clear silhouette among trees.
  rect(5, 17, 8, 21, INK); rect(9, 17, 12, 21, INK);
  rect(6, 17, 8, 20, shade(tunic, .58)); rect(9, 17, 11, 20, shade(tunic, .58));
  rect(4, 20, 8, 22, INK); rect(9, 20, 13, 22, INK);
  rect(5, 20, 8, 21, BOOT); rect(10, 20, 12, 21, BOOT);

  // Blocky arms, a short tunic and a single-pixel belt buckle.
  rect(2, 10, 5, 17, INK); rect(12, 10, 15, 17, INK);
  rect(3, 11, 5, 14, shade(tunic, .72)); rect(12, 11, 14, 14, shade(tunic, .72));
  rect(3, 14, 5, 16, skin); rect(12, 14, 14, 16, skin);
  rect(4, 10, 13, 18, INK);
  rect(5, 11, 12, 16, tunic);
  rect(5, 11, 7, 15, shade(tunic, 1.16));
  rect(5, 15, 12, 16, BELT); pixel(8, 15, [234, 198, 110, 255]);
  rect(5, 16, 12, 17, shade(tunic, .72));

  // Square head, flat hair and only two face pixels: readable when zoomed out.
  rect(7, 8, 10, 11, INK); rect(7, 8, 10, 10, skin);
  rect(5, 2, 11, 3, INK); rect(4, 3, 12, 9, INK);
  rect(5, 4, 11, 9, skin);
  rect(5, 3, 11, 5, hair); rect(4, 4, 6, 6, hair); rect(10, 4, 12, 6, hair);
  pixel(6, 6, INK); pixel(9, 6, INK);
  rect(7, 8, 9, 9, shade(skin, .78));

  if (carrying) {
    // The ochre pack is an unmistakable state change, without altering the face or tunic.
    rect(12, 12, 16, 19, INK);
    rect(13, 13, 16, 18, BAG);
    rect(13, 13, 15, 14, shade(BAG, 1.18));
    pixel(14, 16, shade(BAG, .7));
  }

  return { width, height, data };
}
