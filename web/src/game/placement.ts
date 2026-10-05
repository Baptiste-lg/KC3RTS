import { definitions, type KC3View, type Point } from "./kc3_view";

const overlap = (a: Point, size: number, b: Point, otherSize: number) =>
  Math.abs(a.x - b.x) * 2 < size + otherSize && Math.abs(a.z - b.z) * 2 < size + otherSize;

// A display hint only: KC3 validates the same catalog footprints on submission.
export function validBuildSite(view: KC3View, point: Point, footprint: number): boolean {
  const map = view.map, half = footprint / 2;
  if (point.x - half < map.origin_x || point.z - half < map.origin_z ||
      point.x + half > map.origin_x + map.width * map.cell_size || point.z + half > map.origin_z + map.height * map.cell_size) return false;
  return !map.blocked.some((cell) => overlap(point, footprint, {
    x: map.origin_x + (cell % map.width + .5) * map.cell_size,
    z: map.origin_z + (Math.floor(cell / map.width) + .5) * map.cell_size,
  }, map.cell_size)) &&
    !view.nodes.some((node) => node.amount > 0 && overlap(point, footprint, node, map.cell_size)) &&
    !view.entities.some((entity) => entity.hp > 0 && overlap(point, footprint, entity, definitions.get(entity.type_id)!.footprint!));
}

export function buildingAt(view: KC3View, point: Point): number | null {
  return view.entities.find((entity) => {
    const definition = definitions.get(entity.type_id)!;
    return entity.hp > 0 && definition.kind === "building" &&
      Math.abs(point.x - entity.x) < definition.footprint! / 2 && Math.abs(point.z - entity.z) < definition.footprint! / 2;
  })?.id ?? null;
}
