import type { Building, GroundPoint, ResourceKind, ResourceNode } from "./protocol";

const MOD = 2_147_483_647;
export const RESOURCE_AMOUNTS: Record<ResourceKind, number> = { wood: 160, stone: 480, gold: 520 };
export const RESOURCE_COUNTS = { wood: 104, stone: 8, gold: 6 } as const;
const STARTER_GROVE = { x: 13, z: 13 };

const distance = (a: GroundPoint, b: GroundPoint): number => Math.hypot(a.x - b.x, a.z - b.z);

export function generateMap(seed: number): { enemy: Building; resources: ResourceNode[] } {
  let random = Number.isSafeInteger(seed) ? Math.abs(seed) % (MOD - 1) || 1 : 12_345;
  const next = (span: number): number => {
    random = random * 48_271 % MOD;
    return Math.round((random / MOD * span * 2 - span) * 10) / 10;
  };
  const enemy: Building = { id: 2, owner: "enemy", x: 38, z: 38, hp: 250, max_hp: 250, progress: 100 };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = { x: next(48), z: next(48) };
    if (distance(candidate, { x: 0, z: 0 }) >= 34) { enemy.x = candidate.x; enemy.z = candidate.z; break; }
  }

  const resources: ResourceNode[] = [];
  const add = (kind: ResourceKind, point: GroundPoint): void => {
    const amount = RESOURCE_AMOUNTS[kind];
    resources.push({ id: resources.length + 1, kind, ...point, amount, initial_amount: amount });
  };
  add("stone", { x: 14, z: -12 });
  add("gold", { x: -14, z: 12 });
  for (const [kind, count] of [["stone", RESOURCE_COUNTS.stone - 1], ["gold", RESOURCE_COUNTS.gold - 1]] as const) {
    for (let placed = 0, attempts = 0; placed < count && attempts < 10_000; attempts += 1) {
      const point = { x: next(47), z: next(47) };
      if (distance(point, { x: 0, z: 0 }) < 11 || distance(point, enemy) < 8 ||
          resources.some((r) => distance(point, r) < 8)) continue;
      add(kind, point); placed += 1;
    }
  }

  const centers: GroundPoint[] = [STARTER_GROVE];
  const chooseCenter = (span: number, fromHome: number, fromEnemy: number, fromOther: number): GroundPoint => {
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      const point = { x: next(span), z: next(span) };
      if (distance(point, { x: 0, z: 0 }) < fromHome || distance(point, enemy) < fromEnemy ||
          centers.some((center) => distance(point, center) < fromOther)) continue;
      centers.push(point); return point;
    }
    throw new Error("Unable to place a forest cluster");
  };
  const placeTrees = (center: GroundPoint, count: number, radius: number): void => {
    for (let placed = 0, attempts = 0; placed < count && attempts < 20_000; attempts += 1) {
      const dx = next(radius), dz = next(radius);
      if (Math.hypot(dx, dz) > radius) continue;
      const point = { x: Math.round((center.x + dx) * 10) / 10, z: Math.round((center.z + dz) * 10) / 10 };
      if (Math.abs(point.x) > 48 || Math.abs(point.z) > 48 ||
          distance(point, { x: 0, z: 0 }) < 9 || distance(point, enemy) < 8 ||
          resources.some((r) => distance(point, r) < (r.kind === "wood" ? 2.3 : 4.5))) continue;
      add("wood", point); placed += 1;
    }
  };
  placeTrees(STARTER_GROVE, 8, 7.5);
  for (let i = 0; i < 3; i += 1) placeTrees(chooseCenter(34, 24, 14, 21), 22, 12.5);
  for (let i = 0; i < 5; i += 1) placeTrees(chooseCenter(40, 18, 11, 13), 6, 6.5);
  return { enemy, resources };
}
