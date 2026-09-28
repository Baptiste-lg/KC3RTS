import type { GroundPoint } from "../game/protocol";

export interface ActionTarget extends GroundPoint { intervalTicks: number }
export interface UnitPose { x: number; z: number; lift: number }

export function actionPulse(visualTick: number, id: number, intervalTicks: number): number {
  const interval = Math.max(1, intervalTicks);
  const phase = ((visualTick + id) % interval + interval) % interval;
  const preparation = Math.min(.8, interval * .25);
  const recovery = Math.min(1.5, interval * .45);
  if (phase < recovery) return 1 - phase / recovery;
  const untilImpact = interval - phase;
  return untilImpact < preparation ? 1 - untilImpact / preparation : 0;
}

export function unitPose(position: GroundPoint, visualTick: number, id: number, moving: boolean, target: ActionTarget | null): UnitPose {
  if (moving) {
    const step = Math.max(0, Math.sin(visualTick * Math.PI * .64 + id * .6));
    return { x: 0, z: 0, lift: step * .38 };
  }
  if (!target) return { x: 0, z: 0, lift: 0 };
  const distance = Math.hypot(target.x - position.x, target.z - position.z);
  if (distance < .01) return { x: 0, z: 0, lift: 0 };
  const pulse = actionPulse(visualTick, id, target.intervalTicks);
  const reach = Math.min(1.15, distance * .4) * pulse;
  return {
    x: (target.x - position.x) / distance * reach,
    z: (target.z - position.z) / distance * reach,
    lift: .16 * pulse,
  };
}
