import { Group, Mesh, MeshBasicMaterial, RingGeometry, Sprite, SpriteMaterial, Vector3 } from "three";
import type { GroundPoint, Villager, WorldSnapshot } from "../game/protocol";
import { ATTACK_RANGE, GATHER_INTERVAL_TICKS, gatherRange, TICKS_PER_SECOND } from "../game/action_rules";
import { createEnemyBase, createGround, createResourceNode, createTownCenter, createVillagerSprite } from "./world_objects";
import { unitPose, type ActionTarget } from "./unit_motion";

interface VillagerVisual { sprite: Sprite; carrying: boolean; position: Vector3; destination: Vector3; movingUntil: number; action: ActionTarget | null; marker: Mesh; health: Group }
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
  private animationSeconds = 0;
  private tickAge = 0;
  private tick = 0;
  private readonly resources = new Map<number, Group>();
  private readonly buildings = new Map<number, BuildingVisual>();
  private readonly villagers = new Map<number, VillagerVisual>();
  constructor(snapshot: WorldSnapshot) { this.tick = snapshot.tick; this.root.add(createGround(snapshot.map_radius)); this.update(snapshot); }
  private actionFor(v: Villager, snapshot: WorldSnapshot): ActionTarget | null {
    const order = v.order;
    if (order?.kind === "gather" && v.cargo < 5) {
      const resource = snapshot.resources.find((node) => node.id === order.id && node.amount > 0);
      if (resource && (!v.cargo_kind || v.cargo_kind === resource.kind) &&
          Math.hypot(v.x - resource.x, v.z - resource.z) <= gatherRange(resource.kind) + .05) {
        return { x: resource.x, z: resource.z, intervalTicks: GATHER_INTERVAL_TICKS };
      }
    }
    if (order?.kind === "attack") {
      const enemy = snapshot.buildings.find((building) => building.id === order.id && building.owner === "enemy" && building.hp > 0);
      if (enemy && Math.hypot(v.x - enemy.x, v.z - enemy.z) <= ATTACK_RANGE + .05) {
        return { x: enemy.x, z: enemy.z, intervalTicks: v.attack_interval_ticks };
      }
    }
    return null;
  }
  update(snapshot: WorldSnapshot): void {
    if (snapshot.tick !== this.tick) { this.tick = snapshot.tick; this.tickAge = 0; }
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
        visual.sprite = createVillagerSprite(v.id, carrying, snapshot.seed); visual.sprite.position.copy(pos); visual.carrying = carrying; this.root.add(visual.sprite);
      }
      if (!visual) {
        const sprite = createVillagerSprite(v.id, carrying, snapshot.seed); sprite.position.set(v.x, .04, v.z);
        const selection = marker(1.1); this.root.add(selection);
        const health = healthBar(1.7, 4.2); this.root.add(health);
        visual = { sprite, carrying, position: new Vector3(v.x, .04, v.z), destination: new Vector3(v.x, .04, v.z), movingUntil: 0, action: null, marker: selection, health };
        this.villagers.set(v.id, visual); this.root.add(sprite);
      }
      if (Math.hypot(v.x - visual.destination.x, v.z - visual.destination.z) > .01) visual.movingUntil = this.animationSeconds + .17;
      visual.action = this.actionFor(v, snapshot);
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
    const delta = Math.max(0, seconds);
    this.animationSeconds += delta;
    this.tickAge = Math.min(1 / TICKS_PER_SECOND, this.tickAge + delta);
    const visualTick = this.tick + this.tickAge * TICKS_PER_SECOND;
    const alpha = 1 - Math.exp(-delta * 20);
    for (const [id, visual] of this.villagers) {
      visual.position.lerp(visual.destination, alpha);
      const moving = this.animationSeconds < visual.movingUntil ||
        visual.position.distanceToSquared(visual.destination) > .0025;
      const base: GroundPoint = { x: visual.position.x, z: visual.position.z };
      const pose = unitPose(base, visualTick, id, moving, visual.action);
      visual.sprite.position.set(base.x + pose.x, .04 + pose.lift, base.z + pose.z);
      visual.marker.position.set(base.x, .08, base.z);
      visual.health.position.set(visual.sprite.position.x, 4.2 + pose.lift, visual.sprite.position.z);
    }
  }
  dispose(): void { disposeGroup(this.root); this.resources.clear(); this.buildings.clear(); this.villagers.clear(); }
}
