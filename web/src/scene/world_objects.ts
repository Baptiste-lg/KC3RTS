import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";
import type { ResourceNode } from "../game/protocol";
import { generateVillagerPixels } from "./villager_pixels";

type Ink = readonly [number, number, number, number?];
const outline: Ink = [34, 43, 42];

class PixelArt {
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

function hash(x: number, y: number): number {
  let value = Math.imul(x + 1169, 374761393) + Math.imul(y + 313, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return (value ^ value >>> 16) >>> 0;
}

function sprite(art: PixelArt, width: number, height: number): Sprite {
  const result = new Sprite(new SpriteMaterial({ map: art.texture(), transparent: true, alphaTest: .05, depthWrite: false }));
  result.center.set(.5, 0); result.scale.set(width, height, 1); result.position.y = .04;
  return result;
}

export function createGround(radius: number): Group {
  const group = new Group(); group.name = "ground";
  const surroundings = new Mesh(new PlaneGeometry(radius * 12, radius * 12),
    new MeshBasicMaterial({ color: 0x274d39, side: DoubleSide }));
  surroundings.rotation.x = -Math.PI / 2; surroundings.position.y = -.02; group.add(surroundings);

  const size = 256;
  const art = new PixelArt(size, size);
  const grass: Ink[] = [[83, 146, 89], [90, 153, 88], [76, 136, 84], [98, 158, 94], [107, 163, 93]];
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      const h = hash(x >> 2, y >> 2);
      const edge = x < 8 || y < 8 || x >= size - 8 || y >= size - 8;
      const path = Math.abs(x - size / 2 - Math.sin(y * .04) * 7) < 7 && y > size / 2 + 4 && y < size / 2 + 62;
      const color = edge ? [50, 103, 70] as Ink : path ? [147, 121, 78] as Ink : grass[h % grass.length];
      art.rect(x, y, 4, 4, color);
      if (!edge && !path && h % 7 === 0) {
        art.rect(x + 1, y + 1, 1, 2, [52, 118, 63]);
        art.pixel(x + 2, y, [143, 177, 105]);
      }
      if (!edge && h % 43 === 0) art.rect(x + 1, y + 2, 2, 1, [219, 191, 123]);
    }
  }
  const surface = new Mesh(new PlaneGeometry(radius * 2, radius * 2),
    new MeshBasicMaterial({ map: art.texture(), side: DoubleSide }));
  surface.rotation.x = -Math.PI / 2; surface.position.y = 0; group.add(surface);
  return group;
}

function buildingArt(enemy: boolean): PixelArt {
  const art = new PixelArt(64, 80);
  const roof = enemy ? [161, 68, 65] as Ink : [167, 103, 65] as Ink;
  const roofShade = enemy ? [110, 49, 54] as Ink : [114, 69, 55] as Ink;
  const wall = enemy ? [128, 110, 106] as Ink : [177, 167, 129] as Ink;
  art.ellipse(32, 72, 27, 6, [43, 67, 51, 110]);
  art.rect(10, 67, 45, 5, outline); art.rect(12, 67, 41, 3, [98, 106, 86]);
  art.polygon([[12, 34], [32, 43], [54, 34], [54, 67], [12, 67]], outline);
  art.polygon([[15, 37], [32, 44], [51, 37], [51, 65], [15, 65]], wall);
  art.polygon([[32, 44], [51, 37], [51, 65], [32, 65]], enemy ? [106, 91, 90] : [143, 128, 105]);
  art.polygon([[6, 34], [27, 16], [56, 33], [32, 47]], outline);
  art.polygon([[9, 33], [27, 19], [52, 33], [32, 43]], roof);
  art.polygon([[32, 43], [52, 33], [56, 35], [33, 48]], roofShade);
  for (let i = 0; i < 5; i += 1) {
    art.rect(18 + i * 7, 27 + (i % 2) * 3, 3, 2, roofShade);
    art.rect(19 + i * 6, 35 + (i % 2) * 2, 3, 2, [211, 149, 90]);
  }
  art.rect(20, 51, 8, 10, outline); art.rect(22, 53, 4, 6, [244, 199, 112]);
  art.rect(39, 49, 9, 16, outline); art.rect(41, 51, 5, 14, enemy ? [64, 45, 51] : [83, 69, 52]);
  art.pixel(44, 58, [240, 203, 106]);
  art.rect(28, 13, 2, 8, outline);
  art.polygon([[30, 12], [44, 15], [30, 20]], enemy ? [223, 91, 73] : [239, 205, 100]);
  return art;
}

export function createTownCenter(): Group {
  const group = new Group(); group.name = "town-center";
  group.add(sprite(buildingArt(false), 10, 12));
  return group;
}

export function createEnemyBase(): Group {
  const group = new Group(); group.name = "enemy-base";
  group.add(sprite(buildingArt(true), 10, 12));
  return group;
}

function treeArt(id: number): PixelArt {
  const art = new PixelArt(32, 48);
  const shift = id % 3;
  art.ellipse(16, 44, 12, 3, [45, 76, 53, 100]);
  art.rect(13, 27, 7, 17, outline); art.rect(15, 28, 4, 15, [111, 78, 53]);
  art.ellipse(16, 23, 14, 18, outline);
  art.ellipse(15, 21, 12, 15, [37 + shift * 4, 106 + shift * 8, 58]);
  art.ellipse(12, 16, 8, 8, [63 + shift * 4, 143 + shift * 7, 65]);
  art.ellipse(21, 23, 8, 9, [47 + shift * 3, 127 + shift * 7, 58]);
  for (let i = 0; i < 13; i += 1) {
    const x = 6 + hash(id, i) % 20, y = 9 + hash(i, id) % 21;
    if (art.data[(y * 32 + x) * 4 + 3]) art.rect(x, y, 2, 1, [130, 184, 87]);
  }
  return art;
}

function rockArt(gold: boolean): PixelArt {
  const art = new PixelArt(32, 32);
  art.ellipse(16, 27, 14, 4, [42, 69, 52, 100]);
  art.polygon([[2, 23], [7, 14], [14, 10], [23, 13], [30, 22], [27, 28], [6, 28]], outline);
  art.polygon([[4, 22], [9, 15], [15, 12], [22, 15], [27, 22], [25, 26], [6, 26]], [143, 158, 155]);
  art.polygon([[15, 12], [22, 15], [27, 22], [25, 26], [16, 26]], [104, 120, 123]);
  art.rect(8, 19, 5, 2, [202, 213, 201]);
  if (gold) {
    art.polygon([[9, 19], [14, 14], [18, 16], [16, 22], [11, 24]], [236, 177, 54]);
    art.rect(10, 18, 3, 2, [255, 228, 115]);
    art.rect(21, 21, 5, 3, [226, 162, 48]);
    art.rect(22, 21, 2, 1, [255, 230, 119]);
  }
  return art;
}

export function createResourceNode(node: ResourceNode): Group {
  const group = new Group(); group.name = `resource-${node.id}`;
  group.userData = { kind: "resource", id: node.id };
  group.position.set(node.x, 0, node.z);
  group.add(node.kind === "wood" ? sprite(treeArt(node.id), 4.5, 6.8) : sprite(rockArt(node.kind === "gold"), 4.4, 4.4));
  return group;
}

export function createVillagerSprite(id: number, carrying: boolean): Sprite {
  const pixels = generateVillagerPixels(id, carrying);
  const art = new PixelArt(pixels.width, pixels.height);
  art.data.set(pixels.data);
  const result = sprite(art, 2.15, 3.25);
  result.name = `villager-${id}`;
  result.userData = { kind: "villager", id };
  return result;
}
