defmodule KC3RTS.Game.KC3Protocol do
  @moduledoc "Shape, identity and continuity checks for KC3 protocol 2; no gameplay decisions."
  @external_resource Path.expand("../../../../web/src/game/generated/catalog.json", __DIR__)
  @document @external_resource |> File.read!() |> Jason.decode!()
  @definitions Map.new(@document["catalog"]["definitions"], &{&1["id"], &1})
  @resources for {id, %{"kind" => "resource"}} <- @definitions, do: id
  @safe_integer 9_007_199_254_740_991
  @envelope ~w(protocol_version ruleset_version content_hash request_id match_id expected_revision operation)
  @reply ~w(protocol_version ruleset_version content_hash request_id match_id accepted reason revision state)
  @state ~w(schema_version content_hash match_id seed rng_state tick revision next_entity_id players entities outcome map)
  @reasons ~w(incompatible_version incompatible_content invalid_request match_exists unknown_match stale_revision invalid_command unknown_content invalid_producer prerequisite_required invalid_location entity_limit insufficient_resources invalid_selection unreachable)

  def content_hash, do: @document["content_hash"]

  def encode_request(payload) do
    with {:ok, encoded} <- Jason.encode(payload),
         true <- byte_size(encoded) <= 4096 || {:error, :oversized_request},
         true <- request?(payload) || {:error, :invalid_request} do
      {:ok, encoded <> "\n"}
    else
      {:error, reason} when is_atom(reason) -> {:error, reason}
      _ -> {:error, :invalid_request}
    end
  end

  def decode_reply(line, request, previous) do
    with {:ok, reply} <- Jason.decode(line),
         true <- reply?(reply, request, previous) do
      {:ok, reply}
    else
      _ -> {:error, :invalid_worker_reply}
    end
  end

  defp request?(p) when is_map(p) do
    p["protocol_version"] === 2 and p["ruleset_version"] === 2 and hash?(p["content_hash"]) and
      integer?(p["request_id"], 1) and match_id?(p["match_id"]) and
      integer?(p["expected_revision"], 0) and operation?(p)
  end

  defp request?(_), do: false

  defp operation?(%{"operation" => "new_match", "seed" => seed, "factions" => factions} = p) do
    fields?(p, @envelope ++ ~w(seed factions)) and integer?(seed, 1, 2_147_483_646) and
      is_list(factions) and length(factions) == 2 and Enum.all?(factions, &id?/1)
  end

  defp operation?(%{"operation" => "command", "actor_slot" => slot, "command" => c} = p) do
    fields?(p, @envelope ++ ~w(actor_slot command)) and slot in [1, 2] and
      command_payload?(c)
  end

  defp operation?(%{"operation" => op} = p) when op in ["tick", "snapshot"],
    do: fields?(p, @envelope)

  defp operation?(_), do: false

  def command_payload?(%{"type" => "produce"} = c) do
    fields?(c, ~w(type recipe_id entity_id x z)) and id?(c["recipe_id"]) and
      integer?(c["entity_id"], 1) and point?(c)
  end

  def command_payload?(%{"type" => type, "entity_ids" => ids} = c)
      when type in ["move", "stop"] do
    keys = if type == "move", do: ~w(type entity_ids x z), else: ~w(type entity_ids)

    fields?(c, keys) and is_list(ids) and length(ids) in 1..16 and
      Enum.all?(ids, &integer?(&1, 1)) and (type == "stop" or point?(c))
  end

  def command_payload?(_), do: false
  defp point?(p), do: integer?(p["x"], -@safe_integer) and integer?(p["z"], -@safe_integer)

  defp reply?(r, q, previous) do
    fields?(r, @reply) and r["protocol_version"] === 2 and r["ruleset_version"] === 2 and
      reply_identity?(r, q) and integer?(r["revision"], 0) and
      result?(r) and state?(r["state"]) and revision?(r) and continuity?(r, q, previous)
  end

  defp reply_identity?(r, q),
    do:
      r["content_hash"] == content_hash() and r["request_id"] === q["request_id"] and
        r["match_id"] == q["match_id"]

  defp result?(%{"accepted" => true, "reason" => nil}), do: true
  defp result?(%{"accepted" => false, "reason" => reason}), do: reason in @reasons
  defp result?(_), do: false
  defp revision?(%{"state" => nil, "revision" => 0, "accepted" => false}), do: true
  defp revision?(%{"state" => %{"revision" => revision}, "revision" => revision}), do: true
  defp revision?(_), do: false

  defp state?(nil), do: true

  defp state?(s) do
    fields?(s, @state) and s["schema_version"] === 2 and s["content_hash"] == content_hash() and
      match_id?(s["match_id"]) and counters?(s) and players?(s["players"]) and
      map?(s["map"]) and entities?(s["entities"], s["next_entity_id"], s["map"]) and
      outcome?(s["outcome"])
  end

  defp counters?(s) do
    integer?(s["seed"], 1, 2_147_483_646) and integer?(s["rng_state"], 1, 2_147_483_646) and
      integer?(s["tick"], 0) and integer?(s["revision"], 1) and s["tick"] < s["revision"] and
      integer?(s["next_entity_id"], 1)
  end

  defp players?([%{"slot" => 1} = first, %{"slot" => 2} = second]),
    do: Enum.all?([first, second], &player?/1)

  defp players?(_), do: false

  defp player?(p) do
    fields?(p, ~w(slot faction_id stocks)) and definition?(p["faction_id"], ["faction"]) and
      fields?(p["stocks"], @resources) and
      Enum.all?(p["stocks"], fn {id, amount} -> integer?(amount, 0, @definitions[id]["cap"]) end)
  end

  defp entities?(entities, next_id, map) when is_list(entities) and length(entities) <= 512 do
    Enum.all?(entities, &entity?(&1, map)) and
      Enum.reduce_while(entities, 0, fn e, last ->
        if e["id"] > last and e["id"] < next_id, do: {:cont, e["id"]}, else: {:halt, false}
      end) != false
  end

  defp entities?(_, _, _), do: false

  defp entity?(e, map) do
    fields?(e, ~w(id type_id owner x z hp construction order)) and integer?(e["id"], 1) and
      definition?(e["type_id"], ["unit", "building"]) and e["owner"] in [1, 2] and
      integer?(e["x"], -@safe_integer) and integer?(e["z"], -@safe_integer) and
      integer?(e["hp"], 1) and order?(e["order"], map) and
      construction?(e["construction"], e["type_id"])
  end

  defp map?(m) do
    fields?(m, ~w(width height cell_size origin_x origin_z blocked)) and
      integer?(m["width"], 1, 32) and integer?(m["height"], 1, 32) and
      integer?(m["cell_size"], 1, 4096) and integer?(m["origin_x"], -@safe_integer) and
      integer?(m["origin_z"], -@safe_integer) and is_list(m["blocked"]) and
      Enum.all?(m["blocked"], &integer?(&1, 0, m["width"] * m["height"] - 1)) and
      Enum.uniq(m["blocked"]) == m["blocked"]
  end

  defp order?(nil, _), do: true

  defp order?(o, map) do
    fields?(o, ~w(kind path offset)) and o["kind"] == "move" and
      fields?(o["offset"], ~w(x z)) and point?(o["offset"]) and is_list(o["path"]) and
      length(o["path"]) in 1..1024 and
      Enum.all?(o["path"], &integer?(&1, 0, map["width"] * map["height"] - 1))
  end

  defp construction?(nil, _), do: true

  defp construction?(c, type_id) do
    fields?(c, ~w(recipe_id remaining_ticks)) and definition?(c["recipe_id"], ["recipe"]) and
      @definitions[type_id]["kind"] == "building" and
      @definitions[c["recipe_id"]]["output"] == type_id and
      integer?(c["remaining_ticks"], 1, @definitions[c["recipe_id"]]["ticks"])
  end

  # P01 creates ongoing worlds. Terminal outcomes will be enabled with victory rules.
  defp outcome?(%{"status" => "ongoing", "winner_slot" => nil, "reason" => nil} = o),
    do: map_size(o) == 3

  defp outcome?(_), do: false

  defp continuity?(%{"accepted" => false, "state" => state}, _, previous), do: state == previous

  defp continuity?(%{"state" => state}, %{"operation" => "new_match"} = q, nil) do
    state != nil and state["revision"] == 1 and state["tick"] == 0 and
      state["match_id"] == q["match_id"] and state["seed"] == q["seed"] and
      Enum.map(state["players"], & &1["faction_id"]) == q["factions"] and
      q["expected_revision"] == 0 and q["content_hash"] == content_hash()
  end

  defp continuity?(%{"state" => state}, %{"operation" => "snapshot"}, previous),
    do: state != nil and state == previous

  defp continuity?(%{"state" => state}, %{"operation" => op} = q, previous)
       when op in ["tick", "command"] and is_map(previous) and is_map(state) do
    request_matches?(q, previous) and state["revision"] == previous["revision"] + 1 and
      state["tick"] == previous["tick"] + if(op == "tick", do: 1, else: 0) and
      same_identity?(state, previous) and
      state["next_entity_id"] >= previous["next_entity_id"]
  end

  defp continuity?(_, _, _), do: false

  defp request_matches?(q, previous),
    do:
      q["expected_revision"] == previous["revision"] and q["match_id"] == previous["match_id"] and
        q["content_hash"] == content_hash()

  defp same_identity?(state, previous) do
    Map.take(state, ~w(match_id seed content_hash schema_version map)) ==
      Map.take(previous, ~w(match_id seed content_hash schema_version map)) and
      Enum.map(state["players"], &Map.take(&1, ~w(slot faction_id))) ==
        Enum.map(previous["players"], &Map.take(&1, ~w(slot faction_id)))
  end

  defp definition?(id, kinds), do: is_binary(id) and get_in(@definitions, [id, "kind"]) in kinds
  defp fields?(map, keys), do: is_map(map) and Enum.sort(Map.keys(map)) == Enum.sort(keys)

  defp integer?(n, minimum, maximum \\ @safe_integer),
    do: is_integer(n) and n >= minimum and n <= maximum

  defp match_id?(s), do: text?(s, 48) and Regex.match?(~r/\A[a-zA-Z0-9_-]+\z/, s)
  defp hash?(s), do: text?(s, 64) and Regex.match?(~r/\A[a-f0-9]{64}\z/, s)
  defp id?(s), do: text?(s, 64) and Regex.match?(~r/\A[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+\z/, s)
  defp text?(s, max), do: is_binary(s) and byte_size(s) in 1..max and String.valid?(s)
end
