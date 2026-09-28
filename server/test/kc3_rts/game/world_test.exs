defmodule KC3RTS.Game.WorldTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.World

  test "generates a seeded map with three villagers, three resource types and a passive enemy base" do
    world = World.new(seed: 1234)
    assert World.new(seed: 1234) == world
    assert length(world.villagers) == 3
    assert world.map_radius == 52.0
    assert length(world.resources) == 118
    assert Enum.count(world.resources, &(&1.kind == :wood)) == 104
    assert Enum.count(world.resources, &(&1.kind == :stone)) == 8
    assert Enum.count(world.resources, &(&1.kind == :gold)) == 6

    assert Enum.all?(world.resources, fn r ->
             r.amount == %{wood: 160, stone: 480, gold: 520}[r.kind]
           end)

    assert Enum.sort(Enum.uniq(Enum.map(world.resources, & &1.kind))) == [:gold, :stone, :wood]
    assert Enum.map(world.buildings, & &1.owner) == [:player, :enemy]
    assert Enum.at(world.buildings, 1).hp == 250
  end

  test "map positions match the solo browser generator for a shared seed" do
    world = World.new(seed: 12_345)
    coordinates = Enum.map(world.resources, &{&1.id, &1.x, &1.z})

    assert Enum.filter(coordinates, fn {id, _, _} -> id in [3, 9, 14, 15, 36, 81, 118] end) == [
             {3, -8.2, 20.7},
             {9, -42.7, -17.0},
             {14, -11.2, 33.2},
             {15, 14.2, 18.9},
             {36, 24.0, -31.1},
             {81, -34.7, 9.5},
             {118, -41.4, -29.0}
           ]
  end

  test "gather orders deliver only the ordered resource" do
    world = World.new(seed: 1234)
    node = Enum.find(world.resources, &(&1.kind == :wood))
    assert World.step(world, 100).stockpile == world.stockpile

    assert {:ok, ordered} =
             World.command(world, %{type: :order, villager_ids: [1], order: {:gather, node.id}})

    later = World.step(ordered, 500)
    assert later.stockpile.wood > world.stockpile.wood
    assert later.stockpile.stone == world.stockpile.stone
  end

  test "a center cannot overlap the enlarged stone or gold footprint" do
    world = World.new(seed: 1234)
    ore = Enum.find(world.resources, &(&1.kind == :stone))

    assert {:error, :invalid_location} =
             World.command(world, %{type: :build, villager_ids: [1], x: ore.x + 6, z: ore.z})
  end

  test "validates building placement, builds a town center and recruits" do
    world = World.new(seed: 1234)

    assert {:error, :invalid_location} =
             World.command(world, %{type: :build, villager_ids: [1], x: 0, z: 0})

    point = %{x: 22.0, z: -22.0}
    world = %{world | resources: Enum.reject(world.resources, &(distance(&1, point) < 5))}

    assert {:ok, started} =
             World.command(world, Map.merge(point, %{type: :build, villager_ids: [1, 2, 3]}))

    assert List.last(started.buildings).progress == 0
    built = World.step(started, 300)
    assert List.last(built.buildings).progress == 100
    assert {:ok, recruited} = World.command(built, %{type: :spawn_villager, building_id: 3})
    assert length(recruited.villagers) == 4
  end

  test "stop cancels only selected villagers' orders" do
    world = World.new(seed: 1234)

    assert {:ok, moving} =
             World.command(world, %{
               type: :order,
               villager_ids: [1, 2],
               order: {:move, %{x: 10, z: 0}}
             })

    assert {:ok, stopped} = World.command(moving, %{type: :stop, villager_ids: [1]})
    assert Enum.at(stopped.villagers, 0).order == nil
    assert match?({:move, _}, Enum.at(stopped.villagers, 1).order)
  end

  test "villagers cross the expanded map quickly" do
    world = World.new(seed: 1234)

    assert {:ok, ordered} =
             World.command(world, %{
               type: :order,
               villager_ids: [1],
               order: {:move, %{x: 40.0, z: 0.0}}
             })

    moved = ordered |> World.step(100) |> Map.fetch!(:villagers) |> hd()
    assert moved.x == 40.0
    assert moved.order == nil
  end

  test "villagers can destroy the enemy base and win" do
    world = World.new(seed: 1234)
    enemy = Enum.at(world.buildings, 1)
    world = %{world | villagers: Enum.map(world.villagers, &%{&1 | x: enemy.x + 3, z: enemy.z})}

    assert {:ok, ordered} =
             World.command(world, %{type: :order, villager_ids: [1, 2, 3], order: {:attack, 2}})

    finished = World.step(ordered, 200)
    assert Enum.at(finished.buildings, 1).hp == 0
    assert finished.outcome == :victory
  end

  defp distance(a, b), do: :math.sqrt(:math.pow(a.x - b.x, 2) + :math.pow(a.z - b.z, 2))
end
