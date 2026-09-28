defmodule KC3RTS.Game.SnapshotTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.{Snapshot, World}

  test "encodes typed resources, health, orders and outcome" do
    world = World.new(seed: 5)
    node = hd(world.resources)

    assert {:ok, world} =
             World.command(world, %{type: :order, villager_ids: [1], order: {:gather, node.id}})

    snapshot = Snapshot.from_world(world)
    assert snapshot.protocol_version == 3
    assert hd(snapshot.resources).kind in ["wood", "stone", "gold"]
    assert hd(snapshot.villagers).order == %{kind: "gather", id: node.id}
    assert hd(snapshot.villagers).attack_interval_ticks == 6
    assert Enum.at(snapshot.buildings, 1).owner == "enemy"
    assert {:ok, _json} = Jason.encode(snapshot)
  end
end
