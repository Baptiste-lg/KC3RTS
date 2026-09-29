import type { ResourceKind } from "./protocol";

export const TICKS_PER_SECOND = 10;
export const GATHER_INTERVAL_TICKS = 3;
export const DEFAULT_ATTACK_INTERVAL_TICKS = 6;
export const ATTACK_RANGE = 6;
export const UNIT_HITBOX_RADIUS = 0.45;

export function gatherRange(kind: ResourceKind): number {
  return kind === "wood" ? 3 : 4.3;
}
