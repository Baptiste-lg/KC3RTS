import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldSnapshot } from "./protocol";
import { LocalGameConnection } from "./local_connection";

afterEach(() => vi.useRealTimers());

describe("LocalGameConnection", () => {
  it("starts a browser-only match, recruits and publishes automatic deliveries", () => {
    vi.useFakeTimers();
    const snapshots: WorldSnapshot[] = [];
    const statuses: string[] = [];
    const outcomes: boolean[] = [];
    const game = new LocalGameConnection({
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onStatus: (status) => statuses.push(status),
      onRecruitment: (outcome) => outcomes.push(outcome.ok),
    });

    game.connect();
    game.connect();
    expect(statuses).toEqual(["local"]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].stockpile).toBe(20);

    game.spawnVillager();
    expect(outcomes).toEqual([true]);
    expect(snapshots.at(-1)?.villagers).toHaveLength(1);
    expect(snapshots.at(-1)?.stockpile).toBe(15);

    vi.advanceTimersByTime(70_000);
    expect(snapshots.at(-1)?.stockpile).toBeGreaterThan(15);
    expect(snapshots.at(-1)?.tick).toBe(700);
    const count = snapshots.length;
    game.disconnect();
    vi.advanceTimersByTime(1_000);
    expect(snapshots).toHaveLength(count);
  });
});
