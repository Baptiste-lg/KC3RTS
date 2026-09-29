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

  test "a worker stops beside a resource before harvesting" do
    world = World.new(seed: 1234)
    node = Enum.find(world.resources, &(&1.kind == :wood))

    world = %{
      world
      | villagers:
          Enum.map(world.villagers, fn v ->
            if v.id == 1, do: %{v | x: node.x + 3.4, z: node.z}, else: v
          end)
    }

    assert {:ok, ordered} =
             World.command(world, %{type: :order, villager_ids: [1], order: {:gather, node.id}})

    worker = ordered |> World.step() |> Map.fetch!(:villagers) |> hd()
    assert_in_delta distance(worker, node), 3.0, 0.0001
    gathered = World.step(ordered, 2)
    assert Enum.find(gathered.resources, &(&1.id == node.id)).amount == node.amount - 1
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

  test "every selected villager must exist and be alive before any command changes state" do
    world = World.new(seed: 1234)

    world = %{
      world
      | villagers: Enum.map(world.villagers, fn v -> if v.id == 3, do: %{v | hp: 0}, else: v end)
    }

    for ids <- [[1, 999], [1, 0], [1, -2], [1, 3], [1, 1], [], List.duplicate(1, 101)] do
      assert {:error, :invalid_selection} =
               World.command(world, %{type: :stop, villager_ids: ids})

      assert {:error, :invalid_selection} =
               World.command(world, %{
                 type: :order,
                 villager_ids: ids,
                 order: {:move, %{x: 5, z: 5}}
               })

      assert {:error, :invalid_selection} =
               World.command(world, %{type: :build, villager_ids: ids, x: 22, z: -22})
    end

    assert world.stockpile == %{wood: 30, stone: 15, gold: 20}
    assert length(world.buildings) == 2
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

  test "recruitment finds free positions without charging for a full spawn area" do
    world = World.new(seed: 1234, starting_stockpile: %{wood: 1_000, stone: 15, gold: 1_000})

    crowded =
      Enum.reduce(1..37, world, fn _, current ->
        assert {:ok, next} = World.command(current, %{type: :spawn_villager, building_id: 1})
        assert_spaced(next.villagers)
        next
      end)

    assert length(crowded.villagers) == 40

    full = %{crowded | map_radius: 4.0}

    assert {:error, :no_spawn_space} =
             World.command(full, %{type: :spawn_villager, building_id: 1})

    assert full.stockpile == crowded.stockpile
    assert full.next_villager_id == crowded.next_villager_id
  end

  test "crowded move orders preserve hitboxes at every tick" do
    world = World.new(seed: 1234, starting_stockpile: %{wood: 1_000, stone: 15, gold: 1_000})

    world =
      Enum.reduce(1..21, world, fn _, current ->
        {:ok, next} = World.command(current, %{type: :spawn_villager, building_id: 1})
        next
      end)

    ids = Enum.map(world.villagers, & &1.id)

    assert {:ok, ordered} =
             World.command(world, %{
               type: :order,
               villager_ids: ids,
               order: {:move, %{x: 13.0, z: 13.0}}
             })

    final =
      Enum.reduce(1..90, ordered, fn _, current ->
        next = World.step(current)
        assert_spaced(next.villagers)
        next
      end)

    assert Enum.any?(final.villagers, &(distance(&1, %{x: 13, z: 13}) < 2))
  end

  test "a hundred villagers retain spacing around one destination" do
    world = World.new(seed: 7, starting_stockpile: %{wood: 1_000, stone: 15, gold: 1_000})

    world =
      Enum.reduce(1..97, world, fn _, current ->
        {:ok, next} = World.command(current, %{type: :spawn_villager, building_id: 1})
        next
      end)

    assert {:ok, ordered} =
             World.command(world, %{
               type: :order,
               villager_ids: Enum.map(world.villagers, & &1.id),
               order: {:move, %{x: 13.0, z: 13.0}}
             })

    Enum.reduce(1..120, ordered, fn tick, current ->
      next = World.step(current)
      if rem(tick, 10) == 0, do: assert_spaced(next.villagers)
      next
    end)
  end

  test "opposing moving villagers steer around each other" do
    world = World.new(seed: 1234)

    villagers =
      Enum.map(world.villagers, fn v ->
        case v.id do
          1 -> %{v | x: -2.0, z: 0.0}
          2 -> %{v | x: 2.0, z: 0.0}
          _ -> %{v | x: 0.0, z: 5.0}
        end
      end)

    world = %{world | villagers: villagers}

    {:ok, world} =
      World.command(world, %{type: :order, villager_ids: [1], order: {:move, %{x: 2.0, z: 0.0}}})

    {:ok, world} =
      World.command(world, %{type: :order, villager_ids: [2], order: {:move, %{x: -2.0, z: 0.0}}})

    final =
      Enum.reduce(1..30, world, fn _, current ->
        next = World.step(current)
        assert_spaced(next.villagers)
        next
      end)

    assert Enum.at(final.villagers, 0).x > 0
    assert Enum.at(final.villagers, 1).x < 0
  end

  test "villagers can destroy the enemy base and win" do
    world = World.new(seed: 1234)
    enemy = Enum.at(world.buildings, 1)

    world = %{
      world
      | villagers: Enum.map(world.villagers, &%{&1 | x: enemy.x + 3, z: enemy.z + (&1.id - 2)})
    }

    assert_spaced(world.villagers)

    assert {:ok, ordered} =
             World.command(world, %{type: :order, villager_ids: [1, 2, 3], order: {:attack, 2}})

    finished = World.step(ordered, 200)
    assert Enum.at(finished.buildings, 1).hp == 0
    assert finished.outcome == :victory
  end

  test "attack cadence follows the unit's interval while standing beside the base" do
    world = World.new(seed: 1234)
    enemy = Enum.at(world.buildings, 1)

    world = %{
      world
      | villagers:
          Enum.map(world.villagers, fn v ->
            if v.id == 1, do: %{v | x: enemy.x + 5.8, z: enemy.z}, else: v
          end)
    }

    assert {:ok, normal} =
             World.command(world, %{type: :order, villager_ids: [1], order: {:attack, enemy.id}})

    fast = %{
      normal
      | villagers:
          Enum.map(normal.villagers, fn v ->
            if v.id == 1, do: %{v | attack_interval_ticks: 3}, else: v
          end)
    }

    assert normal |> World.step(6) |> Map.fetch!(:buildings) |> Enum.at(1) |> Map.fetch!(:hp) ==
             245

    assert fast |> World.step(6) |> Map.fetch!(:buildings) |> Enum.at(1) |> Map.fetch!(:hp) == 240
  end

  defp distance(a, b), do: :math.sqrt(:math.pow(a.x - b.x, 2) + :math.pow(a.z - b.z, 2))

  defp assert_spaced(villagers) do
    for {left, index} <- Enum.with_index(villagers), right <- Enum.drop(villagers, index + 1) do
      assert distance(left, right) >= World.unit_hitbox_radius() * 2 - 1.0e-8,
             "villagers #{left.id} and #{right.id} overlap"
    end
  end
end
