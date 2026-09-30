import type { Building, GroundPoint, ResourceNode } from "./protocol";

const GRID = 2;
const UNIT_RADIUS = 0.45;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

interface Obstacle extends GroundPoint { radius: number }

function obstacles(resources: ResourceNode[], buildings: Building[]): Obstacle[] {
  return [
    ...resources.filter((item) => item.amount > 0).map((item) => ({ x: item.x, z: item.z, radius: (item.kind === "wood" ? 0.9 : 2) + UNIT_RADIUS })),
    ...buildings.filter((item) => item.hp > 0).map((item) => ({ x: item.x, z: item.z, radius: 2.45 + UNIT_RADIUS })),
  ];
}

function segmentClear(a: GroundPoint, b: GroundPoint, obstacles: Obstacle[]): boolean {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  return obstacles.every((item) => {
    const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((item.x - a.x) * dx + (item.z - a.z) * dz) / lengthSquared));
    const x = a.x + projection * dx - item.x, z = a.z + projection * dz - item.z;
    return x * x + z * z >= item.radius * item.radius - 1e-9;
  });
}

function approach(a: GroundPoint, target: GroundPoint, range: number): GroundPoint {
  const dx = target.x - a.x, dz = target.z - a.z;
  const distance = Math.hypot(dx, dz);
  const travel = Math.max(0, distance - range);
  return distance === 0 ? a : { x: a.x + dx / distance * travel, z: a.z + dz / distance * travel };
}

export function clearApproach(a: GroundPoint, target: GroundPoint, range: number, resources: ResourceNode[], buildings: Building[]): boolean {
  return segmentClear(a, approach(a, target, range), obstacles(resources, buildings));
}

export function walkable(point: GroundPoint, radius: number, resources: ResourceNode[], buildings: Building[]): boolean {
  if (Math.abs(point.x) > radius - 3 || Math.abs(point.z) > radius - 3) return false;
  return obstacles(resources, buildings).every((item) => (point.x - item.x) ** 2 + (point.z - item.z) ** 2 >= item.radius ** 2 - 1e-9);
}

export function findRoute(start: GroundPoint, target: GroundPoint, range: number, radius: number, resources: ResourceNode[], buildings: Building[]): GroundPoint[] | null {
  const blockers = obstacles(resources, buildings);
  const clear = (a: GroundPoint, b: GroundPoint) => segmentClear(a, b, blockers);
  if (clear(start, approach(start, target, range))) return [];

  const limit = Math.floor((radius - 3) / GRID);
  const origin = { x: Math.round(start.x / GRID), z: Math.round(start.z / GRID) };
  const key = (point: GroundPoint) => `${point.x},${point.z}`;
  const queue: GroundPoint[] = []; let head = 0;
  const visited = new Set<string>();
  const previous = new Map<string, GroundPoint | null>();
  for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) {
    const cell = { x: origin.x + dx, z: origin.z + dz };
    const point = { x: cell.x * GRID, z: cell.z * GRID };
    if (Math.abs(cell.x) > limit || Math.abs(cell.z) > limit || Math.hypot(point.x - start.x, point.z - start.z) > 4.5 || !clear(start, point) || blockers.some((item) => (point.x - item.x) ** 2 + (point.z - item.z) ** 2 < item.radius ** 2 - 1e-9)) continue;
    const id = key(cell); visited.add(id); previous.set(id, null); queue.push(cell);
  }
  while (head < queue.length) {
    const cell = queue[head++];
    const point = { x: cell.x * GRID, z: cell.z * GRID };
    const distance = Math.hypot(point.x - target.x, point.z - target.z);
    if (distance <= Math.max(1.5, range + 0.75) && clear(point, approach(point, target, range))) {
      const route: GroundPoint[] = [];
      let current: GroundPoint | null = cell;
      while (current) {
        route.push({ x: current.x * GRID, z: current.z * GRID });
        current = previous.get(key(current))!;
      }
      return route.reverse();
    }
    for (const [dx, dz] of DIRECTIONS) {
      const next = { x: cell.x + dx, z: cell.z + dz };
      const nextKey = key(next);
      if (Math.abs(next.x) > limit || Math.abs(next.z) > limit || visited.has(nextKey)) continue;
      const nextPoint = { x: next.x * GRID, z: next.z * GRID };
      if (!clear(point, nextPoint) || blockers.some((item) => (nextPoint.x - item.x) ** 2 + (nextPoint.z - item.z) ** 2 < item.radius ** 2 - 1e-9)) continue;
      visited.add(nextKey); previous.set(nextKey, cell); queue.push(next);
    }
  }
  return null;
}
