export interface SpritePixels {
  width: 32;
  height: 48;
  data: Uint8ClampedArray;
}

type Color = readonly [number, number, number, number];

const OUTLINE: Color = [32, 31, 38, 255];
const SKIN: Color = [238, 192, 144, 255];
const SKIN_SHADE: Color = [196, 143, 109, 255];
const HAIR: Color = [76, 52, 45, 255];
const BOOTS: Color = [72, 53, 49, 255];
const GOLD: Color = [245, 185, 72, 255];
const TUNICS: Color[] = [
  [76, 150, 185, 255], [105, 163, 107, 255], [190, 102, 97, 255],
  [139, 119, 187, 255], [193, 142, 76, 255], [72, 159, 151, 255],
  [181, 110, 149, 255], [114, 141, 193, 255], [167, 155, 79, 255],
  [111, 168, 154, 255], [194, 119, 74, 255], [132, 112, 158, 255],
];
const shade = (color: Color, factor: number): Color => [
  Math.round(color[0] * factor), Math.round(color[1] * factor), Math.round(color[2] * factor), 255,
];

export function generateVillagerPixels(id: number, carrying: boolean, seed = 1): SpritePixels {
  const width = 32 as const;
  const height = 48 as const;
  const data = new Uint8ClampedArray(width * height * 4);
  const tunic = TUNICS[((Math.abs(seed) % TUNICS.length) + Math.abs(id) * 5) % TUNICS.length];
  const tunicShade = shade(tunic, .7);
  const tunicHighlight = shade(tunic, 1.16);

  function pixel(x: number, y: number, color: Color): void {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    data.set(color, (y * width + x) * 4);
  }

  function rect(left: number, top: number, right: number, bottom: number, color: Color): void {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) pixel(x, y, color);
    }
  }

  function ellipse(cx: number, cy: number, rx: number, ry: number, color: Color): void {
    for (let y = cy - ry; y <= cy + ry; y += 1) {
      for (let x = cx - rx; x <= cx + rx; x += 1) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) pixel(x, y, color);
      }
    }
  }

  // Feet and shadowed legs.
  rect(9, 34, 16, 43, OUTLINE);
  rect(17, 34, 24, 43, OUTLINE);
  rect(10, 35, 15, 41, BOOTS);
  rect(18, 35, 23, 41, BOOTS);
  rect(8, 42, 16, 45, OUTLINE);
  rect(17, 42, 25, 45, OUTLINE);

  // Arms sit behind the tunic. A small bag appears only when carrying cargo.
  rect(5, 21, 10, 34, OUTLINE);
  rect(6, 22, 9, 31, SKIN_SHADE);
  rect(23, 21, 28, 34, OUTLINE);
  rect(24, 22, 27, 31, SKIN);
  if (carrying) {
    rect(23, 24, 31, 34, OUTLINE);
    rect(24, 25, 30, 33, GOLD);
    rect(26, 26, 29, 28, SKIN_SHADE);
  }

  rect(9, 18, 24, 36, OUTLINE);
  rect(10, 19, 23, 34, tunicShade);
  rect(11, 20, 21, 31, tunic);
  rect(11, 21, 14, 30, tunicHighlight);
  rect(10, 30, 23, 32, GOLD);
  rect(10, 31, 23, 34, SKIN_SHADE);
  rect(16, 20, 18, 30, GOLD);
  rect(15, 31, 18, 33, OUTLINE);
  rect(12, 36, 14, 39, [112, 91, 70, 255]);
  rect(20, 36, 22, 39, [112, 91, 70, 255]);

  // Rounded face, hair and two readable eyes at pixel scale.
  ellipse(16, 11, 8, 9, OUTLINE);
  ellipse(16, 12, 7, 8, SKIN);
  ellipse(16, 6, 7, 4, HAIR);
  rect(10, 7, 12, 12, HAIR);
  rect(20, 7, 22, 12, HAIR);
  rect(12, 13, 14, 15, OUTLINE);
  rect(19, 13, 21, 15, OUTLINE);
  rect(15, 17, 18, 18, SKIN_SHADE);
  rect(14, 16, 19, 17, [176, 101, 91, 255]);
  rect(9, 19, 12, 21, GOLD);
  rect(21, 19, 24, 21, GOLD);

  return { width, height, data };
}
