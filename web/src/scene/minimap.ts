import type { GroundPoint, WorldSnapshot } from "../game/protocol";

export function mapToMini(point: GroundPoint, radius: number, size: number): GroundPoint {
  return { x: (point.x / radius + 1) * size / 2, z: (point.z / radius + 1) * size / 2 };
}

export function miniToMap(x: number, y: number, radius: number, size: number): GroundPoint {
  return {
    x: Math.max(-radius, Math.min(radius, (x / size * 2 - 1) * radius)),
    z: Math.max(-radius, Math.min(radius, (y / size * 2 - 1) * radius)),
  };
}

export class Minimap {
  private world: WorldSnapshot | null = null;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly onFocus: (point: GroundPoint) => void) {
    canvas.addEventListener("pointerdown", this.pointerDown);
  }
  draw(world: WorldSnapshot, focus: GroundPoint, viewport: GroundPoint[]): void {
    this.world = world;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const size = this.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#4c7650";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(220, 237, 189, .12)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const line = i * size / 4;
      ctx.beginPath(); ctx.moveTo(line, 0); ctx.lineTo(line, size); ctx.moveTo(0, line); ctx.lineTo(size, line); ctx.stroke();
    }
    for (const node of world.resources) {
      if (node.amount <= 0) continue;
      const p = mapToMini(node, world.map_radius, size);
      ctx.fillStyle = node.kind === "wood" ? "#164b2a" : node.kind === "stone" ? "#d4dbce" : "#f4c85f";
      ctx.fillRect(p.x - 2, p.z - 2, 4, 4);
    }
    for (const building of world.buildings) {
      if (building.hp <= 0) continue;
      const p = mapToMini(building, world.map_radius, size);
      ctx.fillStyle = building.owner === "enemy" ? "#e56858" : "#75c9de";
      ctx.fillRect(p.x - 5, p.z - 5, 10, 10);
      ctx.strokeStyle = "#13291c"; ctx.strokeRect(p.x - 5, p.z - 5, 10, 10);
    }
    ctx.fillStyle = "#fff4c5";
    for (const villager of world.villagers) {
      const p = mapToMini(villager, world.map_radius, size);
      ctx.beginPath(); ctx.arc(p.x, p.z, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    const camera = mapToMini(focus, world.map_radius, size);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
    if (viewport.length === 4) {
      ctx.beginPath();
      viewport.forEach((corner, index) => {
        const p = mapToMini(corner, world.map_radius, size);
        if (index === 0) ctx.moveTo(p.x, p.z); else ctx.lineTo(p.x, p.z);
      });
      ctx.closePath(); ctx.stroke();
    }
    ctx.fillStyle = "#ffffff"; ctx.fillRect(camera.x - 2, camera.z - 2, 4, 4);
    ctx.strokeStyle = "rgba(0, 0, 0, .65)"; ctx.strokeRect(1, 1, size - 2, size - 2);
  }
  dispose(): void { this.canvas.removeEventListener("pointerdown", this.pointerDown); }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (!this.world) return;
    const rect = this.canvas.getBoundingClientRect();
    this.onFocus(miniToMap((event.clientX - rect.left) / rect.width * this.canvas.width,
      (event.clientY - rect.top) / rect.height * this.canvas.height, this.world.map_radius, this.canvas.width));
  };
}
