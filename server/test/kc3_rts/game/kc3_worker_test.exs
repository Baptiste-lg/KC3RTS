defmodule KC3RTS.Game.KC3WorkerTest do
  use ExUnit.Case, async: false
  alias KC3RTS.Game.KC3Worker
  import KC3RTS.KC3Boundary

  @moduletag timeout: 120_000
  @moduletag skip: is_nil(System.get_env("KC3RTS_KC3S"))

  setup do
    worker = start_supervised!({KC3Worker, binary: System.fetch_env!("KC3RTS_KC3S")})
    %{worker: worker}
  end

  test "recipes charge stocks and allocate stable queue IDs", %{worker: worker} do
    assert {:ok, %{"accepted" => true, "state" => opening}} =
             KC3Worker.request(worker, request(1, "new_match"))

    fixture =
      Path.expand("../../../../fixtures/kc3_opening_v3.json", __DIR__)
      |> File.read!()
      |> Jason.decode!()

    assert opening == fixture["state"]
    assert length(opening["entities"]) == 14
    assert Enum.map(opening["players"], & &1["slot"]) == [1, 2]

    assert {:ok, %{"accepted" => true, "revision" => 2, "state" => recruited}} =
             KC3Worker.request(worker, command(2, 1))

    assert hd(recruited["players"])["stocks"]["core.food"] == 150
    assert length(recruited["entities"]) == 14
    assert hd(hd(recruited["entities"])["queue"])["id"] == 1
    assert hd(recruited["players"])["population"]["reserved"] == 1

    assert {:ok, %{"reason" => "invalid_producer", "state" => ^recruited}} =
             KC3Worker.request(worker, command(3, 2, "core.train_worker", 1, 2))

    assert {:ok, %{"reason" => "unknown_content", "state" => ^recruited}} =
             KC3Worker.request(worker, command(4, 2, "missing.recipe"))

    assert {:ok, %{"reason" => "stale_revision", "state" => ^recruited}} =
             KC3Worker.request(worker, request(5, "tick", 1))

    for revision <- 2..4 do
      assert {:ok, %{"accepted" => true}} =
               KC3Worker.request(worker, command(10 + revision, revision))
    end

    assert {:ok, %{"reason" => "population_full", "revision" => 5}} =
             KC3Worker.request(worker, command(20, 5))

    assert {:ok, %{"accepted" => true, "revision" => 6, "state" => %{"tick" => 1}}} =
             KC3Worker.request(worker, request(21, "tick", 5))
  end

  test "construction validates site, producer, cost and completion", %{worker: worker} do
    assert {:ok, _} = KC3Worker.request(worker, request(1, "new_match"))
    build = command(2, 1, "core.build_house", 2)

    assert {:ok, %{"reason" => "invalid_location"}} =
             KC3Worker.request(
               worker,
               build |> put_in(["command", "x"], -3584) |> put_in(["command", "z"], 512)
             )

    assert {:ok, %{"reason" => "invalid_producer"}} =
             KC3Worker.request(worker, put_in(build, ["command", "entity_id"], 99))

    assert {:ok, %{"reason" => "insufficient_resources"}} =
             KC3Worker.request(worker, command(3, 1, "core.build_hall", 2))

    assert {:ok, %{"accepted" => true, "state" => built}} = KC3Worker.request(worker, build)
    assert hd(built["players"])["stocks"]["core.wood"] == 160
    assert List.last(built["entities"])["construction"]["remaining_ticks"] == 150

    assert {:ok, %{"reason" => "invalid_location", "state" => ^built}} =
             KC3Worker.request(worker, %{build | "expected_revision" => 2})

    assert {:ok, %{"reason" => "invalid_producer"}} =
             KC3Worker.request(worker, command(4, 2, "core.train_worker", 15))

    assert {:ok, %{"accepted" => true}} = KC3Worker.request(worker, request(11, "tick", 2))
    assert {:ok, %{"state" => final}} = KC3Worker.request(worker, request(12, "snapshot"))
    assert final["tick"] == 1
    assert final["revision"] == 3
    # Travel precedes construction; a remote foundation cannot build itself.
    assert List.last(final["entities"])["construction"]["remaining_ticks"] == 150
    worker_entity = Enum.find(final["entities"], &(&1["id"] == 2))
    assert worker_entity["task"]["kind"] == "work"
    assert worker_entity["order"] != nil
  end

  test "two processes are deterministic and isolated", %{worker: first} do
    second = start_supervised!({KC3Worker, binary: System.fetch_env!("KC3RTS_KC3S")}, id: :second)
    assert {:ok, opening} = KC3Worker.request(first, request(1, "new_match"))
    assert {:ok, ^opening} = KC3Worker.request(second, request(1, "new_match"))
    assert {:ok, _} = KC3Worker.request(first, command(2, 1))
    assert {:ok, %{"state" => unchanged}} = KC3Worker.request(second, request(3, "snapshot"))
    assert unchanged == opening["state"]

    assert {:ok, %{"reason" => "match_exists", "state" => ^unchanged}} =
             KC3Worker.request(second, request(4, "new_match"))

    assert {:ok, %{"reason" => "unknown_match", "state" => ^unchanged}} =
             KC3Worker.request(second, Map.put(request(5, "snapshot"), "match_id", "other"))
  end

  test "stale catalogs and unknown factions reject without creating a match", %{worker: worker} do
    assert {:ok, %{"reason" => "incompatible_content", "state" => nil}} =
             KC3Worker.request(
               worker,
               Map.put(request(1, "new_match"), "content_hash", String.duplicate("0", 64))
             )

    assert {:ok, %{"reason" => "unknown_content", "state" => nil}} =
             KC3Worker.request(
               worker,
               Map.put(request(2, "new_match"), "factions", ["missing.faction", "kiln.concord"])
             )

    assert {:ok, %{"reason" => "unknown_match", "state" => nil}} =
             KC3Worker.request(worker, request(3, "tick"))

    assert {:ok, %{"accepted" => true}} = KC3Worker.request(worker, request(4, "new_match"))
  end
end
