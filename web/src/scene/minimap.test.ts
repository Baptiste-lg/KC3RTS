import { describe, expect, it, vi } from "vitest";
import { createLocalWorld } from "../game/local_world";
import { Minimap, mapToMini, miniToMap } from "./minimap";

describe("minimap coordinates", () => {
  it("maps the center and corners to pixels and back", () => {
    expect(mapToMini({ x: 0, z: 0 }, 32, 192)).toEqual({ x: 96, z: 96 });
    expect(mapToMini({ x: -32, z: 32 }, 32, 192)).toEqual({ x: 0, z: 192 });
    expect(miniToMap(192, 0, 32, 192)).toEqual({ x: 32, z: -32 });
    expect(miniToMap(400, -5, 32, 192)).toEqual({ x: 32, z: -32 });
  });
  it("draws live map markers and focuses the clicked map position", () => {
    const listeners = new Map<string, (event: PointerEvent) => void>();
    const fills: string[] = [];
    const context = {
      fillStyle: "", strokeStyle: "", lineWidth: 0,
      clearRect: vi.fn(),
      fillRect: vi.fn(() => fills.push(context.fillStyle)),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      strokeRect: vi.fn(), arc: vi.fn(), fill: vi.fn(), closePath: vi.fn(),
    };
    const canvas = {
      width: 200, height: 200,
      addEventListener: (event: string, handler: (event: PointerEvent) => void) => listeners.set(event, handler),
      removeEventListener: (event: string) => listeners.delete(event),
      getContext: () => context,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 100 }),
    } as unknown as HTMLCanvasElement;
    const focus = vi.fn();
    const minimap = new Minimap(canvas, focus);
    listeners.get("pointerdown")!({ clientX: 60, clientY: 70 } as PointerEvent);
    expect(focus).not.toHaveBeenCalled();

    const opening = createLocalWorld();
    const world = {
      ...opening,
      resources: [opening.resources.find((r) => r.kind === "wood")!, opening.resources.find((r) => r.kind === "stone")!, opening.resources.find((r) => r.kind === "gold")!],
      buildings: opening.buildings.map((b) => b.owner === "enemy" ? { ...b, hp: 0 } : b),
    };
    world.resources[0] = { ...world.resources[0], amount: 0 };
    minimap.draw(world, { x: 0, z: 0 }, [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }]);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 200);
    expect(context.closePath).toHaveBeenCalledOnce();
    expect(context.arc).toHaveBeenCalledTimes(3);
    expect(fills).toContain("#d4dbce");
    expect(fills).toContain("#f4c85f");
    expect(fills).toContain("#75c9de");
    expect(fills).not.toContain("#164b2a");
    expect(fills).not.toContain("#e56858");

    listeners.get("pointerdown")!({ clientX: 60, clientY: 70 } as PointerEvent);
    expect(focus).toHaveBeenLastCalledWith({ x: 0, z: 0 });
    listeners.get("pointerdown")!({ clientX: 200, clientY: 0 } as PointerEvent);
    expect(focus).toHaveBeenLastCalledWith({ x: 52, z: -52 });
    minimap.dispose();
    expect(listeners.has("pointerdown")).toBe(false);
  });
});
