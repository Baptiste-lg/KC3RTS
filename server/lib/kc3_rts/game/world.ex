defmodule KC3RTS.Game.World do
  @moduledoc "Deterministic RTS simulation. One tick is 100 ms."
  alias KC3RTS.Game.MapGenerator
  @mod 2_147_483_647
  @speed 0.55
  @unit_radius 0.45
  @unit_spacing @unit_radius * 2
  @collision_cell_size 1.8
  @diagonal 0.7071067811865476
  @spawn_directions [
    {0.0, 1.0},
    {@diagonal, @diagonal},
    {1.0, 0.0},
    {@diagonal, -@diagonal},
    {0.0, -1.0},
    {-@diagonal, -@diagonal},
    {-1.0, 0.0},
    {-@diagonal, @diagonal}
  ]
  @capacity 5
  @gather_interval_ticks 3
  @attack_range 6.0
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

  def unit_hitbox_radius, do: @unit_radius

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

    Enum.reduce(1..3, world, fn _, current ->
      {:ok, spawned} = spawn_free(current, center)
      spawned
    end)
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
        with {:ok, spawned} <- spawn_free(world, center) do
          {:ok,
           %{
             spawned
             | stockpile: %{
                 spawned.stockpile
                 | wood: spawned.stockpile.wood - 5,
                   gold: spawned.stockpile.gold - 5
               }
           }}
        end
    end
  end

  def command(world, %{type: :order, villager_ids: ids, order: order})
      when is_list(ids) and length(ids) in 1..100 do
    chosen = MapSet.new(ids)

    cond do
      not valid_selection?(world, ids, chosen) ->
        {:error, :invalid_selection}

      invalid_move_location?(world, order) ->
        {:error, :invalid_location}

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

  def command(_world, %{type: type, villager_ids: _ids})
      when type in [:order, :stop, :build],
      do: {:error, :invalid_selection}

  def command(_world, _command), do: {:error, :unknown_command}

  defp valid_selection?(world, ids, chosen) do
    Enum.all?(ids, &(is_integer(&1) and &1 > 0)) and
      MapSet.size(chosen) == length(ids) and
      MapSet.subset?(
        chosen,
        world.villagers |> Enum.filter(&(&1.hp > 0)) |> Enum.map(& &1.id) |> MapSet.new()
      )
  end

  defp valid_site?(world, point) do
    inside?(point, world.map_radius) and
      Enum.all?(world.buildings, &(&1.hp == 0 or distance(point, &1) >= 8)) and
      Enum.all?(world.resources, &(&1.amount == 0 or distance(point, &1) >= build_clearance(&1)))
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

    living = Enum.filter(world.villagers, &(&1.hp > 0))
    positions = Map.new(living, &{&1.id, &1})
    cells = Enum.reduce(living, %{}, &put_in_cell(&2, &1))

    {villagers, resources, buildings, stockpile, _positions, _cells} =
      Enum.reduce(
        living,
        {[], world.resources, world.buildings, world.stockpile, positions, cells},
        fn v, {acc, resources, buildings, stockpile, positions, cells} ->
          blockers = movement_blockers(v, positions, cells)

          {moved, resources, buildings, stockpile} =
            step_villager(v, resources, buildings, stockpile, tick, blockers, world.map_radius)

          {[moved | acc], resources, buildings, stockpile, Map.put(positions, v.id, moved),
           update_cell(cells, v, moved)}
        end
      )

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

  defp step_villager(
         %{order: nil} = v,
         resources,
         buildings,
         stockpile,
         _tick,
         _blockers,
         _radius
       ),
       do: {v, resources, buildings, stockpile}

  defp step_villager(
         %{order: {:move, point}} = v,
         resources,
         buildings,
         stockpile,
         _tick,
         blockers,
         radius
       ) do
    v = move(v, point, 0, blockers, radius)

    arrived = distance(v, point) < 0.1
    shared_goal = Enum.any?(blockers, &(distance(&1, point) < @unit_spacing))

    v =
      if arrived or (shared_goal and distance(v, point) <= @unit_spacing * 2),
        do: %{v | order: nil},
        else: v

    {v, resources, buildings, stockpile}
  end

  defp step_villager(
         %{order: {:gather, id}} = v,
         resources,
         buildings,
         stockpile,
         tick,
         blockers,
         radius
       ) do
    resource = Enum.find(resources, &(&1.id == id))
    center = nearest_center(v, buildings)

    cond do
      is_nil(resource) or (resource.amount == 0 and v.cargo == 0) ->
        {%{v | order: nil}, resources, buildings, stockpile}

      returning?(v, resource) ->
        deliver_or_move(v, resource, center, resources, buildings, stockpile, blockers, radius)

      distance(v, resource) > gather_range(resource) + 0.01 ->
        {move(v, resource, gather_range(resource), blockers, radius), resources, buildings,
         stockpile}

      rem(tick + v.id, @gather_interval_ticks) != 0 ->
        {v, resources, buildings, stockpile}

      true ->
        resources =
          Enum.map(resources, &deplete_resource(&1, id))

        {%{v | cargo: v.cargo + 1, cargo_kind: resource.kind}, resources, buildings, stockpile}
    end
  end

  defp step_villager(
         %{order: {:build, id}} = v,
         resources,
         buildings,
         stockpile,
         _tick,
         blockers,
         radius
       ) do
    building = Enum.find(buildings, &(&1.id == id))

    cond do
      is_nil(building) or building.hp == 0 or building.progress == 100 ->
        {%{v | order: nil}, resources, buildings, stockpile}

      distance(v, building) > 3.5 ->
        {move(v, building, 3.5, blockers, radius), resources, buildings, stockpile}

      true ->
        buildings = Enum.map(buildings, &progress_building(&1, id))
        {v, resources, buildings, stockpile}
    end
  end

  defp step_villager(
         %{order: {:attack, id}} = v,
         resources,
         buildings,
         stockpile,
         tick,
         blockers,
         radius
       ) do
    building = Enum.find(buildings, &(&1.id == id))

    cond do
      is_nil(building) or building.hp == 0 ->
        {%{v | order: nil}, resources, buildings, stockpile}

      distance(v, building) > @attack_range + 0.01 ->
        {move(v, building, @attack_range, blockers, radius), resources, buildings, stockpile}

      rem(tick + v.id, v.attack_interval_ticks) != 0 ->
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

  defp deliver_or_move(v, resource, center, resources, buildings, stockpile, blockers, radius) do
    cond do
      is_nil(center) ->
        {v, resources, buildings, stockpile}

      distance(v, center) > 3.5 ->
        {move(v, center, 3.5, blockers, radius), resources, buildings, stockpile}

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

  defp invalid_move_location?(world, {:move, point}),
    do: not inside?(point, world.map_radius)

  defp invalid_move_location?(_world, _order), do: false

  defp spawn_free(world, center) do
    id = world.next_villager_id

    point =
      Enum.find_value(0..255, fn slot ->
        {dx, dz} = Enum.at(@spawn_directions, rem(slot, 8))
        ring_radius = 3.4 + div(slot, 8) * 1.05
        candidate = %{x: center.x + dx * ring_radius, z: center.z + dz * ring_radius}

        if free?(candidate, world.villagers, world.map_radius), do: candidate
      end)

    if point do
      v = %{
        id: id,
        x: point.x,
        z: point.z,
        hp: 30,
        max_hp: 30,
        attack_interval_ticks: 6,
        cargo: 0,
        cargo_kind: nil,
        order: nil
      }

      {:ok, %{world | villagers: world.villagers ++ [v], next_villager_id: id + 1}}
    else
      {:error, :no_spawn_space}
    end
  end

  defp move(v, point, range, blockers, radius) do
    d = distance(v, point)

    if d <= range do
      v
    else
      dx = (point.x - v.x) / d
      dz = (point.z - v.z) / d
      step = min(@speed, d - range)
      candidate = movement_candidate(v, dx, dz, step, blockers, radius)

      if candidate, do: %{v | x: candidate.x, z: candidate.z}, else: v
    end
  end

  defp movement_candidate(v, dx, dz, step, blockers, radius) do
    direct = %{x: v.x + dx * step, z: v.z + dz * step}

    if free?(direct, blockers, radius) do
      direct
    else
      steering_candidate(v, dx, dz, blockers, radius)
    end
  end

  defp steering_candidate(v, dx, dz, blockers, radius) do
    side = if rem(v.id, 2) == 1, do: 1.0, else: -1.0

    Enum.find_value(
      [
        {@diagonal, side * @diagonal},
        {@diagonal, -side * @diagonal},
        {0.0, side},
        {0.0, -side},
        {-@diagonal, side * @diagonal},
        {-@diagonal, -side * @diagonal},
        {-1.0, 0.0}
      ],
      fn {cosine, sine} ->
        alternative = %{
          x: v.x + (dx * cosine - dz * sine) * @speed,
          z: v.z + (dx * sine + dz * cosine) * @speed
        }

        if free?(alternative, blockers, radius), do: alternative
      end
    )
  end

  defp free?(point, villagers, radius) do
    inside?(point, radius) and
      Enum.all?(villagers, fn v ->
        dx = point.x - v.x
        dz = point.z - v.z
        v.hp <= 0 or dx * dx + dz * dz >= @unit_spacing * @unit_spacing - 1.0e-9
      end)
  end

  defp cell(v), do: {floor(v.x / @collision_cell_size), floor(v.z / @collision_cell_size)}

  defp put_in_cell(cells, v) do
    Map.update(cells, cell(v), [v.id], &[v.id | &1])
  end

  defp update_cell(cells, old, moved) do
    if cell(old) == cell(moved) do
      cells
    else
      cells
      |> Map.update!(cell(old), &List.delete(&1, old.id))
      |> put_in_cell(moved)
    end
  end

  defp nearby_units(v, positions, cells) do
    {x, z} = cell(v)

    for dx <- -1..1,
        dz <- -1..1,
        id <- Map.get(cells, {x + dx, z + dz}, []),
        id != v.id,
        do: Map.fetch!(positions, id)
  end

  defp movement_blockers(%{order: nil}, _positions, _cells), do: []

  defp movement_blockers(%{order: {:move, point}} = v, positions, cells) do
    nearby = nearby_units(v, positions, cells)

    if distance(v, point) <= @unit_spacing * 2 do
      nearby ++ nearby_units(%{v | x: point.x, z: point.z}, positions, cells)
    else
      nearby
    end
  end

  defp movement_blockers(v, positions, cells), do: nearby_units(v, positions, cells)

  defp gather_range(%{kind: :wood}), do: 3.0
  defp gather_range(_ore), do: 4.3
  defp build_clearance(%{kind: :wood}), do: 5
  defp build_clearance(_ore), do: 7.5

  defp distance(a, b), do: :math.sqrt(:math.pow(a.x - b.x, 2) + :math.pow(a.z - b.z, 2))

  defp inside?(%{x: x, z: z}, radius) when is_number(x) and is_number(z),
    do: abs(x) <= radius - 3 and abs(z) <= radius - 3

  defp inside?(_point, _radius), do: false
end
