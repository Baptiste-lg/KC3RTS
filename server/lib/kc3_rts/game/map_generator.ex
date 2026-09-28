defmodule KC3RTS.Game.MapGenerator do
  @moduledoc "Deterministic resource clusters shared in design with the browser's local simulation."
  @mod 2_147_483_647
  @amounts %{wood: 160, stone: 480, gold: 520}
  @origin %{x: 0.0, z: 0.0}
  @starter_grove %{x: 13.0, z: 13.0}

  @spec generate(pos_integer()) :: {map(), [map()]}
  def generate(seed) do
    {enemy, seed} = place_enemy(seed, 100)

    resources = [
      resource(1, :stone, %{x: 14.0, z: -12.0}),
      resource(2, :gold, %{x: -14.0, z: 12.0})
    ]

    {resources, seed} = place_ore(resources, seed, enemy, :stone, 7)
    {resources, seed} = place_ore(resources, seed, enemy, :gold, 5)
    centers = [@starter_grove]
    {resources, seed} = place_trees(resources, seed, enemy, @starter_grove, 8, 7.5)

    {resources, seed, centers} =
      place_clusters(resources, seed, enemy, centers, 3, %{
        span: 34,
        home: 24,
        foe: 14,
        other: 21,
        count: 22,
        radius: 12.5
      })

    {resources, _seed, _centers} =
      place_clusters(resources, seed, enemy, centers, 5, %{
        span: 40,
        home: 18,
        foe: 11,
        other: 13,
        count: 6,
        radius: 6.5
      })

    {enemy, resources}
  end

  defp resource(id, kind, point) do
    Map.merge(point, %{id: id, kind: kind, amount: @amounts[kind], initial_amount: @amounts[kind]})
  end

  defp next(seed, span) do
    value = rem(seed * 48_271, @mod)
    {Float.round(value / @mod * span * 2 - span, 1), value}
  end

  defp point(seed, span) do
    {x, seed} = next(seed, span)
    {z, seed} = next(seed, span)
    {%{x: x, z: z}, seed}
  end

  defp distance(a, b), do: :math.sqrt(:math.pow(a.x - b.x, 2) + :math.pow(a.z - b.z, 2))

  defp place_enemy(seed, 0),
    do: {%{id: 2, owner: :enemy, x: 38.0, z: 38.0, hp: 250, max_hp: 250, progress: 100}, seed}

  defp place_enemy(seed, attempts) do
    {candidate, seed} = point(seed, 48)

    if distance(candidate, @origin) >= 34 do
      {Map.merge(candidate, %{id: 2, owner: :enemy, hp: 250, max_hp: 250, progress: 100}), seed}
    else
      place_enemy(seed, attempts - 1)
    end
  end

  defp place_ore(resources, seed, _enemy, _kind, 0), do: {resources, seed}

  defp place_ore(resources, seed, enemy, kind, remaining) do
    {point, seed} = point(seed, 47)

    if distance(point, @origin) < 11 or distance(point, enemy) < 8 or
         Enum.any?(resources, &(distance(point, &1) < 8)) do
      place_ore(resources, seed, enemy, kind, remaining)
    else
      place_ore(
        resources ++ [resource(length(resources) + 1, kind, point)],
        seed,
        enemy,
        kind,
        remaining - 1
      )
    end
  end

  defp place_clusters(resources, seed, _enemy, centers, 0, _config),
    do: {resources, seed, centers}

  defp place_clusters(resources, seed, enemy, centers, remaining, config) do
    {center, seed} =
      choose_center(seed, enemy, centers, config.span, config.home, config.foe, config.other)

    {resources, seed} = place_trees(resources, seed, enemy, center, config.count, config.radius)
    place_clusters(resources, seed, enemy, centers ++ [center], remaining - 1, config)
  end

  defp choose_center(seed, enemy, centers, span, home, foe, other) do
    {candidate, seed} = point(seed, span)

    if distance(candidate, @origin) < home or distance(candidate, enemy) < foe or
         Enum.any?(centers, &(distance(candidate, &1) < other)) do
      choose_center(seed, enemy, centers, span, home, foe, other)
    else
      {candidate, seed}
    end
  end

  defp place_trees(resources, seed, enemy, center, count, radius),
    do: place_trees(resources, seed, enemy, center, count, radius, 0)

  defp place_trees(resources, seed, _enemy, _center, 0, _radius, _attempts), do: {resources, seed}

  defp place_trees(resources, seed, _enemy, _center, _count, _radius, 20_000),
    do: {resources, seed}

  defp place_trees(resources, seed, enemy, center, count, radius, attempts) do
    {offset, seed} = point(seed, radius)
    point = %{x: Float.round(center.x + offset.x, 1), z: Float.round(center.z + offset.z, 1)}

    invalid =
      distance(offset, @origin) > radius or abs(point.x) > 48 or abs(point.z) > 48 or
        distance(point, @origin) < 9 or distance(point, enemy) < 8 or
        Enum.any?(resources, fn resource ->
          distance(point, resource) < if(resource.kind == :wood, do: 2.3, else: 4.5)
        end)

    if invalid do
      place_trees(resources, seed, enemy, center, count, radius, attempts + 1)
    else
      updated = resources ++ [resource(length(resources) + 1, :wood, point)]
      place_trees(updated, seed, enemy, center, count - 1, radius, attempts + 1)
    end
  end
end
