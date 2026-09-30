import { CanvasTexture, NearestFilter, SRGBColorSpace } from "three";

export const PIXEL_UNIT = 1 / 8;
export const PALETTE = {
  ink: [38, 50, 56], shadow: [51, 68, 57, 120], grass: [100, 118, 75], grassLight: [108, 124, 80], grassShade: [91, 105, 68],
  dirt: [146, 128, 101], dust: [173, 150, 112], stone: [141, 153, 148], stoneShade: [101, 116, 122], stoneLight: [190, 193, 170],
  ivory: [213, 203, 174], light: [238, 224, 184], copper: [185, 121, 80], copperShade: [141, 89, 70], copperLight: [221, 160, 100],
  teal: [54, 111, 112], tealLight: [89, 151, 151], indigo: [75, 82, 111], indigoLight: [114, 118, 148],
  skin: [221, 174, 131], skinShade: [184, 135, 99], beard: [197, 179, 152], beardShade: [155, 137, 112],
  wood: [89, 79, 62], woodLight: [132, 112, 85], gold: [186, 152, 78], goldLight: [237, 197, 106],
  blue: [77, 148, 184], red: [188, 102, 96], leaf: [63, 87, 59], leafLight: [92, 119, 70], leafShade: [46, 67, 51],
} as const satisfies Record<string, Ink>;

export type Ink = readonly [number, number, number, number?];


export class PixelArt {
  readonly data: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  pixel(x: number, y: number, color: Ink): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const offset = (y * this.width + x) * 4;
    this.data[offset] = color[0]; this.data[offset + 1] = color[1];
    this.data[offset + 2] = color[2]; this.data[offset + 3] = color[3] ?? 255;
  }
  rect(x: number, y: number, width: number, height: number, color: Ink): void {
    for (let py = Math.max(0, y); py < Math.min(this.height, y + height); py += 1)
      for (let px = Math.max(0, x); px < Math.min(this.width, x + width); px += 1) this.pixel(px, py, color);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, color: Ink): void {
    for (let y = cy - ry; y <= cy + ry; y += 1)
      for (let x = cx - rx; x <= cx + rx; x += 1)
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) this.pixel(x, y, color);
  }
  polygon(points: readonly (readonly [number, number])[], color: Ink): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
          const a = points[i], b = points[j];
          if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
        }
        if (inside) this.pixel(x, y, color);
      }
    }
  }
  texture(): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = this.width; canvas.height = this.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is required for pixel art");
    const image = context.createImageData(this.width, this.height);
    image.data.set(this.data); context.putImageData(image, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.magFilter = NearestFilter; texture.minFilter = NearestFilter;
    texture.generateMipmaps = false; texture.colorSpace = SRGBColorSpace;
    return texture;
  }
}
