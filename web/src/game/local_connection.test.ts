import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldSnapshot } from "./protocol";
import { LocalGameConnection } from "./local_connection";
afterEach(() => vi.useRealTimers());
describe("LocalGameConnection", () => {
  it("starts villagers and executes player orders", () => {
    vi.useFakeTimers(); const snapshots: WorldSnapshot[] = []; const outcomes: boolean[] = [];
    const game = new LocalGameConnection({ onSnapshot: (s) => snapshots.push(s), onStatus: () => undefined, onCommand: (o) => outcomes.push(o.ok) });
    game.connect(); expect(snapshots[0].villagers).toHaveLength(3);
    const resource = snapshots[0].resources[0];
    game.command({ type: "order", villager_ids: [1], order: { kind: "gather", id: resource.id } });
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual([true]);
    expect(snapshots.at(-1)!.stockpile[resource.kind]).toBeGreaterThan(snapshots[0].stockpile[resource.kind]);
    game.disconnect();
  });
});
