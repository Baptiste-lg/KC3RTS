import type { GameClient, GameConnectionHandlers } from "./connection";
import type { GameCommand } from "./protocol";
import { applyLocalCommand, createLocalWorld, stepLocalWorld, type LocalWorld } from "./local_world";
export class LocalGameConnection implements GameClient {
  private world: LocalWorld | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly handlers: GameConnectionHandlers) {}
  connect(): void {
    if (this.timer !== null) return;
    this.world = createLocalWorld(crypto.getRandomValues(new Uint32Array(1))[0]); this.handlers.onStatus("local"); this.handlers.onSnapshot(this.world);
    this.timer = setInterval(() => {
      if (!this.world || this.world.outcome !== "playing") return;
      this.world = stepLocalWorld(this.world); this.handlers.onSnapshot(this.world);
    }, 100);
  }
  command(command: GameCommand): void {
    if (!this.world) { this.handlers.onCommand({ ok: false, reason: "offline" }); return; }
    const result = applyLocalCommand(this.world, command);
    if (result.ok) { this.world = result.world; this.handlers.onSnapshot(this.world); this.handlers.onCommand({ ok: true }); }
    else this.handlers.onCommand(result);
  }
  disconnect(): void { if (this.timer !== null) clearInterval(this.timer); this.timer = null; this.world = null; }
}
