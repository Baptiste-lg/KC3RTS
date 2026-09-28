import { describe, expect, it } from "vitest";
import { facingFromMovement } from "./unit_facing";

describe("screen-facing direction", () => {
  it("flips on horizontal travel and keeps its side during vertical travel or a stop", () => {
    expect(facingFromMovement(1, -1, "left")).toBe("right");
    expect(facingFromMovement(-1, 1, "right")).toBe("left");
    expect(facingFromMovement(1, 1, "left")).toBe("left");
    expect(facingFromMovement(0, 0, "left")).toBe("left");
  });
});
