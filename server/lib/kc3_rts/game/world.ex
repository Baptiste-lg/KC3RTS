defmodule KC3RTS.Game.World do
  @moduledoc "Deterministic RTS simulation. One tick is 100 ms."
  alias KC3RTS.Game.MapGenerator
  @mod 2_147_483_647
  @speed 0.55
  @capacity 5
  defstruct map_radius: 52.0,
            stockpile: %{wood: 30, stone: 15, gold: 20},
            resources: [],
            buildings: [],
            villagers: [],
            outcome: :playing,
            tick: 0,
            next_villager_id: 1,
            next_building_id: 3,
            seed: 1

  @type t :: %__MODULE__{}

  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    seed = rem(abs(Keyword.get(opts, :seed, 12_345)), @mod - 1)
    seed = if seed == 0, do: 1, else: seed
    map_seed = seed
    {enemy, resources} = MapGenerator.generate(seed)
    center = %{id: 1, owner: :player, x: 0.0, z: 0.0, hp: 350, max_hp: 350, progress: 100}

    world = %__MODULE__{
      resources: resources,
      buildings: [center, enemy],
      seed: map_seed,
      stockpile: Keyword.get(opts, :starting_stockpile, %{wood: 30, stone: 15, gold: 20})
    }

    Enum.reduce(1..3, world, fn _, current -> spawn_free(current, center) end)
  end

  @spec command(t(), map()) :: {:ok, t()} | {:error, atom()}
  def command(%__MODULE__{outcome: outcome}, _command) when outcome != :playing,
    do: {:error, :game_over}

  def command(world, %{type: :spawn_villager, building_id: id}) when is_integer(id) do
    center =
      Enum.find(
        world.buildings,
        &(&1.id == id and &1.owner == :player and &1.hp > 0 and &1.progress == 100)
      )

    cond do
      is_nil(center) ->
        {:error, :invalid_building}

      world.stockpile.wood < 5 or world.stockpile.gold < 5 ->
        {:error, :insufficient_resources}

      true ->
        {:ok,
         spawn_free(
           %{
             world
             | stockpile: %{
                 world.stockpile
                 | wood: world.stockpile.wood - 5,
                   gold: world.stockpile.gold - 5
               }
           },
           center
         )}
    end
  end

  def command(world, %{type: :order, villager_ids: ids, order: order})
      when is_list(ids) and length(ids) in 1..100 do
    chosen = MapSet.new(ids)

    cond do
      not valid_selection?(world, ids, chosen) ->
        {:error, :invalid_selection}

      not valid_order?(world, order) ->
        {:error, :invalid_target}

      true ->
        {:ok,
         %{
           world
           | villagers:
               Enum.map(world.villagers, fn v ->
                 if MapSet.member?(chosen, v.id), do: %{v | order: order}, else: v
               end)
         }}
    end
  end

  def command(world, %{type: :stop, villager_ids: ids})
      when is_list(ids) and length(ids) in 1..100 do
    chosen = MapSet.new(ids)

    if valid_selection?(world, ids, chosen) do
      {:ok,
       %{
         world
         | villagers:
             Enum.map(world.villagers, fn v ->
               if MapSet.member?(chosen, v.id), do: %{v | order: nil}, else: v
             end)
       }}
    else
      {:error, :invalid_selection}
    end
  end

  def command(world, %{type: :build, villager_ids: ids, x: x, z: z})
      when is_list(ids) and length(ids) in 1..100 do
    chosen = MapSet.new(ids)
    point = %{x: x, z: z}

    cond do
      not valid_selection?(world, ids, chosen) -> {:error, :invalid_selection}
      not valid_site?(world, point) -> {:error, :invalid_location}
      world.stockpile.wood < 25 or world.stockpile.stone < 15 -> {:error, :insufficient_resources}
      true -> {:ok, start_building(world, chosen, point)}
    end
  end

  def command(_world, _command), do: {:error, :unknown_command}

  defp valid_selection?(world, ids, chosen) do
    Enum.all?(ids, &(is_integer(&1) and &1 > 0)) and
      Enum.any?(world.villagers, &MapSet.member?(chosen, &1.id))
  end

  defp valid_site?(world, point) do
    inside?(point, world.map_radius) and
      Enum.all?(world.buildings, &(&1.hp == 0 or distance(point, &1) >= 8)) and
      Enum.all?(world.resources, &(&1.amount == 0 or distance(point, &1) >= 5))
  end

  defp start_building(world, chosen, %{x: x, z: z}) do
    id = world.next_building_id
    building = %{id: id, owner: :player, x: x, z: z, hp: 1, max_hp: 350, progress: 0}

    villagers =
      Enum.map(world.villagers, fn v ->
        if MapSet.member?(chosen, v.id), do: %{v | order: {:build, id}}, else: v
      end)

    %{
      world
      | stockpile: %{
          world.stockpile
          | wood: world.stockpile.wood - 25,
            stone: world.stockpile.stone - 15
        },
        buildings: world.buildings ++ [building],
        villagers: villagers,
        next_building_id: id + 1
    }
  end

  @spec step(t(), non_neg_integer()) :: t()
  def step(world, count \\ 1) when is_integer(count) and count >= 0 do
    Enum.reduce(1..count//1, world, fn _, current -> step_once(current) end)
  end

  defp step_once(%{outcome: outcome} = world) when outcome != :playing, do: world

  defp step_once(world) do
    tick = world.tick + 1

    {villagers, resources, buildings, stockpile} =
      Enum.reduce(world.villagers, {[], world.resources, world.buildings, world.stockpile}, fn v,
                                                                                               {acc,
                                                                                                resources,
                                                                                                buildings,
                                                                                                stockpile} ->
        {v, resources, buildings, stockpile} =
          step_villager(v, resources, buildings, stockpile, tick)

        {[v | acc], resources, buildings, stockpile}
      end)

    outcome =
      if Enum.any?(buildings, &(&1.owner == :enemy and &1.hp > 0)), do: :playing, else: :victory

    %{
      world
      | tick: tick,
        villagers: Enum.reverse(villagers),
        resources: resources,
        buildings: buildings,
        stockpile: stockpile,
        outcome: outcome
    }
  end

  defp step_villager(%{order: nil} = v, resources, buildings, stockpile, _tick),
    do: {v, resources, buildings, stockpile}

  defp step_villager(%{order: {:move, point}} = v, resources, buildings, stockpile, _tick) do
    v = move(v, point)
    v = if distance(v, point) < 0.1, do: %{v | order: nil}, else: v
    {v, resources, buildings, stockpile}
  end

  defp step_villager(%{order: {:gather, id}} = v, resources, buildings, stockpile, tick) do
    resource = Enum.find(resources, &(&1.id == id))
    center = nearest_center(v, buildings)

    cond do
      is_nil(resource) or (resource.amount == 0 and v.cargo == 0) ->
        {%{v | order: nil}, resources, buildings, stockpile}

      returning?(v, resource) ->
        deliver_or_move(v, resource, center, resources, buildings, stockpile)

      distance(v, resource) > 1.3 ->
        {move(v, resource), resources, buildings, stockpile}

      rem(tick + v.id, 3) != 0 ->
        {v, resources, buildings, stockpile}

      true ->
        resources =
          Enum.map(resources, &deplete_resource(&1, id))

        {%{v | cargo: v.cargo + 1, cargo_kind: resource.kind}, resources, buildings, stockpile}
    end
  end

  defp step_villager(%{order: {:build, id}} = v, resources, buildings, stockpile, _tick) do
    building = Enum.find(buildings, &(&1.id == id))

    cond do
      is_nil(building) or building.hp == 0 or building.progress == 100 ->
        {%{v | order: nil}, resources, buildings, stockpile}

      distance(v, building) > 3.5 ->
        {move(v, building), resources, buildings, stockpile}

      true ->
        buildings = Enum.map(buildings, &progress_building(&1, id))
        {v, resources, buildings, stockpile}
    end
  end

  defp step_villager(%{order: {:attack, id}} = v, resources, buildings, stockpile, tick) do
    building = Enum.find(buildings, &(&1.id == id))

    cond do
      is_nil(building) or building.hp == 0 ->
        {%{v | order: nil}, resources, buildings, stockpile}

      distance(v, building) > 3.5 ->
        {move(v, building), resources, buildings, stockpile}

      rem(tick + v.id, 6) != 0 ->
        {v, resources, buildings, stockpile}

      true ->
        buildings =
          Enum.map(buildings, &damage_building(&1, id))

        {v, resources, buildings, stockpile}
    end
  end

  defp deplete_resource(%{id: id} = r, id), do: %{r | amount: r.amount - 1}
  defp deplete_resource(r, _id), do: r

  defp nearest_center(v, buildings) do
    buildings
    |> Enum.filter(&(&1.owner == :player and &1.hp > 0 and &1.progress == 100))
    |> Enum.min_by(&distance(v, &1), fn -> nil end)
  end

  defp returning?(v, resource) do
    v.cargo >= @capacity or resource.amount == 0 or
      (v.cargo > 0 and v.cargo_kind != resource.kind)
  end

  defp deliver_or_move(v, resource, center, resources, buildings, stockpile) do
    cond do
      is_nil(center) ->
        {v, resources, buildings, stockpile}

      distance(v, center) > 3.5 ->
        {move(v, center), resources, buildings, stockpile}

      true ->
        stockpile = Map.update!(stockpile, v.cargo_kind, &(&1 + v.cargo))
        order = if resource.amount == 0, do: nil, else: v.order
        {%{v | cargo: 0, cargo_kind: nil, order: order}, resources, buildings, stockpile}
    end
  end

  defp progress_building(%{id: id} = b, id) do
    progress = min(100, b.progress + 1)
    %{b | progress: progress, hp: max(1, round(b.max_hp * progress / 100))}
  end

  defp progress_building(b, _id), do: b

  defp damage_building(%{id: id} = b, id), do: %{b | hp: max(0, b.hp - 5)}
  defp damage_building(b, _id), do: b

  defp valid_order?(world, {:move, point}), do: inside?(point, world.map_radius)

  defp valid_order?(world, {:gather, id}),
    do: Enum.any?(world.resources, &(&1.id == id and &1.amount > 0))

  defp valid_order?(world, {:build, id}),
    do: Enum.any?(world.buildings, &(&1.id == id and &1.owner == :player and &1.progress < 100))

  defp valid_order?(world, {:attack, id}),
    do: Enum.any?(world.buildings, &(&1.id == id and &1.owner == :enemy and &1.hp > 0))

  defp valid_order?(_world, _order), do: false

  defp spawn_free(world, center) do
    id = world.next_villager_id

    v = %{
      id: id,
      x: center.x + (rem(id, 3) - 1) * 0.5,
      z: center.z + 3.4,
      hp: 30,
      max_hp: 30,
      cargo: 0,
      cargo_kind: nil,
      order: nil
    }

    %{world | villagers: world.villagers ++ [v], next_villager_id: id + 1}
  end

  defp move(v, point) do
    d = distance(v, point)

    if d <= @speed,
      do: %{v | x: point.x, z: point.z},
      else: %{v | x: v.x + (point.x - v.x) / d * @speed, z: v.z + (point.z - v.z) / d * @speed}
  end

  defp distance(a, b), do: :math.sqrt(:math.pow(a.x - b.x, 2) + :math.pow(a.z - b.z, 2))

  defp inside?(%{x: x, z: z}, radius) when is_number(x) and is_number(z),
    do: abs(x) <= radius - 3 and abs(z) <= radius - 3

  defp inside?(_point, _radius), do: false
end
