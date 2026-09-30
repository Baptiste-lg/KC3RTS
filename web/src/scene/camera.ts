import { OrthographicCamera } from "three";

interface CameraFraming {
  baseHeight: number;
  minimumWidth: number;
}

export function createIsometricCamera(aspect: number, mapRadius: number, elevation = 30): OrthographicCamera {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, mapRadius * 12);
  const distance = mapRadius * 2.8;
  camera.position.set(distance, Math.SQRT2 * distance * Math.tan(elevation * Math.PI / 180), distance);
  camera.lookAt(0, 0, 0);
  camera.userData.framing = {
    baseHeight: Math.min(mapRadius * 1.2, 42),
    minimumWidth: Math.min(mapRadius * 1.8, 64),
  } satisfies CameraFraming;
  resizeIsometricCamera(camera, aspect);
  camera.updateMatrixWorld();
  return camera;
}

export function resizeIsometricCamera(camera: OrthographicCamera, aspect: number): void {
  const { baseHeight, minimumWidth } = camera.userData.framing as CameraFraming;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const height = Math.max(baseHeight, minimumWidth / safeAspect);
  camera.left = (-height * safeAspect) / 2;
  camera.right = (height * safeAspect) / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();
}
