defmodule KC3RTS.Game.SnapshotTest do
  use ExUnit.Case, async: true

  alias KC3RTS.Game.Snapshot
  alias KC3RTS.Game.World

  test "resource targets are browser-safe and the full snapshot encodes as JSON" do
    world = World.new(seed: 5)
    assert {:ok, world, _villager} = World.spawn_villager(world)
    snapshot = world |> World.step() |> Snapshot.from_world()

    assert [%{target: %{kind: "resource", id: resource_id}}] = snapshot.villagers
    assert is_integer(resource_id)
    assert {:ok, _json} = Jason.encode(snapshot)
  end

  test "town center targets use a stable protocol value" do
    world = World.new(resource_count: 0)
    villager = %{id: 1, x: 5.0, z: 0.0, cargo: 5, target: :town_center}
    snapshot = %{world | villagers: [villager]} |> Snapshot.from_world()

    assert [%{target: %{kind: "town_center"}}] = snapshot.villagers
  end
end
