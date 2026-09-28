import { Group, Mesh, Sprite, SpriteMaterial, Vector3 } from "three";
import type { WorldSnapshot } from "../game/protocol";
import { createGround, createResourceNode, createTownCenter, createVillagerSprite } from "./world_objects";

interface VillagerVisual {
  sprite: Sprite;
  carrying: boolean;
  destination: Vector3;
}

function disposeSprite(sprite: Sprite): void {
  const material = sprite.material as SpriteMaterial;
  material.map?.dispose();
  material.dispose();
}

export class SceneModel {
  readonly root = new Group();
  private readonly resources = new Map<number, Group>();
  private readonly villagers = new Map<number, VillagerVisual>();

  constructor(snapshot: WorldSnapshot) {
    this.root.add(createGround(snapshot.map_radius));
    const center = createTownCenter();
    center.position.set(snapshot.town_center.x, 0, snapshot.town_center.z);
    this.root.add(center);
    this.update(snapshot);
  }

  update(snapshot: WorldSnapshot): void {
    for (const resource of snapshot.resources) {
      let visual = this.resources.get(resource.id);
      if (!visual) {
        visual = createResourceNode(resource);
        this.resources.set(resource.id, visual);
        this.root.add(visual);
      }
      visual.visible = resource.amount > 0;
      visual.scale.y = 0.35 + 0.65 * (resource.amount / resource.initial_amount);
    }

    const liveIds = new Set<number>();
    for (const villager of snapshot.villagers) {
      liveIds.add(villager.id);
      const carrying = villager.cargo > 0;
      let visual = this.villagers.get(villager.id);

      if (visual && visual.carrying !== carrying) {
        const oldPosition = visual.sprite.position.clone();
        this.root.remove(visual.sprite);
        disposeSprite(visual.sprite);
        const sprite = createVillagerSprite(villager.id, carrying);
        sprite.position.copy(oldPosition);
        visual = { sprite, carrying, destination: visual.destination };
        this.villagers.set(villager.id, visual);
        this.root.add(sprite);
      }

      if (!visual) {
        const sprite = createVillagerSprite(villager.id, carrying);
        sprite.position.set(villager.x, 0.04, villager.z);
        visual = {
          sprite,
          carrying,
          destination: new Vector3(villager.x, 0.04, villager.z),
        };
        this.villagers.set(villager.id, visual);
        this.root.add(sprite);
      }

      visual.destination.set(villager.x, 0.04, villager.z);
    }

    for (const [id, visual] of this.villagers) {
      if (liveIds.has(id)) continue;
      this.root.remove(visual.sprite);
      disposeSprite(visual.sprite);
      this.villagers.delete(id);
    }
  }

  advance(seconds: number): void {
    const alpha = 1 - Math.exp(-Math.max(0, seconds) * 12);
    for (const visual of this.villagers.values()) {
      visual.sprite.position.lerp(visual.destination, alpha);
    }
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof Sprite) {
        disposeSprite(object);
      } else if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.resources.clear();
    this.villagers.clear();
  }
}
