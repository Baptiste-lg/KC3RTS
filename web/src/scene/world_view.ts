import {
  AmbientLight,
  Color,
  DirectionalLight,
  MathUtils,
  PCFSoftShadowMap,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { WorldSnapshot } from "../game/protocol";
import { createIsometricCamera, resizeIsometricCamera } from "./camera";
import { SceneModel } from "./scene_model";

const CAMERA_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
]);

export class WorldView {
  private readonly scene = new Scene();
  private readonly model: SceneModel;
  private readonly camera;
  private readonly renderer: WebGLRenderer;
  private readonly cameraOrigin: Vector3;
  private readonly pan = new Vector3();
  private readonly keys = new Set<string>();
  private readonly mapRadius: number;
  private pointer: { x: number; y: number; id: number } | null = null;
  private frame = 0;
  private lastFrame = 0;

  constructor(private readonly mount: HTMLElement, snapshot: WorldSnapshot) {
    this.mapRadius = snapshot.map_radius;
    this.model = new SceneModel(snapshot);
    this.camera = createIsometricCamera(1, snapshot.map_radius);
    this.cameraOrigin = this.camera.position.clone();
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-label", "Carte isométrique du village");
    this.renderer.domElement.setAttribute("role", "img");
    this.mount.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x15271e);
    this.scene.add(this.model.root);
    this.scene.add(new AmbientLight(0xc8ddcc, 1.6));

    const sun = new DirectionalLight(0xffe6b1, 2.4);
    sun.position.set(-28, 58, 35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -52;
    sun.shadow.camera.right = 52;
    sun.shadow.camera.top = 52;
    sun.shadow.camera.bottom = -52;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);

    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.pointerUp);
    this.renderer.domElement.addEventListener("wheel", this.wheel, { passive: false });
    this.resize();
    this.frame = requestAnimationFrame(this.animate);
  }

  update(snapshot: WorldSnapshot): void {
    this.model.update(snapshot);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    this.renderer.domElement.removeEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener("pointercancel", this.pointerUp);
    this.renderer.domElement.removeEventListener("wheel", this.wheel);
    this.model.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    resizeIsometricCamera(this.camera, width / height);
    this.renderer.setSize(width, height, false);
  };

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (!CAMERA_KEYS.has(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.classList.add("dragging");
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    const dx = event.clientX - this.pointer.x;
    const dy = event.clientY - this.pointer.y;
    this.pointer.x = event.clientX;
    this.pointer.y = event.clientY;
    const unitsPerPixel =
      (this.camera.top - this.camera.bottom) / (this.mount.clientHeight * this.camera.zoom);
    this.movePan(-dx * unitsPerPixel, dy * unitsPerPixel);
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (this.pointer?.id !== event.pointerId) return;
    this.pointer = null;
    this.renderer.domElement.classList.remove("dragging");
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  private readonly wheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.camera.zoom = MathUtils.clamp(this.camera.zoom * Math.exp(-event.deltaY * 0.001), 0.7, 2.4);
    this.camera.updateProjectionMatrix();
  };

  private movePan(horizontal: number, vertical: number): void {
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.pan.x += horizontal * right.x + vertical * up.x;
    this.pan.z += horizontal * right.z + vertical * up.z;
    this.pan.x = MathUtils.clamp(this.pan.x, -this.mapRadius * 0.65, this.mapRadius * 0.65);
    this.pan.z = MathUtils.clamp(this.pan.z, -this.mapRadius * 0.65, this.mapRadius * 0.65);
    this.camera.position.copy(this.cameraOrigin).add(this.pan);
    this.camera.lookAt(this.pan);
  }

  private readonly animate = (time: number): void => {
    const delta = this.lastFrame === 0 ? 0 : Math.min((time - this.lastFrame) / 1000, 0.1);
    this.lastFrame = time;

    const right = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    const up = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    if (right !== 0 || up !== 0) this.movePan(right * delta * 22, up * delta * 22);

    this.model.advance(delta);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };
}
