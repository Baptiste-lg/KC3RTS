import { describe, expect, it } from "vitest";
import { mapToMini, miniToMap } from "./minimap";

describe("minimap coordinates", () => {
  it("maps the center and corners to pixels and back", () => {
    expect(mapToMini({ x: 0, z: 0 }, 32, 192)).toEqual({ x: 96, z: 96 });
    expect(mapToMini({ x: -32, z: 32 }, 32, 192)).toEqual({ x: 0, z: 192 });
    expect(miniToMap(192, 0, 32, 192)).toEqual({ x: 32, z: -32 });
    expect(miniToMap(400, -5, 32, 192)).toEqual({ x: 32, z: -32 });
  });
});
