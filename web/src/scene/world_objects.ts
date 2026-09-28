import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DodecahedronGeometry,
  Float32BufferAttribute,
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
  geometry: BufferGeometry,
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

  // The surrounding field keeps the camera filled with terrain while the
  // brighter square marks the playable area.
  const surroundings = new Mesh(
    new PlaneGeometry(radius * 12, radius * 12),
    new MeshStandardMaterial({ color: 0x244b32, roughness: 1, side: DoubleSide }),
  );
  surroundings.rotation.x = -Math.PI / 2;
  surroundings.position.y = -1.3;
  surroundings.receiveShadow = true;
  ground.add(surroundings);

  const slab = new Mesh(
    new BoxGeometry(radius * 2, 1.2, radius * 2),
    new MeshStandardMaterial({ color: 0x304b3a, roughness: 1, flatShading: true }),
  );
  slab.position.y = -0.65;
  slab.receiveShadow = true;
  ground.add(slab);

  const geometry = new PlaneGeometry(radius * 2, radius * 2, 64, 64);
  const positions = geometry.getAttribute("position");
  const colors: number[] = [];
  const base = new Color(0x5b8859);
  const shade = new Color();
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i), z = positions.getY(i);
    const broad = Math.sin(x * 0.27) * Math.cos(z * 0.19) * 0.045;
    const fine = Math.sin(x * 1.49 + z * 0.73) * Math.sin(z * 1.17 - x * 0.46) * 0.018;
    const dry = Math.max(0, Math.sin(x * 0.15 + 1.7) * Math.cos(z * 0.22 - 1.1)) * 0.025;
    shade.copy(base).offsetHSL(0, -dry, broad + fine - dry);
    colors.push(shade.r, shade.g, shade.b);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const surface = new Mesh(
    geometry,
    new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.025;
  surface.receiveShadow = true;
  ground.add(surface);

  const path = new Mesh(
    new PlaneGeometry(3.2, 11),
    new MeshStandardMaterial({ color: 0x8b7652, transparent: true, opacity: 0.56, roughness: 1, side: DoubleSide }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.04, 8);
  path.receiveShadow = true;
  ground.add(path);

  const borderMaterial = new MeshBasicMaterial({ color: 0x72966b });
  for (const edge of [-radius, radius]) {
    const horizontal = new Mesh(new BoxGeometry(radius * 2 + 0.5, 0.04, 0.12), borderMaterial);
    horizontal.position.set(0, 0.055, edge);
    ground.add(horizontal);
    const vertical = new Mesh(new BoxGeometry(0.12, 0.04, radius * 2 + 0.5), borderMaterial);
    vertical.position.set(edge, 0.055, 0);
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
  group.userData = { kind: "resource", id: node.id };
  group.position.set(node.x, 0, node.z);
  if (node.kind === "wood") {
    addMesh(group, new CylinderGeometry(0.34, 0.48, 2.8, 7), wood, 0, 1.4, 0);
    addMesh(group, new ConeGeometry(1.35, 2.6, 7), new MeshStandardMaterial({ color: 0x296d3d, roughness: 1, flatShading: true }), 0, 3.1, 0);
    addMesh(group, new ConeGeometry(1.05, 2.2, 7), new MeshStandardMaterial({ color: 0x38894b, roughness: 1, flatShading: true }), 0, 4.2, 0);
  } else if (node.kind === "stone") {
    const rock = new MeshStandardMaterial({ color: 0x9ea8a4, roughness: 1, flatShading: true });
    addMesh(group, new DodecahedronGeometry(1.25, 0), rock, 0, 0.9, 0);
    addMesh(group, new DodecahedronGeometry(0.85, 0), rock, 0.95, 0.65, 0.25);
    addMesh(group, new DodecahedronGeometry(0.65, 0), rock, -0.85, 0.5, -0.25);
  } else {
    const ore = new MeshStandardMaterial({ color: 0xedbb4d, roughness: 0.55, metalness: 0.25, flatShading: true });
    addMesh(group, new DodecahedronGeometry(1.15, 0), darkStone, 0, 0.8, 0);
    addMesh(group, new DodecahedronGeometry(0.55, 0), ore, -0.6, 1.25, 0.35);
    addMesh(group, new DodecahedronGeometry(0.43, 0), ore, 0.58, 1.15, -0.15);
    addMesh(group, new DodecahedronGeometry(0.36, 0), ore, 0.3, 0.5, 0.7);
  }
  return group;
}

export function createEnemyBase(): Group {
  const base = createTownCenter();
  base.name = "enemy-base";
  base.traverse((part) => {
    if (part instanceof Mesh && part.material instanceof MeshStandardMaterial) {
      part.material = part.material.clone();
      part.material.color.set(0x8f4040);
    }
  });
  return base;
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
  sprite.userData = { kind: "villager", id };
  sprite.center.set(0.5, 0);
  sprite.scale.set(2.15, 3.25, 1);
  sprite.position.y = 0.04;
  return sprite;
}
