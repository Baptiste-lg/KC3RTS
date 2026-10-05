defmodule KC3RTS.Game.KC3ProtocolTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.KC3Protocol
  import KC3RTS.KC3Boundary

  @fixture Path.expand("../../../../fixtures/kc3_opening_v4.json", __DIR__)
           |> File.read!()
           |> Jason.decode!()

  test "valid requests and opening state cross the boundary" do
    for payload <- [
          request(1, "new_match"),
          request(2, "tick", 1),
          request(3, "snapshot"),
          command(4, 1)
        ] do
      assert {:ok, line} = KC3Protocol.encode_request(payload)
      assert Jason.decode!(line) == payload
    end

    assert {:ok, @fixture} ==
             KC3Protocol.decode_reply(Jason.encode!(@fixture), request(1, "new_match"), nil)
  end

  test "malformed and unsafe input is rejected before writing to the port" do
    bad = [
      nil,
      Map.put(request(1, "tick"), "protocol_version", 2.0),
      [],
      %{},
      Map.put(request(1, "tick"), "padding", self()),
      Map.put(request(1, "tick"), "protocol_version", 1),
      Map.put(request(1, "tick"), "ruleset_version", 3),
      Map.put(request(1, "tick"), "match_id", "bad/id"),
      Map.put(request(1, "tick"), "match_id", <<255>>),
      Map.put(request(1, "tick"), "request_id", 9_007_199_254_740_992),
      Map.put(request(1, "tick"), "expected_revision", -1),
      Map.put(request(1, "new_match"), "seed", 0),
      Map.put(request(1, "new_match"), "factions", []),
      Map.put(request(1, "tick"), "operation", "eval"),
      put_in(command(1, 0), ["command", "x"], 1.5),
      put_in(command(1, 0), ["command", "z"], "NaN"),
      put_in(command(1, 0), ["command", "recipe_id"], "../file"),
      Map.put(command(1, 0), "actor_slot", 3),
      Map.put(command(1, 0), "command", nil),
      Map.delete(request(1, "new_match"), "seed")
    ]

    for payload <- bad,
        do:
          assert(
            {:error, :invalid_request} == KC3Protocol.encode_request(payload),
            inspect(payload)
          )

    assert {:error, :oversized_request} =
             KC3Protocol.encode_request(
               Map.put(request(1, "tick"), "padding", String.duplicate("x", 4096))
             )
  end

  test "navigation snapshots bound grids, footprints and incremental search tables" do
    count = 1920
    table = "000" <> String.duplicate("ooo", count - 1)

    search = %{
      "goal" => 1,
      "start" => 0,
      "astar" => true,
      "open" => [1],
      "parents" => table,
      "costs" => table,
      "path" => [],
      "status" => "planning",
      "expanded" => 1,
      "mask" => String.duplicate(".", count)
    }

    navigation =
      Map.merge(@fixture["state"]["navigation"], %{"search" => search, "entity_id" => 2})

    valid = put_in(@fixture, ["state", "navigation"], navigation)
    assert {:ok, ^valid} = decode(valid)

    for {path, value} <- [
          {["revision"], 0},
          {["entity_id"], 0},
          {["mask"], "."},
          {["mask"], String.duplicate("?", count)},
          {["signature", "map"], %{}},
          {["signature", "obstacles"], [[0, 0, 0]]},
          {["signature", "obstacles"], [[0]]},
          {["search", "start"], count},
          {["search", "goal"], -1},
          {["search", "astar"], false},
          {["search", "status"], "ready"},
          {["search", "path"], [0]},
          {["search", "expanded"], count * 4 + 1},
          {["search", "open"], [-1]},
          {["search", "open"], List.duplicate(0, count * 4 + 1)},
          {["search", "parents"], "000"},
          {["search", "costs"], String.duplicate("///", count)},
          {["search", "costs"], "0NN" <> String.duplicate("ooo", count - 1)}
        ] do
      bad = put_in(valid, ["state", "navigation"] ++ path, value)
      assert {:error, :invalid_worker_reply} = decode(bad), inspect({path, value}, limit: 5)
    end

    for size <- [0, 255, 257, 4096] do
      assert {:error, :invalid_worker_reply} =
               decode(put_in(@fixture, ["state", "map", "cell_size"], size))
    end
  end

  test "every state domain is validated, including references and duplicate IDs" do
    changes = [
      {["protocol_version"], 1},
      {["protocol_version"], 2.0},
      {["request_id"], 1.0},
      {["state", "schema_version"], 1.0},
      {["ruleset_version"], 3},
      {["request_id"], 99},
      {["match_id"], "other"},
      {["content_hash"], String.duplicate("0", 64)},
      {["accepted"], "true"},
      {["reason"], "unknown"},
      {["revision"], 2},
      {["state"], nil},
      {["state", "schema_version"], 3},
      {["state", "seed"], 0},
      {["state", "rng_state"], 0},
      {["state", "tick"], 1.1},
      {["state", "next_entity_id"], 1},
      {["state", "players"], []},
      {["state", "entities"], %{}},
      {["state", "outcome", "status"], "victory"}
    ]

    player = hd(@fixture["state"]["players"])
    entity = hd(@fixture["state"]["entities"])

    invalid_players = [
      Map.put(player, "faction_id", "missing.faction"),
      Map.put(player, "stocks", %{}),
      put_in(player, ["stocks", "core.food"], -1),
      Map.put(player, "slot", 2)
    ]

    invalid_entities = [
      Map.put(entity, "type_id", "missing.unit"),
      Map.put(entity, "owner", 0),
      Map.put(entity, "hp", 0),
      Map.put(entity, "x", 1.5),
      Map.put(entity, "construction", %{}),
      Map.put(entity, "construction", %{"recipe_id" => "core.build_house", "remaining_ticks" => 1}),
      Map.put(entity, "construction", %{
        "recipe_id" => "core.build_hall",
        "remaining_ticks" => 101
      })
    ]

    changed = Enum.map(changes, fn {path, value} -> put_in(@fixture, path, value) end)

    changed =
      changed ++
        Enum.map(
          invalid_players,
          &put_in(@fixture, ["state", "players"], [&1, List.last(@fixture["state"]["players"])])
        )

    changed =
      changed ++ Enum.map(invalid_entities, &put_in(@fixture, ["state", "entities"], [&1]))

    changed =
      changed ++
        [
          put_in(@fixture, ["state", "entities"], [entity, entity]),
          put_in(@fixture, ["state", "entities"], List.duplicate(entity, 513)),
          Map.put(@fixture, "extra", true)
        ]

    for reply <- changed,
        do: assert({:error, :invalid_worker_reply} == decode(reply), inspect(reply))

    for raw <- ["broken", "[]", "null", "{\"state\":NaN}", "{\"state\":1e9999}"],
        do:
          assert(
            {:error, :invalid_worker_reply} ==
              KC3Protocol.decode_reply(raw, request(1, "new_match"), nil)
          )
  end

  test "rejected commands and snapshots cannot secretly mutate state" do
    previous = @fixture["state"]
    rejected = %{@fixture | "accepted" => false, "reason" => "stale_revision"}

    assert {:ok, ^rejected} =
             KC3Protocol.decode_reply(Jason.encode!(rejected), request(1, "tick"), previous)

    assert {:error, :invalid_worker_reply} =
             KC3Protocol.decode_reply(
               Jason.encode!(put_in(rejected, ["state", "rng_state"], 1)),
               request(1, "tick"),
               previous
             )

    assert {:ok, @fixture} ==
             KC3Protocol.decode_reply(Jason.encode!(@fixture), request(1, "snapshot"), previous)

    assert {:error, :invalid_worker_reply} =
             KC3Protocol.decode_reply(Jason.encode!(@fixture), request(1, "new_match"), previous)

    assert {:error, :invalid_worker_reply} =
             KC3Protocol.decode_reply(Jason.encode!(@fixture), request(1, "tick", 1), previous)
  end

  test "economy commands have closed shapes and server-owned identity" do
    commands = [
      %{"type" => "gather", "entity_ids" => [2], "target_kind" => "node", "target_id" => 39},
      %{"type" => "deliver", "entity_ids" => [2]},
      %{"type" => "work", "entity_ids" => [2], "target_id" => 15},
      %{"type" => "repair", "entity_ids" => [2], "target_id" => 1},
      %{"type" => "cancel", "entity_id" => 1, "queue_id" => 1},
      %{"type" => "cancel_build", "entity_id" => 15},
      %{"type" => "rally", "entity_id" => 1, "x" => 1536, "z" => 512}
    ]

    for c <- commands do
      assert KC3Protocol.command_payload?(c)
      refute KC3Protocol.command_payload?(Map.put(c, "actor_slot", 2))
      refute KC3Protocol.command_payload?(Map.put(c, "paid", %{"core.food" => 0}))
      for field <- Map.keys(c), do: refute(KC3Protocol.command_payload?(Map.delete(c, field)))
    end

    refute KC3Protocol.command_payload?(%{
             "type" => "gather",
             "entity_ids" => [2],
             "target_kind" => "tribe",
             "target_id" => 39
           })

    refute KC3Protocol.command_payload?(%{
             "type" => "cancel",
             "entity_id" => 1,
             "queue_id" => 1.5
           })

    refute KC3Protocol.command_payload?(%{
             "type" => "deliver",
             "entity_ids" => Enum.to_list(1..101)
           })
  end

  test "cargo, job identities, resource nodes and progress reject malformed worker state" do
    state = @fixture["state"]
    [hall, worker | rest] = state["entities"]

    job = %{
      "id" => 1,
      "recipe_id" => "core.train_worker",
      "remaining_ticks" => 150,
      "started" => false,
      "paid" => %{"core.food" => 50}
    }

    valid = put_in(@fixture, ["state", "next_job_id"], 2)

    valid =
      put_in(valid, ["state", "entities"], [
        Map.put(hall, "queue", [job]),
        Map.put(worker, "cargo", %{"resource_id" => "core.food", "amount" => 10}) | rest
      ])

    assert {:ok, ^valid} = decode(valid)

    invalid = [
      put_in(valid, ["state", "next_job_id"], 1),
      put_in(valid, ["state", "entities"], [Map.put(hall, "queue", [job, job]) | rest]),
      put_in(valid, ["state", "entities"], [
        Map.put(hall, "queue", [Map.put(job, "paid", %{"missing.ore" => 50})]) | rest
      ]),
      put_in(valid, ["state", "entities"], [
        Map.put(worker, "cargo", %{"resource_id" => "core.food", "amount" => 11})
      ]),
      put_in(valid, ["state", "entities"], [
        Map.put(worker, "task", %{"kind" => "repair", "target_id" => 1, "progress" => 101})
      ]),
      put_in(valid, ["state", "entities"], [Map.put(worker, "rally", %{"x" => 0.5, "z" => 0})]),
      put_in(valid, ["state", "nodes"], [Map.put(hd(state["nodes"]), "amount", -1)]),
      put_in(valid, ["state", "nodes"], [
        Map.put(hd(state["nodes"]), "resource_id", "core.worker")
      ]),
      put_in(valid, ["state", "nodes"], [Map.put(hd(state["nodes"]), "x", 99_999)]),
      put_in(valid, ["state", "players"], [
        put_in(hd(state["players"]), ["population", "reserved"], -1),
        List.last(state["players"])
      ])
    ]

    for reply <- invalid, do: assert({:error, :invalid_worker_reply} == decode(reply))
  end

  defp decode(reply),
    do: KC3Protocol.decode_reply(Jason.encode!(reply), request(1, "new_match"), nil)
end
