defmodule KC3RTS.Game.Pathfinding do
  @moduledoc """
  Static-obstacle routes for the legacy Elixir simulation.

  The grid and obstacle footprints match the offline browser preview while
  gameplay is migrated to KC3. Units still avoid one another locally.
  """

  @grid 2
  @unit_radius 0.45
  @epsilon 1.0e-9
  @directions [{1, 0}, {0, 1}, {-1, 0}, {0, -1}]

  def walkable?(point, radius, resources, buildings) do
    abs(point.x) <= radius - 3 and abs(point.z) <= radius - 3 and
      Enum.all?(obstacles(resources, buildings), fn obstacle ->
        squared_distance(point, obstacle) >= obstacle.radius * obstacle.radius - @epsilon
      end)
  end

  def clear_approach?(from, target, range, resources, buildings) do
    clear_approach_with?(from, target, range, obstacles(resources, buildings))
  end

  def route(from, target, range, radius, resources, buildings) do
    route_with(from, target, range, radius, obstacles(resources, buildings))
  end

  def clear_approach_with?(from, target, range, blockers) do
    segment_clear?(from, approach(from, target, range), blockers)
  end

  def route_with(from, target, range, radius, blockers) do
    if segment_clear?(from, approach(from, target, range), blockers) do
      []
    else
      limit = floor((radius - 3) / @grid)
      origin = {floor(from.x / @grid + 0.5), floor(from.z / @grid + 0.5)}
      {queue, visited, previous} = seed_cells(from, origin, limit, blockers)
      context = %{target: target, range: range, limit: limit, blockers: blockers}
      search(queue, visited, previous, context)
    end
  end

  defp seed_cells(from, {ox, oz}, limit, blockers) do
    cells = for dx <- -2..2, dz <- -2..2, do: {ox + dx, oz + dz}

    Enum.reduce(cells, {:queue.new(), MapSet.new(), %{}}, fn cell, {queue, visited, previous} ->
      if seed_blocked?(from, cell, limit, blockers) do
        {queue, visited, previous}
      else
        {:queue.in(cell, queue), MapSet.put(visited, cell), Map.put(previous, cell, nil)}
      end
    end)
  end

  defp seed_blocked?(from, cell, limit, blockers) do
    {x, z} = cell
    candidate = point(cell)

    abs(x) > limit or abs(z) > limit or squared_distance(from, candidate) > 4.5 * 4.5 or
      not segment_clear?(from, candidate, blockers) or
      Enum.any?(blockers, fn obstacle ->
        squared_distance(candidate, obstacle) < obstacle.radius * obstacle.radius - @epsilon
      end)
  end

  defp search(queue, visited, previous, context) do
    case :queue.out(queue) do
      {:empty, _queue} ->
        nil

      {{:value, cell}, rest} ->
        if goal?(cell, context) do
          unwind(cell, previous, [])
        else
          {queue, visited, previous} = expand(cell, rest, visited, previous, context)
          search(queue, visited, previous, context)
        end
    end
  end

  defp goal?(cell, context) do
    point = point(cell)
    distance = :math.sqrt(squared_distance(point, context.target))

    distance <= max(1.5, context.range + 0.75) and
      segment_clear?(
        point,
        approach(point, context.target, context.range),
        context.blockers
      )
  end

  defp expand(cell, queue, visited, previous, context) do
    Enum.reduce(@directions, {queue, visited, previous}, fn {dx, dz},
                                                            {queue, visited, previous} ->
      {x, z} = cell
      next = {x + dx, z + dz}

      if blocked_step?(cell, next, visited, context) do
        {queue, visited, previous}
      else
        {:queue.in(next, queue), MapSet.put(visited, next), Map.put(previous, next, cell)}
      end
    end)
  end

  defp blocked_step?(cell, next, visited, context) do
    {nx, nz} = next
    next_point = point(next)

    abs(nx) > context.limit or abs(nz) > context.limit or MapSet.member?(visited, next) or
      not segment_clear?(point(cell), next_point, context.blockers) or
      Enum.any?(context.blockers, fn obstacle ->
        squared_distance(next_point, obstacle) < obstacle.radius * obstacle.radius - @epsilon
      end)
  end

  defp unwind(cell, previous, route) do
    route = [point(cell) | route]

    case Map.fetch!(previous, cell) do
      nil -> route
      prior -> unwind(prior, previous, route)
    end
  end

  defp point({x, z}), do: %{x: x * @grid, z: z * @grid}

  def obstacles(resources, buildings) do
    resource_obstacles =
      for resource <- resources, resource.amount > 0 do
        %{
          x: resource.x,
          z: resource.z,
          radius: if(resource.kind == :wood, do: 0.9, else: 2.0) + @unit_radius
        }
      end

    building_obstacles =
      for building <- buildings, building.hp > 0 do
        %{x: building.x, z: building.z, radius: 2.45 + @unit_radius}
      end

    resource_obstacles ++ building_obstacles
  end

  defp segment_clear?(from, to, blockers) do
    dx = to.x - from.x
    dz = to.z - from.z
    length_squared = dx * dx + dz * dz

    Enum.all?(blockers, fn obstacle ->
      projection =
        if length_squared == 0 do
          0
        else
          max(
            0,
            min(1, ((obstacle.x - from.x) * dx + (obstacle.z - from.z) * dz) / length_squared)
          )
        end

      x = from.x + projection * dx - obstacle.x
      z = from.z + projection * dz - obstacle.z
      x * x + z * z >= obstacle.radius * obstacle.radius - @epsilon
    end)
  end

  defp approach(from, target, range) do
    dx = target.x - from.x
    dz = target.z - from.z
    distance = :math.sqrt(dx * dx + dz * dz)
    travel = max(0, distance - range)

    if distance == 0,
      do: from,
      else: %{x: from.x + dx / distance * travel, z: from.z + dz / distance * travel}
  end

  defp squared_distance(a, b) do
    dx = a.x - b.x
    dz = a.z - b.z
    dx * dx + dz * dz
  end
end
