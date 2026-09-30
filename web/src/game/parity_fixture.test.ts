import { describe, expect, it } from "vitest";
import scenariosFile from "../../../fixtures/parity_scenarios.json";
import goldenFile from "../../../fixtures/parity_v4.json";
import { applyLocalCommand, createLocalWorld, stepLocalWorld, type LocalWorld } from "./local_world";
import type { GameCommand, ResourceNode } from "./protocol";

interface FixtureStep { command?: GameCommand; ticks?: number }
interface FixtureScenario {
  name: string;
  seed: number;
  setup?: { resource_amounts?: Record<string, number>; enemy_hp?: number; clear_resources_near?: { x: number; z: number; radius: number } };
  steps: FixtureStep[];
}

function setup(world: LocalWorld, scenario: FixtureScenario): LocalWorld {
  const amounts = scenario.setup?.resource_amounts;
  let resources: ResourceNode[] = world.resources.map((r) => ({ ...r, amount: amounts?.[r.id] ?? r.amount }));
  const clear = scenario.setup?.clear_resources_near;
  if (clear) resources = resources.filter((r) => Math.hypot(r.x - clear.x, r.z - clear.z) >= clear.radius);
  const buildings = world.buildings.map((b) => b.owner === "enemy" && scenario.setup?.enemy_hp !== undefined ? { ...b, hp: scenario.setup.enemy_hp } : b);
  return { ...world, resources, buildings };
}

function canonical(world: LocalWorld): unknown {
  const { nextVillagerId, nextBuildingId, ...snapshot } = world;
  return JSON.parse(JSON.stringify({ ...snapshot, next_villager_id: nextVillagerId, next_building_id: nextBuildingId }, (_key, value: unknown) => {
    if (typeof value !== "number" || Number.isInteger(value)) return value;
    const rounded = Math.round(value * 1_000_000) / 1_000_000;
    return Object.is(rounded, -0) ? 0 : rounded;
  })) as unknown;
}

describe("legacy ruleset 2 server/browser full-state parity", () => {
  it("replays seeded economy, depletion, placement, death and boundary scenarios", () => {
    expect(scenariosFile.version).toBe(4);
    expect(goldenFile.version).toBe(4);
    const golden = new Map(goldenFile.scenarios.map((scenario) => [scenario.name, scenario]));

    for (const scenario of scenariosFile.scenarios as FixtureScenario[]) {
      let world = setup(createLocalWorld(scenario.seed), scenario);
      const results: string[] = [];
      for (const step of scenario.steps) {
        if (step.ticks !== undefined) {
          world = stepLocalWorld(world, step.ticks);
          results.push("tick");
        } else if (step.command) {
          const result = applyLocalCommand(world, step.command);
          if (result.ok) { world = result.world; results.push("ok"); }
          else results.push(result.reason);
        }
      }
      expect(results, scenario.name).toEqual(golden.get(scenario.name)?.results);
      expect(canonical(world), scenario.name).toEqual(golden.get(scenario.name)?.state);
    }
  });
});
