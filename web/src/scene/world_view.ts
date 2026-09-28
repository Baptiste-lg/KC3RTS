import { Color, DoubleSide, MathUtils, Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Raycaster, RingGeometry, Scene, Vector2, Vector3, WebGLRenderer } from "three";
import type { GroundPoint, WorldSnapshot } from "../game/protocol";
import { createIsometricCamera, resizeIsometricCamera } from "./camera";
import { SceneModel } from "./scene_model";

const CAMERA_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]);
export type MapHit = { kind: "villager" | "resource" | "building"; id: number } | { kind: "ground"; point: GroundPoint };
export interface MapActions { select(hit: MapHit, additive: boolean): void; order(hit: MapHit): boolean; selectArea(ids: number[], additive: boolean): void; place(point: GroundPoint): void; isPlacing(): boolean }
export class WorldView {
  private readonly scene = new Scene(); private readonly model: SceneModel; private readonly camera; private readonly renderer: WebGLRenderer;
  private readonly cameraOrigin: Vector3; private readonly pan = new Vector3(); private readonly keys = new Set<string>();
  private readonly mapRadius: number; private readonly raycaster = new Raycaster();
  private readonly selectionBox = document.createElement("div");
  private readonly placementMaterial = new MeshBasicMaterial({ color: 0x70df83, transparent: true, opacity: .28, side: DoubleSide, depthWrite: false });
  private readonly placementGhost = new Mesh(new PlaneGeometry(8, 8), this.placementMaterial);
  private readonly orderMaterial = new MeshBasicMaterial({ color: 0xe6e18b, transparent: true, opacity: .9, depthTest: false });
  private readonly orderMarker = new Mesh(new RingGeometry(1.0, 1.22, 24), this.orderMaterial);
  private orderTime = 0;
  private readonly edgePan = { x: 0, y: 0 };
  private pointer: { x: number; y: number; startX: number; startY: number; id: number; button: number } | null = null;
  private frame = 0; private lastFrame = 0; private lastRender = 0; private snapshot: WorldSnapshot;
  private readonly lowQuality = new URLSearchParams(window.location.search).get("quality") === "low";
  constructor(private readonly mount: HTMLElement, snapshot: WorldSnapshot, private readonly actions: MapActions) {
    this.snapshot = snapshot; this.mapRadius = snapshot.map_radius; this.model = new SceneModel(snapshot);
    this.camera = createIsometricCamera(1, snapshot.map_radius); this.cameraOrigin = this.camera.position.clone();
    this.renderer = new WebGLRenderer({ antialias: !this.lowQuality, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.lowQuality ? .65 : Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.domElement.setAttribute("aria-label", "Carte RTS interactive"); this.mount.appendChild(this.renderer.domElement);
    this.selectionBox.className = "selection-box"; this.selectionBox.hidden = true; this.mount.appendChild(this.selectionBox);
    this.scene.background = new Color(0x274d39); this.scene.add(this.model.root);
    this.placementGhost.rotation.x = -Math.PI / 2; this.placementGhost.position.y = .12; this.placementGhost.visible = false; this.scene.add(this.placementGhost);
    this.orderMarker.rotation.x = -Math.PI / 2; this.orderMarker.position.y = .14; this.orderMarker.renderOrder = 100;
    this.orderMarker.visible = false; this.scene.add(this.orderMarker);
    window.addEventListener("resize", this.resize); window.addEventListener("keydown", this.keyDown); window.addEventListener("keyup", this.keyUp);
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.pointerDown); canvas.addEventListener("pointermove", this.pointerMove); canvas.addEventListener("pointerleave", this.pointerLeave);
    canvas.addEventListener("pointerup", this.pointerUp); canvas.addEventListener("pointercancel", this.pointerUp);
    canvas.addEventListener("contextmenu", this.contextMenu); canvas.addEventListener("dblclick", this.doubleClick); canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.resize(); this.frame = requestAnimationFrame(this.animate);
  }
  update(snapshot: WorldSnapshot): void { this.snapshot = snapshot; this.model.update(snapshot); }
  select(ids: ReadonlySet<number>, buildingId: number | null): void { this.model.select(ids, buildingId); }
  setPlacing(active: boolean): void { this.renderer.domElement.classList.toggle("placing", active); if (!active) this.placementGhost.visible = false; }
  focus(point: GroundPoint): void {
    const bound = this.mapRadius - 6;
    this.pan.x = MathUtils.clamp(point.x, -bound, bound);
    this.pan.z = MathUtils.clamp(point.z, -bound, bound);
    this.camera.position.copy(this.cameraOrigin).add(this.pan);
    this.camera.lookAt(this.pan);
  }
  getFocus(): GroundPoint { return { x: this.pan.x, z: this.pan.z }; }
  getViewport(): GroundPoint[] {
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
      this.raycaster.setFromCamera(new Vector2(x, y), this.camera);
      const point = new Vector3(); this.raycaster.ray.intersectPlane(plane, point);
      return { x: point.x, z: point.z };
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.frame); window.removeEventListener("resize", this.resize); window.removeEventListener("keydown", this.keyDown); window.removeEventListener("keyup", this.keyUp);
    const c = this.renderer.domElement; c.removeEventListener("pointerdown", this.pointerDown); c.removeEventListener("pointermove", this.pointerMove);
    c.removeEventListener("pointerup", this.pointerUp); c.removeEventListener("pointercancel", this.pointerUp); c.removeEventListener("pointerleave", this.pointerLeave); c.removeEventListener("contextmenu", this.contextMenu); c.removeEventListener("dblclick", this.doubleClick); c.removeEventListener("wheel", this.wheel);
    this.model.dispose(); this.placementGhost.geometry.dispose(); this.placementMaterial.dispose(); this.orderMarker.geometry.dispose(); this.orderMaterial.dispose(); this.renderer.dispose(); c.remove(); this.selectionBox.remove();
  }
  private readonly resize = (): void => { const width = Math.max(1, this.mount.clientWidth); const height = Math.max(1, this.mount.clientHeight); resizeIsometricCamera(this.camera, width / height); this.renderer.setSize(width, height, false); };
  private readonly keyDown = (e: KeyboardEvent): void => { if (CAMERA_KEYS.has(e.code)) { e.preventDefault(); this.keys.add(e.code); } };
  private readonly keyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };
  private readonly contextMenu = (e: MouseEvent): void => { e.preventDefault(); };
  private readonly pointerLeave = (): void => { this.edgePan.x = 0; this.edgePan.y = 0; };
  private readonly doubleClick = (e: MouseEvent): void => {
    const hit = this.hit(e.clientX, e.clientY);
    if (hit?.kind !== "villager") return;
    const ids = this.snapshot.villagers.filter((v) => {
      const p = new Vector3(v.x, 1.5, v.z).project(this.camera);
      return p.x >= -1 && p.x <= 1 && p.y >= -1 && p.y <= 1;
    }).map((v) => v.id);
    this.actions.selectArea(ids, e.shiftKey);
  };
  private validBuildSite(point: GroundPoint): boolean {
    if (Math.abs(point.x) > this.mapRadius - 3 || Math.abs(point.z) > this.mapRadius - 3) return false;
    const distance = (target: GroundPoint): number => Math.hypot(target.x - point.x, target.z - point.z);
    return this.snapshot.buildings.every((b) => b.hp <= 0 || distance(b) >= 8) &&
      this.snapshot.resources.every((r) => r.amount <= 0 || distance(r) >= 5);
  }
  private screen(x: number, y: number): Vector2 { const rect = this.renderer.domElement.getBoundingClientRect(); return new Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1); }
  private ground(x: number, y: number): GroundPoint | null {
    this.raycaster.setFromCamera(this.screen(x, y), this.camera);
    const hit = new Vector3(); if (!this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), hit)) return null;
    return { x: MathUtils.clamp(hit.x, -this.mapRadius, this.mapRadius), z: MathUtils.clamp(hit.z, -this.mapRadius, this.mapRadius) };
  }
  private hit(x: number, y: number): MapHit | null {
    this.raycaster.setFromCamera(this.screen(x, y), this.camera);
    for (const item of this.raycaster.intersectObjects(this.model.root.children, true)) {
      let object = item.object;
      while (object) {
        const data = object.userData;
        if ((data.kind === "villager" || data.kind === "resource" || data.kind === "building") && typeof data.id === "number") return { kind: data.kind, id: data.id };
        if (!object.parent) break; object = object.parent;
      }
    }
    const rect = this.renderer.domElement.getBoundingClientRect();
    let nearest: { id: number; gap: number } | null = null;
    for (const resource of this.snapshot.resources) {
      if (resource.amount <= 0) continue;
      const height = resource.kind === "wood" ? 2.5 : resource.kind === "gold" ? 1.5 : 1;
      const projected = new Vector3(resource.x, height, resource.z).project(this.camera);
      const px = rect.left + (projected.x + 1) * rect.width / 2;
      const py = rect.top + (1 - projected.y) * rect.height / 2;
      const gap = Math.hypot(x - px, y - py);
      if (gap < 18 && (!nearest || gap < nearest.gap)) nearest = { id: resource.id, gap };
    }
    if (nearest) return { kind: "resource", id: nearest.id };
    const point = this.ground(x, y); return point ? { kind: "ground", point } : null;
  }
  private readonly pointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.pointer = { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, id: e.pointerId, button: e.button };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  };
  private readonly pointerMove = (e: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.edgePan.x = e.clientX < rect.left + 24 ? -1 : e.clientX > rect.right - 24 ? 1 : 0;
    this.edgePan.y = e.clientY < rect.top + 24 ? 1 : e.clientY > rect.bottom - 24 ? -1 : 0;
    if (this.actions.isPlacing()) {
      const point = this.ground(e.clientX, e.clientY);
      this.placementGhost.visible = point !== null;
      if (point) { this.placementGhost.position.set(point.x, .12, point.z); this.placementMaterial.color.set(this.validBuildSite(point) ? 0x70df83 : 0xee6d60); }
    }
    if (!this.pointer || this.pointer.id !== e.pointerId) return;
    if (this.pointer.button === 1) {
      const dx = e.clientX - this.pointer.x; const dy = e.clientY - this.pointer.y;
      const scale = (this.camera.top - this.camera.bottom) / (this.mount.clientHeight * this.camera.zoom);
      this.movePan(-dx * scale, dy * scale); this.renderer.domElement.classList.add("dragging");
    }
    if (this.pointer.button === 0 && Math.hypot(e.clientX - this.pointer.startX, e.clientY - this.pointer.startY) > 8) {
      const rect = this.mount.getBoundingClientRect();
      this.selectionBox.hidden = false;
      this.selectionBox.style.left = `${Math.min(this.pointer.startX, e.clientX) - rect.left}px`;
      this.selectionBox.style.top = `${Math.min(this.pointer.startY, e.clientY) - rect.top}px`;
      this.selectionBox.style.width = `${Math.abs(e.clientX - this.pointer.startX)}px`;
      this.selectionBox.style.height = `${Math.abs(e.clientY - this.pointer.startY)}px`;
    }
    this.pointer.x = e.clientX; this.pointer.y = e.clientY;
  };
  private readonly pointerUp = (e: PointerEvent): void => {
    if (!this.pointer || this.pointer.id !== e.pointerId) return;
    const start = this.pointer; this.pointer = null; this.selectionBox.hidden = true; this.renderer.domElement.classList.remove("dragging");
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    const dragged = Math.hypot(e.clientX - start.startX, e.clientY - start.startY) > 8;
    if (start.button === 1) return;
    if (start.button === 2) {
      const hit = this.hit(e.clientX, e.clientY);
      if (hit && this.actions.order(hit)) {
        const target = hit.kind === "ground" ? hit.point : hit.kind === "resource" ? this.snapshot.resources.find((r) => r.id === hit.id) : this.snapshot.buildings.find((b) => b.id === hit.id);
        if (target) {
          this.orderMarker.position.set(target.x, .14, target.z);
          this.orderMaterial.color.set(hit.kind === "resource" ? 0xe5c46c : hit.kind === "building" ? 0xe77d70 : 0xb8e4bb);
          this.orderTime = performance.now(); this.orderMarker.visible = true;
        }
      }
      return;
    }
    if (dragged) {
      const left = Math.min(start.startX, e.clientX), right = Math.max(start.startX, e.clientX);
      const top = Math.min(start.startY, e.clientY), bottom = Math.max(start.startY, e.clientY);
      const ids = this.snapshot.villagers.filter((v) => {
        const p = new Vector3(v.x, 1.5, v.z).project(this.camera); const rect = this.renderer.domElement.getBoundingClientRect();
        const x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2;
        return x >= left && x <= right && y >= top && y <= bottom;
      }).map((v) => v.id);
      this.actions.selectArea(ids, e.shiftKey); return;
    }
    const hit = this.hit(e.clientX, e.clientY); if (!hit) return;
    if (this.actions.isPlacing() && hit.kind === "ground") this.actions.place(hit.point);
    else this.actions.select(hit, e.shiftKey);
  };
  private readonly wheel = (e: WheelEvent): void => { e.preventDefault(); this.camera.zoom = MathUtils.clamp(this.camera.zoom * Math.exp(-e.deltaY * .001), .7, 2.4); this.camera.updateProjectionMatrix(); };
  private movePan(horizontal: number, vertical: number): void {
    const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.focus({ x: this.pan.x + horizontal * right.x + vertical * up.x, z: this.pan.z + horizontal * right.z + vertical * up.z });
  }
  private readonly animate = (time: number): void => {
    const delta = this.lastFrame === 0 ? 0 : Math.min((time - this.lastFrame) / 1000, .1); this.lastFrame = time;
    const right = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft")) + (this.pointer ? 0 : this.edgePan.x);
    const up = Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) + (this.pointer ? 0 : this.edgePan.y);
    if (right || up) this.movePan(right * delta * 36, up * delta * 36);
    if (this.orderMarker.visible) {
      const progress = Math.min(1, (time - this.orderTime) / 550);
      this.orderMarker.scale.setScalar(1 + progress * .55);
      this.orderMaterial.opacity = .9 * (1 - progress);
      if (progress >= 1) this.orderMarker.visible = false;
    }
    this.model.advance(delta);
    if (!this.lowQuality || time - this.lastRender >= 100) { this.renderer.render(this.scene, this.camera); this.lastRender = time; }
    this.frame = requestAnimationFrame(this.animate);
  };
}
