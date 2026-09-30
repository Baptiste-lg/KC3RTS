import { PixelArt, PIXEL_UNIT, PALETTE } from "./pixel_art";
import type { GridMap } from "../game/kc3_view";
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
} from "three";
import type { ResourceNode } from "../game/protocol";
import { generateVillagerPixels } from "./villager_pixels";
import type { UnitFacing } from "./unit_facing";

const outline = PALETTE.ink;

function hash(x: number, y: number): number {
  let value = Math.imul(x + 1169, 374761393) + Math.imul(y + 313, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return (value ^ value >>> 16) >>> 0;
}

function sprite(art: PixelArt): Sprite {
  const result = new Sprite(new SpriteMaterial({ map: art.texture(), transparent: true, alphaTest: .05, depthWrite: false }));
  result.center.set(.5, 0); result.scale.set(art.width * PIXEL_UNIT, art.height * PIXEL_UNIT, 1); result.position.y = .04;
  return result;
}

export function createGround(radius: number, map?: GridMap): Group {
  const group = new Group(); group.name = "ground";
  const surroundings = new Mesh(new PlaneGeometry(radius * 12, radius * 12),
    new MeshBasicMaterial({ color: 0x274d39, side: DoubleSide }));
  surroundings.rotation.x = -Math.PI / 2; surroundings.position.y = -.02; group.add(surroundings);

  const width = map ? map.width * map.cell_size / 256 : radius * 2;
  const height = map ? map.height * map.cell_size / 256 : radius * 2;
  const art = new PixelArt(Math.ceil(width / PIXEL_UNIT), Math.ceil(height / PIXEL_UNIT));
  const grass = [PALETTE.grass, PALETTE.grassLight, PALETTE.grassShade];
  for (let y = 0; y < art.height; y += 1) {
    for (let x = 0; x < art.width; x += 1) {
      const broad = Math.sin(x / 43 + Math.sin(y / 39)) + Math.cos(y / 57 + x / 91);
      const h = hash(x, y);
      const path = Math.abs(y - art.height / 2 - 16) < 5 + (hash(x >> 3, 2) % 3);
      const edge = x < 3 || y < 3 || x >= art.width - 3 || y >= art.height - 3;
      art.pixel(x, y, edge ? PALETTE.leafShade : path ? (h % 9 === 0 ? PALETTE.dust : PALETTE.dirt) : grass[broad < -1.3 ? 2 : broad > 1.1 ? 1 : 0]);
      if (!path && !edge && h % 233 === 0) art.rect(x, y, 1, 2, PALETTE.leafLight);
    }
  }
  const surface = new Mesh(new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: art.texture(), side: DoubleSide }));
  surface.rotation.x = -Math.PI / 2; surface.position.y = 0; group.add(surface);
  return group;
}

function buildingArt(enemy: boolean, artKey: string): PixelArt {
  const art = new PixelArt(64, 64);
  const mage = artKey.startsWith("lantern.");
  const roof = mage ? PALETTE.indigo : PALETTE.teal;
  const roofLight = mage ? PALETTE.indigoLight : PALETTE.tealLight;
  art.ellipse(33, 57, 27, 5, PALETTE.shadow);
  art.polygon([[7, 48], [32, 37], [58, 47], [34, 61]], outline);
  art.polygon([[10, 48], [32, 39], [55, 47], [34, 58]], PALETTE.stoneShade);
  art.polygon([[12, 28], [33, 35], [54, 26], [54, 47], [33, 56], [12, 47]], outline);
  art.polygon([[14, 30], [33, 37], [33, 53], [14, 45]], mage ? PALETTE.ivory : PALETTE.copper);
  art.polygon([[34, 37], [52, 29], [52, 46], [34, 53]], mage ? PALETTE.stone : PALETTE.copperShade);
  art.polygon([[6, 29], [26, 12], [59, 27], [34, 40]], outline);
  art.polygon([[9, 28], [26, 15], [53, 27], [33, 36]], roofLight);
  art.polygon([[33, 36], [53, 27], [56, 28], [34, 38]], roof);
  for (let i = 0; i < 4; i++) art.rect(18 + i * 7, 25 + i % 2 * 2, 4, 1, roof);
  // Door is 16 source pixels high, comparable to the 18-pixel workers.
  art.rect(21, 37, 10, 16, outline); art.rect(23, 39, 6, 13, PALETTE.wood);
  art.rect(23, 39, 1, 12, PALETTE.woodLight); art.pixel(28, 45, PALETTE.goldLight);
  art.rect(42, 36, 6, 7, outline); art.rect(43, 37, 4, 5, PALETTE.gold);
  art.rect(44, 37, 1, 5, PALETTE.light);
  if (mage) {
    art.polygon([[24, 15], [31, 3], [38, 17], [31, 21]], outline);
    art.polygon([[27, 15], [31, 7], [35, 16], [31, 18]], PALETTE.indigo);
    art.rect(12, 30, 2, 12, PALETTE.wood); art.rect(9, 35, 7, 7, outline);
    art.rect(10, 36, 5, 5, PALETTE.goldLight); art.rect(12, 36, 1, 5, PALETTE.gold);
    art.ellipse(32, 27, 4, 3, PALETTE.ivory); art.ellipse(32, 27, 2, 1, roofLight);
  } else {
    // Two squat kiln flues and a stepped ceramic cornice.
    art.rect(10, 12, 9, 14, outline); art.rect(12, 13, 5, 12, PALETTE.copper);
    art.rect(9, 11, 11, 3, PALETTE.stoneLight); art.rect(11, 12, 7, 1, PALETTE.ink);
    art.rect(44, 16, 8, 9, outline); art.rect(46, 17, 4, 7, PALETTE.copperShade);
    art.rect(43, 15, 10, 3, PALETTE.stone); art.rect(45, 16, 6, 1, PALETTE.ink);
    art.rect(29, 27, 6, 6, PALETTE.copperLight); art.rect(31, 29, 2, 2, PALETTE.copperShade);
  }
  art.rect(50, 40, 3, 8, enemy ? PALETTE.red : PALETTE.blue);
  return art;
}
function outbuildingArt(artKey: string, enemy: boolean): PixelArt {
  const kind = artKey.split(".").at(-1);
  const mage = artKey.startsWith("lantern.");
  const art = new PixelArt(40, 40);
  const roof = mage ? PALETTE.indigo : PALETTE.teal;
  const trim = mage ? PALETTE.ivory : PALETTE.copper;
  art.ellipse(20, 35, 17, 4, PALETTE.shadow);
  if (kind === "farm") {
    art.polygon([[2, 25], [19, 17], [38, 25], [21, 36]], PALETTE.wood);
    art.polygon([[5, 25], [19, 19], [34, 25], [21, 33]], PALETTE.dirt);
    for (let row = 0; row < 3; row++) for (let plant = 0; plant < 4; plant++) {
      const x = 10 + plant * 5 - row * 2, y = 22 + row * 3;
      art.rect(x, y, 1, 4, PALETTE.leafShade); art.rect(x - 1, y, 3, 2, PALETTE.leafLight);
    }
    art.rect(3, 23, 1, 10, PALETTE.woodLight); art.rect(35, 23, 1, 10, PALETTE.woodLight);
    if (mage) {
      art.rect(34, 13, 1, 10, PALETTE.wood); art.rect(31, 15, 7, 7, outline);
      art.rect(32, 16, 5, 5, PALETTE.goldLight); art.pixel(34, 17, PALETTE.light);
    } else {
      art.rect(30, 21, 7, 7, outline); art.rect(31, 22, 5, 5, PALETTE.copper);
      art.rect(32, 18, 2, 6, PALETTE.stoneLight); art.rect(29, 18, 5, 1, PALETTE.woodLight);
    }
    art.rect(3, 25, 2, 4, enemy ? PALETTE.red : PALETTE.blue);
    return art;
  }
  art.polygon([[7, 20], [20, 14], [34, 20], [34, 30], [21, 37], [7, 30]], outline);
  art.polygon([[9, 21], [20, 17], [20, 34], [9, 29]], trim);
  art.polygon([[21, 17], [32, 21], [32, 29], [21, 34]], PALETTE.stoneShade);
  art.polygon([[3, 21], [18, 7], [37, 20], [21, 27]], outline);
  art.polygon([[6, 20], [18, 10], [33, 20], [21, 24]], roof);
  art.rect(13, 25, 6, 10, outline); art.rect(14, 26, 3, 8, PALETTE.wood);
  art.rect(28, 25, 2, 7, enemy ? PALETTE.red : PALETTE.blue);
  if (kind === "depot") {
    for (let i = 0; i < 3; i++) { art.rect(24 + i * 4, 29 - i % 2 * 3, 4, 5, outline); art.rect(25 + i * 4, 30 - i % 2 * 3, 2, 3, PALETTE.woodLight); }
    art.rect(15, 16, 7, 5, PALETTE.gold);
  } else if (kind === "barracks") {
    art.rect(5, 15, 1, 17, PALETTE.woodLight); art.rect(32, 13, 1, 16, PALETTE.woodLight);
    art.polygon([[3, 16], [5, 10], [7, 16]], PALETTE.stoneLight);
    art.rect(15, 15, 7, 7, PALETTE.stoneLight); art.rect(17, 16, 3, 5, roof);
  } else if (kind === "range") {
    art.rect(32, 25, 1, 11, PALETTE.wood); art.ellipse(32, 27, 6, 6, PALETTE.ivory);
    art.ellipse(32, 27, 4, 4, PALETTE.red); art.ellipse(32, 27, 2, 2, PALETTE.ivory);
  } else { art.rect(9, 7, 4, 9, PALETTE.stoneShade); art.rect(8, 6, 6, 2, PALETTE.stoneLight); }
  return art;
}
function berryArt(): PixelArt {
  const art = new PixelArt(32, 24);
  art.ellipse(16, 21, 13, 2, PALETTE.shadow);
  art.ellipse(16, 14, 13, 8, PALETTE.leafShade); art.ellipse(13, 12, 9, 6, PALETTE.leaf);
  for (const [x, y] of [[7, 13], [12, 9], [18, 13], [24, 14], [13, 17]]) {
    art.rect(x, y, 3, 3, PALETTE.red); art.pixel(x, y, PALETTE.copperLight);
  }
  return art;
}
export function createTownCenter(artKey = "kiln.concord.hall", enemy = false): Group {
  const group = new Group(); group.name = enemy ? "enemy-base" : "town-center";
  group.add(sprite(artKey.endsWith(".hall") ? buildingArt(enemy, artKey) : outbuildingArt(artKey, enemy))); return group;
}
export function createEnemyBase(): Group { return createTownCenter("lantern.synod.hall", true); }

function treeArt(id: number): PixelArt {
  const art = new PixelArt(32, 48);
  const shift = id % 3;
  art.ellipse(16, 44, 12, 3, PALETTE.shadow);
  art.rect(13, 27, 7, 17, outline); art.rect(15, 28, 4, 15, PALETTE.woodLight);
  art.ellipse(16, 23, 14, 18, outline);
  art.ellipse(15, 21, 12, 15, PALETTE.leafShade);
  art.ellipse(11 + shift, 16, 8, 8, PALETTE.leafLight);
  art.ellipse(21, 23, 8, 9, PALETTE.leaf);
  for (let i = 0; i < 13; i += 1) {
    const x = 6 + hash(id, i) % 20, y = 9 + hash(i, id) % 21;
    if (art.data[(y * 32 + x) * 4 + 3]) art.rect(x, y, 2, 1, PALETTE.leafLight);
  }
  return art;
}

function rockArt(gold: boolean): PixelArt {
  const art = new PixelArt(32, 32);
  art.ellipse(16, 27, 14, 4, PALETTE.shadow);
  art.polygon([[2, 23], [7, 14], [14, 10], [23, 13], [30, 22], [27, 28], [6, 28]], outline);
  art.polygon([[4, 22], [9, 15], [15, 12], [22, 15], [27, 22], [25, 26], [6, 26]], PALETTE.stone);
  art.polygon([[15, 12], [22, 15], [27, 22], [25, 26], [16, 26]], PALETTE.stoneShade);
  art.rect(8, 19, 5, 2, PALETTE.stoneLight);
  if (gold) {
    art.polygon([[9, 19], [14, 14], [18, 16], [16, 22], [11, 24]], PALETTE.gold);
    art.rect(10, 18, 3, 2, PALETTE.goldLight);
    art.rect(21, 21, 5, 3, PALETTE.gold);
    art.rect(22, 21, 2, 1, PALETTE.goldLight);
  }
  return art;
}

export function createResourceNode(node: ResourceNode): Group {
  const group = new Group(); group.name = `resource-${node.id}`;
  group.userData = { kind: "resource", id: node.id };
  group.position.set(node.x, 0, node.z);
  group.add(sprite(node.art === "core.food" ? berryArt() : node.kind === "wood" ? treeArt(node.id) : rockArt(node.kind === "gold")));
  return group;
}

export function createVillagerSprite(id: number, carrying: boolean, seed = 1, facing: UnitFacing = "right", artKey = "kiln.concord.worker", enemy = false): Sprite {
  const pixels = generateVillagerPixels(id, carrying, seed, facing, artKey, enemy);
  const art = new PixelArt(pixels.width, pixels.height);
  art.data.set(pixels.data);
  const result = sprite(art);
  result.name = `villager-${id}`;
  result.userData = { kind: "villager", id, facing };
  return result;
}
