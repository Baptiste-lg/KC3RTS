import type { GameClient, GameConnectionHandlers } from "./connection";
import { createLocalWorld, recruitLocalVillager, stepLocalWorld, type LocalWorld } from "./local_world";

export class LocalGameConnection implements GameClient {
  private world: LocalWorld | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly handlers: GameConnectionHandlers) {}

  connect(): void {
    if (this.timer !== null) return;
    this.world = createLocalWorld();
    this.handlers.onStatus("local");
    this.handlers.onSnapshot(this.world);
    this.timer = setInterval(() => {
      if (!this.world) return;
      this.world = stepLocalWorld(this.world);
      this.handlers.onSnapshot(this.world);
    }, 100);
  }

  spawnVillager(): void {
    if (!this.world) {
      this.handlers.onRecruitment({ ok: false, reason: "offline" });
      return;
    }
    const result = recruitLocalVillager(this.world);
    if (!result.ok) {
      this.handlers.onRecruitment(result);
      return;
    }
    this.world = result.world;
    this.handlers.onSnapshot(this.world);
    this.handlers.onRecruitment({ ok: true });
  }

  disconnect(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.world = null;
  }
}
