defmodule KC3RTS.Game.KC3NavigationTest do
  use ExUnit.Case, async: false
  alias KC3RTS.Game.{KC3Match, KC3Worker, Snapshot}
  import KC3RTS.KC3Boundary

  @moduletag skip: is_nil(System.get_env("KC3RTS_KC3S"))
  @moduletag timeout: 300_000
  @root Path.expand("../../../..", __DIR__)

  for count <- [50, 100] do
    test "#{count} units arrive through the real port without overlap" do
      count = unquote(count)

      worker =
        start_supervised!(
          {KC3Worker,
           binary: System.fetch_env!("KC3RTS_KC3S"),
           script: Path.join(@root, "kc3/tests/army_worker.kc3")}
        )

      assert {:ok, %{"state" => opening}} =
               KC3Worker.request(worker, Map.put(request(1, "new_match"), "seed", count))

      payload =
        request(2, "command", 1)
        |> Map.merge(%{
          "actor_slot" => 1,
          "command" => %{
            "type" => "move",
            "entity_ids" => Enum.to_list(1..count),
            "x" => 3072,
            "z" => 0
          }
        })

      {ack_us, {:ok, %{"accepted" => true, "state" => moving}}} =
        :timer.tc(fn -> KC3Worker.request(worker, payload, 2_000) end)

      goals = Map.new(moving["entities"], &{&1["id"], &1["order"]["goal"]})
      assert map_size(goals) == count
      assert length(Enum.uniq(Map.values(goals))) == count

      {final, times, sizes} =
        Enum.reduce_while(1..450, {moving, [], []}, fn tick, {previous, times, sizes} ->
          {elapsed, result} =
            :timer.tc(fn ->
              KC3Worker.request(worker, request(tick + 2, "tick", previous["revision"]), 2_000)
            end)

          assert {:ok, %{"accepted" => true, "state" => state}} = result
          assert state["rng_state"] == opening["rng_state"]
          assert_geometry(state["entities"], state["map"], [])
          before = Snapshot.from_world(%KC3Match{state: previous})
          current = Snapshot.from_world(%KC3Match{state: state})
          bytes = byte_size(Jason.encode!(Snapshot.patch(before, current)))
          result = {state, [elapsed | times], [bytes | sizes]}

          if Enum.all?(state["entities"], &is_nil(&1["order"])),
            do: {:halt, result},
            else: {:cont, result}
        end)

      IO.puts(
        "KC3 navigation #{count}: ticks=#{final["tick"]} ack_us=#{ack_us} p95_us=#{percentile(times, 0.95)} p99_us=#{percentile(times, 0.99)} max_patch_bytes=#{Enum.max(sizes)}"
      )

      stranded = Enum.reject(final["entities"], &arrived?(&1, goals[&1["id"]], final["map"]))
      assert stranded == [], inspect(Enum.map(stranded, &Map.take(&1, ~w(id x z status order))))
      assert Enum.all?(final["entities"], &is_nil(&1["status"]))
      assert Enum.max(sizes) * 10 < 40_000

      unobstructed_ticks =
        Enum.map(moving["entities"], fn entity ->
          {x, z} = goal_point(goals[entity["id"]], final["map"])
          ceil((abs(entity["x"] - x) + abs(entity["z"] - z)) / 64)
        end)
        |> Enum.max()

      assert final["tick"] <= 2 * unobstructed_ticks + 50

      IO.puts(
        Jason.encode!(%{
          benchmark: "kc3_navigation",
          units: count,
          ticks: final["tick"],
          arrival_rate: (count - length(stranded)) / count,
          ack_us: ack_us,
          p95_us: percentile(times, 0.95),
          p99_us: percentile(times, 0.99),
          max_patch_bytes: Enum.max(sizes),
          timing_budget_met:
            ack_us < 200_000 and percentile(times, 0.95) < 20_000 and
              percentile(times, 0.99) < 50_000
        })
      )
    end
  end

  test "seeded obstruction scenes preserve geometry every tick" do
    {output, status} =
      System.cmd(
        Path.expand(System.fetch_env!("KC3RTS_KC3S")),
        ["--load", Path.join(@root, "kc3/tests/navigation_scenes.kc3"), "--quit"],
        stderr_to_stdout: true
      )

    assert status == 0, output
    refute output =~ "FAIL:"
    refute output =~ "env_"

    reference =
      @root
      |> Path.join("fixtures/kc3_navigation_traces.json")
      |> File.read!()
      |> Jason.decode!()

    output
    |> String.split("\n", trim: true)
    |> Enum.filter(&String.starts_with?(&1, "{"))
    |> Enum.group_by(fn line -> Jason.decode!(line)["scene"] end)
    |> Enum.each(fn {scene, lines} ->
      hash = :crypto.hash(:sha256, Enum.map(lines, &[&1, "\n"]))
      assert Base.encode16(hash, case: :lower) == reference["scenes"][scene], scene
    end)

    frames =
      output
      |> String.split("\n", trim: true)
      |> Enum.filter(&String.starts_with?(&1, "{"))
      |> Enum.map(&Jason.decode!/1)

    assert length(frames) > 100

    for frame <- frames do
      units =
        Enum.map(frame["units"], fn [id, x, z, size, _, _] ->
          %{"id" => id, "x" => x, "z" => z, "size" => size}
        end)

      terrain =
        Enum.map(frame["map"]["blocked"], fn cell ->
          map = frame["map"]

          [
            map["origin_x"] + (rem(cell, map["width"]) + 0.5) * map["cell_size"],
            map["origin_z"] + (div(cell, map["width"]) + 0.5) * map["cell_size"],
            map["cell_size"]
          ]
        end)

      assert_geometry(units, frame["map"], frame["obstacles"] ++ terrain)
    end

    scenes = Enum.group_by(frames, & &1["scene"])

    assert Enum.sort(Map.keys(scenes)) ==
             ~w(caravan corridor depletion hall new_building opposing)

    for {name, frames} <- scenes do
      assert Enum.all?(List.last(frames)["units"], fn [_, _, _, _, pending, status] ->
               !pending and is_nil(status)
             end),
             name
    end
  end

  defp arrived?(entity, goal, map) do
    {x, z} = goal_point(goal, map)
    entity["x"] == x and entity["z"] == z
  end

  defp goal_point(goal, map) do
    width = div(map["width"] * map["cell_size"], 256)

    {map["origin_x"] + rem(goal, width) * 256 + 128,
     map["origin_z"] + div(goal, width) * 256 + 128}
  end

  defp assert_geometry(units, map, obstacles) do
    Enum.with_index(units)
    |> Enum.each(fn {unit, index} ->
      size = Map.get(unit, "size", 128)
      assert unit["x"] - size / 2 >= map["origin_x"]
      assert unit["z"] - size / 2 >= map["origin_z"]
      assert unit["x"] + size / 2 <= map["origin_x"] + map["width"] * map["cell_size"]
      assert unit["z"] + size / 2 <= map["origin_z"] + map["height"] * map["cell_size"]

      for other <- Enum.drop(units, index + 1),
          do:
            refute(
              overlap?(unit, size, other["x"], other["z"], Map.get(other, "size", 128)),
              inspect({unit, other})
            )

      for [x, z, other_size] <- obstacles,
          do: refute(overlap?(unit, size, x, z, other_size), inspect({unit, [x, z, other_size]}))
    end)
  end

  defp overlap?(unit, size, x, z, other_size),
    do: abs(unit["x"] - x) * 2 < size + other_size and abs(unit["z"] - z) * 2 < size + other_size

  defp percentile(values, p), do: values |> Enum.sort() |> Enum.at(ceil(length(values) * p) - 1)
end
