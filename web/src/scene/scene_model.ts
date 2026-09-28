import { Group, Mesh, MeshBasicMaterial, RingGeometry, Sprite, SpriteMaterial, Vector3 } from "three";
import type { WorldSnapshot } from "../game/protocol";
import { createEnemyBase, createGround, createResourceNode, createTownCenter, createVillagerSprite } from "./world_objects";

interface VillagerVisual { sprite: Sprite; carrying: boolean; destination: Vector3; marker: Mesh; health: Group }
interface BuildingVisual { group: Group; health: Group; marker: Mesh }
function disposeSprite(sprite: Sprite): void { const material = sprite.material as SpriteMaterial; material.map?.dispose(); material.dispose(); }
function marker(radius: number): Mesh {
  const ring = new Mesh(new RingGeometry(radius - 0.08, radius, 28), new MeshBasicMaterial({ color: 0xf3e38e, side: 2, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.09; ring.visible = false; return ring;
}
function healthBar(width: number, y: number): Group {
  const group = new Group(); group.position.y = y;
  group.userData.width = width;
  const back = new Sprite(new SpriteMaterial({ color: 0x3b1e1c, depthTest: false })); back.scale.set(width + .18, .34, 1); group.add(back);
  const fill = new Sprite(new SpriteMaterial({ color: 0x7bd568, depthTest: false })); fill.name = "fill"; fill.scale.set(width, .2, 1); fill.position.z = .02; group.add(fill);
  return group;
}
function setHealth(bar: Group, hp: number, max: number): void {
  const fill = bar.getObjectByName("fill") as Sprite;
  const width = bar.userData.width as number;
  const ratio = Math.max(0, hp / max); fill.scale.x = width * ratio; fill.position.x = (ratio - 1) * width / 2;
  bar.visible = true;
}
function disposeGroup(group: Group): void {
  group.traverse((object) => {
    if (object instanceof Sprite) disposeSprite(object);
    else if (object instanceof Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((m) => { if (m instanceof MeshBasicMaterial) m.map?.dispose(); m.dispose(); }); }
  });
}
export class SceneModel {
  readonly root = new Group();
  private readonly resources = new Map<number, Group>();
  private readonly buildings = new Map<number, BuildingVisual>();
  private readonly villagers = new Map<number, VillagerVisual>();
  constructor(snapshot: WorldSnapshot) { this.root.add(createGround(snapshot.map_radius)); this.update(snapshot); }
  update(snapshot: WorldSnapshot): void {
    for (const r of snapshot.resources) {
      let group = this.resources.get(r.id);
      if (!group) { group = createResourceNode(r); this.resources.set(r.id, group); this.root.add(group); }
      group.visible = r.amount > 0;
    }
    const buildingIds = new Set<number>();
    for (const b of snapshot.buildings) {
      if (b.hp <= 0) continue;
      buildingIds.add(b.id);
      let visual = this.buildings.get(b.id);
      if (!visual) {
        const group = b.owner === "enemy" ? createEnemyBase() : createTownCenter();
        group.userData = { kind: "building", id: b.id };
        group.position.set(b.x, 0, b.z);
        const health = healthBar(5, 11.4); group.add(health);
        const selection = marker(4.8); group.add(selection);
        visual = { group, health, marker: selection }; this.buildings.set(b.id, visual); this.root.add(group);
      }
      visual.group.scale.y = b.progress < 100 ? Math.max(.15, b.progress / 100) : 1;
      setHealth(visual.health, b.hp, b.max_hp);
    }
    for (const [id, visual] of this.buildings) if (!buildingIds.has(id)) { this.root.remove(visual.group); disposeGroup(visual.group); this.buildings.delete(id); }
    const live = new Set<number>();
    for (const v of snapshot.villagers) {
      if (v.hp <= 0) continue;
      live.add(v.id);
      const carrying = v.cargo > 0;
      let visual = this.villagers.get(v.id);
      if (visual && visual.carrying !== carrying) {
        const pos = visual.sprite.position.clone(); this.root.remove(visual.sprite); disposeSprite(visual.sprite);
        visual.sprite = createVillagerSprite(v.id, carrying); visual.sprite.position.copy(pos); visual.carrying = carrying; this.root.add(visual.sprite);
      }
      if (!visual) {
        const sprite = createVillagerSprite(v.id, carrying); sprite.position.set(v.x, .04, v.z);
        const selection = marker(1.1); this.root.add(selection);
        const health = healthBar(1.7, 3.5); this.root.add(health);
        visual = { sprite, carrying, destination: new Vector3(v.x, .04, v.z), marker: selection, health };
        this.villagers.set(v.id, visual); this.root.add(sprite);
      }
      visual.destination.set(v.x, .04, v.z); setHealth(visual.health, v.hp, v.max_hp);
    }
    for (const [id, visual] of this.villagers) if (!live.has(id)) {
      this.root.remove(visual.sprite, visual.marker, visual.health); disposeSprite(visual.sprite); disposeGroup(visual.health);
      visual.marker.geometry.dispose(); (visual.marker.material as MeshBasicMaterial).dispose(); this.villagers.delete(id);
    }
  }
  select(villagerIds: ReadonlySet<number>, buildingId: number | null): void {
    for (const [id, v] of this.villagers) v.marker.visible = villagerIds.has(id);
    for (const [id, b] of this.buildings) b.marker.visible = id === buildingId;
  }
  advance(seconds: number): void {
    const alpha = 1 - Math.exp(-Math.max(0, seconds) * 20);
    for (const visual of this.villagers.values()) {
      visual.sprite.position.lerp(visual.destination, alpha);
      visual.marker.position.set(visual.sprite.position.x, .08, visual.sprite.position.z);
      visual.health.position.set(visual.sprite.position.x, 3.5, visual.sprite.position.z);
    }
  }
  dispose(): void { disposeGroup(this.root); this.resources.clear(); this.buildings.clear(); this.villagers.clear(); }
}
