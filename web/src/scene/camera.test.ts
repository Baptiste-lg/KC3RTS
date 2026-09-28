import { describe, expect, it } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { createIsometricCamera, resizeIsometricCamera } from "./camera";

describe("isometric camera", () => {
  it("uses an orthographic equal-axis view centered on the town center", () => {
    const camera = createIsometricCamera(16 / 9, 32);
    const center = new Vector3(0, 0, 0).project(camera);

    expect(camera).toBeInstanceOf(OrthographicCamera);
    expect(Math.abs(camera.position.x)).toBeCloseTo(Math.abs(camera.position.z));
    expect(camera.position.y).toBeGreaterThan(0);
    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(0);
  });

  it("widens the visible field to keep the map on narrow viewports", () => {
    const camera = createIsometricCamera(16 / 9, 52);
    const height = camera.top - camera.bottom;

    resizeIsometricCamera(camera, 1);

    expect(camera.top - camera.bottom).toBeGreaterThan(height);
    expect(camera.right - camera.left).toBeCloseTo(64);
    expect(camera.top - camera.bottom).toBeCloseTo(64);
  });
});
