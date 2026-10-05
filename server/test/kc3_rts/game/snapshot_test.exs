defmodule KC3RTS.Game.SnapshotTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.{KC3Match, Snapshot, World}

  defp kc3_state do
    Path.expand("../../../../fixtures/kc3_opening_v4.json", __DIR__)
    |> File.read!()
    |> Jason.decode!()
    |> Map.fetch!("state")
  end

  test "KC3 views hide planner state and retain only public movement intent" do
    state = kc3_state()

    order = %{
      "kind" => "move",
      "goal" => 10,
      "path" => [1, 2, 10],
      "wait" => 0,
      "attempt" => 0,
      "revision" => 1,
      "priority" => 3
    }

    state =
      Map.update!(state, "entities", fn [first | rest] ->
        [Map.put(first, "order", order) | rest]
      end)

    view = Snapshot.from_world(%KC3Match{state: state})
    refute Map.has_key?(view, "navigation")
    assert hd(view["entities"])["order"] == %{"kind" => "move", "goal" => 10}
    assert Enum.at(view["entities"], 1)["order"] == nil
    assert hd(state["entities"])["order"] == order
  end

  test "KC3 patches preserve explicit clears, additions, removals and unchanged fields" do
    state = kc3_state()
    before = Snapshot.from_world(%KC3Match{state: state})
    [hall, worker, removed | rest] = before["entities"]
    moving = Map.put(worker, "order", %{"kind" => "move", "goal" => 10})
    before = Map.put(before, "entities", [hall, moving, removed | rest])
    added = Map.put(worker, "id", before["next_entity_id"])

    current =
      Map.merge(before, %{
        "entities" => [hall, Map.put(worker, "x", worker["x"] + 64) | rest] ++ [added],
        "nodes" => tl(before["nodes"]),
        "tick" => 1,
        "revision" => 2,
        "next_entity_id" => added["id"] + 1
      })

    patch = Snapshot.patch(before, current)

    assert patch.entities == %{
             upsert: [%{"id" => worker["id"], "x" => worker["x"] + 64, "order" => nil}, added],
             remove: [removed["id"]]
           }

    assert patch.nodes == %{upsert: [], remove: [hd(before["nodes"])["id"]]}
    assert patch.players == nil
    assert patch.outcome == nil
    assert patch.base_revision == 1
    assert patch.revision == 2
    assert patch.next_entity_id == added["id"] + 1
  end

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
