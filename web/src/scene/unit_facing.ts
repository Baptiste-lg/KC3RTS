export type UnitFacing = "left" | "right";

// The fixed isometric camera looks down the (1, 1, 1) diagonal.
export function facingFromMovement(dx: number, dz: number, previous: UnitFacing): UnitFacing {
  if (Math.hypot(dx, dz) < .01) return previous;
  const screenX = dx - dz;
  if (Math.abs(screenX) < Math.hypot(dx, dz) * .12) return previous;
  return screenX > 0 ? "right" : "left";
}
