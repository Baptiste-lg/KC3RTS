defmodule KC3RTS.Game.KC3ProtocolTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.KC3Protocol
  import KC3RTS.KC3Boundary

  @fixture Path.expand("../../../../fixtures/kc3_opening_v2.json", __DIR__)
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

  defp decode(reply),
    do: KC3Protocol.decode_reply(Jason.encode!(reply), request(1, "new_match"), nil)
end
