import { describe, expect, it } from "vitest";
import { actionPulse, unitPose, walkingHop } from "./unit_motion";

describe("unit motion", () => {
  it("makes one large travel arc per metre and lands between hops", () => {
    expect(walkingHop(0).lift).toBe(0);
    expect(walkingHop(.5).lift).toBeCloseTo(.65);
    expect(walkingHop(1).lift).toBe(0);
    expect(walkingHop(1.5).lift).toBeCloseTo(.65);
    expect(walkingHop(2.5).lift).toBeCloseTo(.65);
    expect(walkingHop(.25).offset).toBeLessThan(0);
    expect(walkingHop(.75).offset).toBeGreaterThan(0);
    expect(unitPose({ x: 0, z: 0 }, .5, 1, null).lift).toBe(0);
  });

  it("lunges toward a target, then returns to its standing point", () => {
    const point = { x: 0, z: 0 }, target = { x: 4, z: 0, intervalTicks: 3 };
    const impact = unitPose(point, 2, 1, target);
    expect(impact.x).toBeGreaterThan(0);
    expect(impact.x).toBeLessThanOrEqual(1.15);
    expect(impact.lift).toBeGreaterThan(0);
    expect(unitPose(point, 3.5, 1, target).x).toBe(0);
  });

  it("repeats attack lunges more often as attack intervals shorten", () => {
    const count = (interval: number) => Array.from({ length: 12 }, (_, tick) => actionPulse(tick, 1, interval)).filter((pulse) => pulse === 1).length;
    expect(count(3)).toBe(4);
    expect(count(6)).toBe(2);
  });
});
