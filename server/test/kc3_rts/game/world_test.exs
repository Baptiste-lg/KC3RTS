defmodule KC3RTS.Game.WorldTest do
  use ExUnit.Case, async: true

  alias KC3RTS.Game.World

  describe "new/1" do
    test "generates the same map from the same seed" do
      assert World.new(seed: 1234) == World.new(seed: 1234)
      refute World.new(seed: 1234) == World.new(seed: 4321)
    end

    test "keeps resource nodes inside the map and spaced around the town center" do
      world = World.new(seed: 99, resource_count: 24)

      assert length(world.resources) == 24

      for resource <- world.resources do
        assert abs(resource.x) <= world.map_radius
        assert abs(resource.z) <= world.map_radius
        assert distance(resource, world.town_center) >= 8.0
      end

      for {resource, index} <- Enum.with_index(world.resources),
          other <- Enum.drop(world.resources, index + 1) do
        assert distance(resource, other) >= 3.0
      end
    end
  end

  describe "spawn_villager/1" do
    test "charges the town center stockpile and assigns a unique id" do
      world = World.new(seed: 7, resource_count: 2, starting_stockpile: 12)

      assert {:ok, world, first} = World.spawn_villager(world)
      assert {:ok, world, second} = World.spawn_villager(world)
      assert first.id != second.id
      assert first.z >= 3.0
      assert second.z >= 3.0
      assert world.stockpile == 2

      assert {:error, :insufficient_resources, ^world} = World.spawn_villager(world)
    end
  end

  describe "step/2" do
    test "delivers cargo at the visible town center entrance" do
      world = World.new(resource_count: 0, starting_stockpile: 0)
      villager = %{id: 1, x: 0.0, z: 3.2, cargo: 5, target: :town_center}
      world = %{world | villagers: [villager]}

      updated = World.step(world)

      assert updated.stockpile == 5
      assert hd(updated.villagers).cargo == 0
    end

    test "villagers gather resources and deliver them to the town center" do
      world = World.new(seed: 42, resource_count: 24, starting_stockpile: 5)
      assert {:ok, world, _villager} = World.spawn_villager(world)

      world = World.step(world, 2_000)

      assert world.stockpile > 0
      assert Enum.any?(world.resources, &(&1.amount < &1.initial_amount))
      assert Enum.any?(world.villagers, &(&1.cargo > 0)) or world.stockpile > 0
    end

    test "advances the simulation tick by the requested number" do
      world = World.new(seed: 15, resource_count: 0)

      assert World.step(world, 35).tick == 35
    end

    test "retargets a different resource if another villager depleted its target" do
      world = World.new(seed: 15, resource_count: 0)
      depleted = %{id: 1, x: 4.0, z: 0.0, amount: 0, initial_amount: 10}
      available = %{id: 2, x: 8.0, z: 0.0, amount: 10, initial_amount: 10}

      villager = %{id: 1, x: 0.0, z: 0.0, cargo: 0, target: {:resource, 1}}
      world = %{world | resources: [depleted, available], villagers: [villager]}

      updated = World.step(world)

      assert hd(updated.villagers).target == {:resource, 2}
      assert hd(updated.villagers).x > villager.x
    end
  end

  defp distance(left, right) do
    :math.sqrt(:math.pow(left.x - right.x, 2) + :math.pow(left.z - right.z, 2))
  end
end
