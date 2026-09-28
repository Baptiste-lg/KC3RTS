defmodule KC3RTS.Game.World do
  @moduledoc """
  Deterministic, dependency-free simulation state for one match.

  All positions use world-space X/Z coordinates. Rendering and networking are
  deliberately outside this module so the game rules can be tested directly.
  """

  @resource_amount 10
  @resource_min_center_distance 8.0
  @resource_min_spacing 3.0
  @gather_interval 5
  @gather_range 1.1
  @delivery_range 3.4
  @town_center_entrance_z 3.2
  @move_speed 0.18
  @villager_capacity 5
  @villager_cost 5
  @max_resource_placement_attempts 1_000
  @random_modulus 2_147_483_647

  defstruct map_radius: 32.0,
            town_center: %{x: 0.0, z: 0.0},
            resources: [],
            villagers: [],
            stockpile: 20,
            tick: 0,
            next_villager_id: 1,
            seed: 1

  @type point :: %{x: float(), z: float()}
  @type resource :: %{
          id: pos_integer(),
          x: float(),
          z: float(),
          amount: non_neg_integer(),
          initial_amount: pos_integer()
        }
  @type villager :: %{
          id: pos_integer(),
          x: float(),
          z: float(),
          cargo: non_neg_integer(),
          target: :town_center | {:resource, pos_integer()} | nil
        }
  @type t :: %__MODULE__{}

  @doc "Creates a deterministic map. Options: `:seed`, `:resource_count`, and `:starting_stockpile`."
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    seed = normalize_seed(Keyword.get(opts, :seed, 12_345))
    resource_count = Keyword.get(opts, :resource_count, 24)

    {resources, final_seed} =
      place_resources(resource_count, 1, seed, [], @max_resource_placement_attempts)

    %__MODULE__{
      resources: resources,
      stockpile: Keyword.get(opts, :starting_stockpile, 20),
      seed: final_seed
    }
  end

  @doc "Recruits one villager at the town center for #{@villager_cost} resources."
  @spec spawn_villager(t()) :: {:ok, t(), villager()} | {:error, :insufficient_resources, t()}
  def spawn_villager(%__MODULE__{stockpile: stockpile} = world) when stockpile < @villager_cost do
    {:error, :insufficient_resources, world}
  end

  def spawn_villager(%__MODULE__{} = world) do
    id = world.next_villager_id
    offset = rem(id - 1, 3) * 0.45

    villager = %{
      id: id,
      x: world.town_center.x + offset,
      z: world.town_center.z + @town_center_entrance_z,
      cargo: 0,
      target: nil
    }

    world = %{
      world
      | stockpile: world.stockpile - @villager_cost,
        villagers: world.villagers ++ [villager],
        next_villager_id: id + 1
    }

    {:ok, world, villager}
  end

  @doc "Advances the simulation by `count` fixed ticks (one tick is 100 ms)."
  @spec step(t(), non_neg_integer()) :: t()
  def step(%__MODULE__{} = world, count \\ 1) when is_integer(count) and count >= 0 do
    Enum.reduce(1..count//1, world, fn _, current -> step_once(current) end)
  end

  defp step_once(%__MODULE__{} = world) do
    tick = world.tick + 1

    {villagers, resources, stockpile} =
      Enum.reduce(world.villagers, {[], world.resources, world.stockpile}, fn villager,
                                                                              {villagers,
                                                                               resources,
                                                                               stockpile} ->
        {villager, resources, stockpile} =
          step_villager(villager, resources, world.town_center, stockpile, tick)

        {[villager | villagers], resources, stockpile}
      end)

    %{
      world
      | tick: tick,
        villagers: Enum.reverse(villagers),
        resources: resources,
        stockpile: stockpile
    }
  end

  defp step_villager(villager, resources, town_center, stockpile, tick) do
    target = choose_target(villager, resources)
    villager = %{villager | target: target}

    case target do
      :town_center ->
        move_or_deliver(villager, resources, town_center, stockpile)

      {:resource, resource_id} ->
        gather_or_move(villager, resources, resource_id, stockpile, tick)

      nil ->
        {villager, resources, stockpile}
    end
  end

  defp choose_target(%{cargo: cargo}, _resources) when cargo >= @villager_capacity,
    do: :town_center

  defp choose_target(%{target: :town_center, cargo: cargo}, _resources) when cargo > 0,
    do: :town_center

  defp choose_target(%{target: {:resource, id}, cargo: cargo} = villager, resources) do
    case Enum.find(resources, &(&1.id == id and &1.amount > 0)) do
      nil when cargo > 0 ->
        :town_center

      nil ->
        case nearest_resource(villager, resources) do
          nil -> nil
          resource -> {:resource, resource.id}
        end

      _resource ->
        {:resource, id}
    end
  end

  defp choose_target(%{cargo: cargo} = villager, resources) do
    case nearest_resource(villager, resources) do
      nil when cargo > 0 -> :town_center
      nil -> nil
      resource -> {:resource, resource.id}
    end
  end

  defp move_or_deliver(villager, resources, town_center, stockpile) do
    if distance(villager, town_center) <= @delivery_range do
      {Map.put(villager, :cargo, 0) |> Map.put(:target, nil), resources,
       stockpile + villager.cargo}
    else
      {move_towards(villager, town_center), resources, stockpile}
    end
  end

  defp gather_or_move(villager, resources, resource_id, stockpile, tick) do
    resource = Enum.find(resources, &(&1.id == resource_id))

    cond do
      distance(villager, resource) > @gather_range ->
        {move_towards(villager, resource), resources, stockpile}

      rem(tick + villager.id, @gather_interval) == 0 ->
        resources =
          Enum.map(resources, fn
            %{id: ^resource_id, amount: amount} = node when amount > 0 ->
              %{node | amount: amount - 1}

            node ->
              node
          end)

        {%{villager | cargo: villager.cargo + 1}, resources, stockpile}

      true ->
        {villager, resources, stockpile}
    end
  end

  defp nearest_resource(villager, resources) do
    resources
    |> Enum.filter(&(&1.amount > 0))
    |> Enum.min_by(&distance(villager, &1), fn -> nil end)
  end

  defp move_towards(villager, target) do
    dx = target.x - villager.x
    dz = target.z - villager.z
    distance = :math.sqrt(dx * dx + dz * dz)

    if distance <= @move_speed do
      %{villager | x: target.x, z: target.z}
    else
      %{
        villager
        | x: villager.x + dx / distance * @move_speed,
          z: villager.z + dz / distance * @move_speed
      }
    end
  end

  defp distance(left, right) do
    dx = left.x - right.x
    dz = left.z - right.z
    :math.sqrt(dx * dx + dz * dz)
  end

  defp place_resources(0, _id, seed, resources, _attempts), do: {Enum.reverse(resources), seed}

  defp place_resources(_count, _id, seed, resources, 0), do: {Enum.reverse(resources), seed}

  defp place_resources(count, id, seed, resources, attempts) do
    {x, seed} = random_coordinate(seed, 29.0)
    {z, seed} = random_coordinate(seed, 29.0)
    candidate = %{id: id, x: x, z: z, amount: @resource_amount, initial_amount: @resource_amount}

    if valid_resource_location?(candidate, resources) do
      place_resources(
        count - 1,
        id + 1,
        seed,
        [candidate | resources],
        @max_resource_placement_attempts
      )
    else
      place_resources(count, id, seed, resources, attempts - 1)
    end
  end

  defp valid_resource_location?(candidate, resources) do
    distance(candidate, %{x: 0.0, z: 0.0}) >= @resource_min_center_distance and
      Enum.all?(resources, &(distance(candidate, &1) >= @resource_min_spacing))
  end

  defp random_coordinate(seed, radius) do
    seed = rem(seed * 48_271, @random_modulus)
    normalized = seed / @random_modulus
    coordinate = Float.round(normalized * radius * 2 - radius, 1)
    {coordinate, seed}
  end

  defp normalize_seed(seed) when is_integer(seed) do
    seed = rem(abs(seed), @random_modulus - 1)
    if seed == 0, do: 1, else: seed
  end
end
