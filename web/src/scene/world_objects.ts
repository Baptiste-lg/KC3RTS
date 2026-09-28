import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from "three";
import type { ResourceNode } from "../game/protocol";
import { generateVillagerPixels } from "./villager_pixels";

const stone = new MeshStandardMaterial({ color: 0x746d59, roughness: 1, flatShading: true });
const darkStone = new MeshStandardMaterial({ color: 0x4b4d49, roughness: 1, flatShading: true });
const wood = new MeshStandardMaterial({ color: 0x76523b, roughness: 1, flatShading: true });
const roof = new MeshStandardMaterial({ color: 0x9a6748, roughness: 1, flatShading: true });
const trim = new MeshStandardMaterial({ color: 0xe0bf7c, roughness: 0.85, flatShading: true });

function addMesh(
  parent: Group,
  geometry: BoxGeometry | ConeGeometry | CylinderGeometry,
  material: MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function createGround(radius: number): Group {
  const ground = new Group();
  ground.name = "ground";

  const slab = new Mesh(
    new BoxGeometry(radius * 2, 1.2, radius * 2),
    new MeshStandardMaterial({ color: 0x304b3a, roughness: 1, flatShading: true }),
  );
  slab.position.y = -0.65;
  slab.receiveShadow = true;
  ground.add(slab);

  const surface = new Mesh(
    new PlaneGeometry(radius * 2, radius * 2),
    new MeshStandardMaterial({ color: 0x4a7153, roughness: 1, side: DoubleSide }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.005;
  surface.receiveShadow = true;
  ground.add(surface);

  const grid = new GridHelper(radius * 2, radius * 2, 0x86a77c, 0x648a62);
  grid.position.y = 0.025;
  ground.add(grid);

  const borderMaterial = new MeshBasicMaterial({ color: 0x719b72 });
  for (const edge of [-radius, radius]) {
    const horizontal = new Mesh(new BoxGeometry(radius * 2 + 0.5, 0.08, 0.16), borderMaterial);
    horizontal.position.set(0, 0.065, edge);
    ground.add(horizontal);
    const vertical = new Mesh(new BoxGeometry(0.16, 0.08, radius * 2 + 0.5), borderMaterial);
    vertical.position.set(edge, 0.065, 0);
    ground.add(vertical);
  }

  return ground;
}

export function createTownCenter(): Group {
  const center = new Group();
  center.name = "town-center";

  addMesh(center, new CylinderGeometry(4, 4.4, 0.5, 8), stone, 0, 0.25, 0);
  addMesh(center, new BoxGeometry(4.8, 3.1, 4.7), darkStone, 0, 2.05, 0);
  addMesh(center, new BoxGeometry(5.15, 0.35, 5.05), trim, 0, 3.68, 0);
  const roofMesh = addMesh(center, new ConeGeometry(4.15, 2.9, 4), roof, 0, 5.1, 0);
  roofMesh.rotation.y = Math.PI / 4;

  // A front door and two lit windows make the single usable building clear.
  addMesh(center, new BoxGeometry(1.4, 2.1, 0.12), wood, 0, 1.35, 2.42);
  addMesh(center, new BoxGeometry(0.18, 2.1, 0.16), trim, -0.75, 1.35, 2.48);
  addMesh(center, new BoxGeometry(0.18, 2.1, 0.16), trim, 0.75, 1.35, 2.48);
  for (const x of [-1.55, 1.55]) {
    addMesh(center, new BoxGeometry(0.8, 0.8, 0.13), trim, x, 2.15, 2.43);
    addMesh(center, new BoxGeometry(0.12, 0.85, 0.15), wood, x, 2.15, 2.52);
  }

  addMesh(center, new CylinderGeometry(0.12, 0.12, 2.2, 6), wood, 0, 7.4, 0);
  addMesh(center, new BoxGeometry(1.4, 0.8, 0.08), trim, 0.7, 7.9, 0);
  return center;
}

export function createResourceNode(node: ResourceNode): Group {
  const group = new Group();
  group.name = `resource-${node.id}`;
  group.position.set(node.x, 0, node.z);

  const hue = (node.id * 47) % 360;
  const crystal = new MeshStandardMaterial({
    color: `hsl(${hue}, 42%, 64%)`,
    roughness: 0.38,
    metalness: 0.1,
    flatShading: true,
  });

  addMesh(group, new CylinderGeometry(1.2, 1.45, 0.3, 7), stone, 0, 0.15, 0);
  const main = addMesh(group, new ConeGeometry(0.78, 2.8, 5), crystal, 0, 1.65, 0);
  main.rotation.z = (node.id % 3 - 1) * 0.08;
  addMesh(group, new ConeGeometry(0.47, 1.65, 5), crystal, -0.82, 1.03, 0.25);
  addMesh(group, new ConeGeometry(0.38, 1.35, 5), crystal, 0.76, 0.88, -0.35);

  return group;
}

export function createVillagerSprite(id: number, carrying: boolean): Sprite {
  const pixels = generateVillagerPixels(id, carrying);
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required for procedural villagers");

  const image = context.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  context.putImageData(image, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;

  const sprite = new Sprite(
    new SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.05, depthWrite: false }),
  );
  sprite.name = `villager-${id}`;
  sprite.center.set(0.5, 0);
  sprite.scale.set(2.15, 3.25, 1);
  sprite.position.y = 0.04;
  return sprite;
}
