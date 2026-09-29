defmodule KC3RTS.Game.ParityFixture do
  @moduledoc false
  alias KC3RTS.Game.Snapshot
  alias KC3RTS.Game.World

  def scenarios_path, do: Path.expand("../../../fixtures/parity_scenarios.json", __DIR__)
  def golden_path, do: Path.expand("../../../fixtures/parity_v3.json", __DIR__)

  def scenarios do
    scenarios_path() |> File.read!() |> Jason.decode!() |> Map.fetch!("scenarios")
  end

  def replay(scenario) do
    world = World.new(seed: scenario["seed"]) |> setup(Map.get(scenario, "setup", %{}))

    {world, results} =
      Enum.reduce(scenario["steps"], {world, []}, fn step, {current, results} ->
        {next, result} = advance(current, step)
        {next, [result | results]}
      end)

    %{
      "name" => scenario["name"],
      "seed" => scenario["seed"],
      "results" => Enum.reverse(results),
      "state" => canonical(world)
    }
  end

  def canonical(world) do
    world
    |> Snapshot.from_world()
    |> Map.put(:next_villager_id, world.next_villager_id)
    |> Map.put(:next_building_id, world.next_building_id)
    |> round_coordinates()
    |> Jason.encode!()
    |> Jason.decode!()
  end

  defp setup(world, setup) do
    amounts = Map.get(setup, "resource_amounts", %{})

    resources =
      world.resources
      |> Enum.map(fn resource ->
        case Map.fetch(amounts, Integer.to_string(resource.id)) do
          {:ok, amount} -> %{resource | amount: amount}
          :error -> resource
        end
      end)
      |> maybe_clear(setup["clear_resources_near"])

    buildings = set_enemy_hp(world.buildings, setup["enemy_hp"])

    %{world | resources: resources, buildings: buildings}
  end

  defp advance(world, %{"ticks" => ticks}), do: {World.step(world, ticks), "tick"}

  defp advance(world, %{"command" => input}) do
    case World.command(world, command(input)) do
      {:ok, next} -> {next, "ok"}
      {:error, reason} -> {world, Atom.to_string(reason)}
    end
  end

  defp set_enemy_hp(buildings, nil), do: buildings

  defp set_enemy_hp(buildings, hp) do
    Enum.map(buildings, fn building ->
      if building.owner == :enemy, do: %{building | hp: hp}, else: building
    end)
  end

  defp maybe_clear(resources, nil), do: resources

  defp maybe_clear(resources, point) do
    Enum.reject(resources, fn r ->
      :math.pow(r.x - point["x"], 2) + :math.pow(r.z - point["z"], 2) <
        :math.pow(point["radius"], 2)
    end)
  end

  defp command(%{"type" => "spawn_villager", "building_id" => id}),
    do: %{type: :spawn_villager, building_id: id}

  defp command(%{"type" => "stop", "villager_ids" => ids}),
    do: %{type: :stop, villager_ids: ids}

  defp command(%{"type" => "build", "villager_ids" => ids, "x" => x, "z" => z}),
    do: %{type: :build, villager_ids: ids, x: x, z: z}

  defp command(%{"type" => "order", "villager_ids" => ids, "order" => order}) do
    parsed =
      case order do
        %{"kind" => "move", "x" => x, "z" => z} -> {:move, %{x: x, z: z}}
        %{"kind" => "gather", "id" => id} -> {:gather, id}
        %{"kind" => "build", "id" => id} -> {:build, id}
        %{"kind" => "attack", "id" => id} -> {:attack, id}
      end

    %{type: :order, villager_ids: ids, order: parsed}
  end

  defp round_coordinates(value) when is_list(value), do: Enum.map(value, &round_coordinates/1)

  defp round_coordinates(value) when is_map(value) do
    Map.new(value, fn {key, item} -> {key, round_coordinates(item)} end)
  end

  defp round_coordinates(value) when is_float(value) do
    rounded = Float.round(value, 6)
    if rounded == 0.0, do: 0.0, else: rounded
  end

  defp round_coordinates(value), do: value
end
