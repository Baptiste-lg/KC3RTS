defmodule KC3RTS.Game.KC3Protocol do
  @moduledoc "Shape, identity and continuity checks for KC3 protocol 2; no gameplay decisions."
  @external_resource Path.expand("../../../../web/src/game/generated/catalog.json", __DIR__)
  @document @external_resource |> File.read!() |> Jason.decode!()
  @definitions Map.new(@document["catalog"]["definitions"], &{&1["id"], &1})
  @resources for {id, %{"kind" => "resource"}} <- @definitions, do: id
  @safe_integer 9_007_199_254_740_991
  @envelope ~w(protocol_version ruleset_version content_hash request_id match_id expected_revision operation)
  @reply ~w(protocol_version ruleset_version content_hash request_id match_id accepted reason revision state)
  @state ~w(schema_version content_hash match_id seed rng_state tick revision next_entity_id players entities outcome)
  @reasons ~w(incompatible_version incompatible_content invalid_request match_exists unknown_match stale_revision invalid_command unknown_content invalid_producer prerequisite_required invalid_location entity_limit insufficient_resources)

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
    p["protocol_version"] === 2 and p["ruleset_version"] === 1 and hash?(p["content_hash"]) and
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
      fields?(c, ~w(type recipe_id entity_id x z)) and c["type"] == "produce" and
      id?(c["recipe_id"]) and integer?(c["entity_id"], 1) and
      integer?(c["x"], -@safe_integer) and integer?(c["z"], -@safe_integer)
  end

  defp operation?(%{"operation" => op} = p) when op in ["tick", "snapshot"],
    do: fields?(p, @envelope)

  defp operation?(_), do: false

  defp reply?(r, q, previous) do
    fields?(r, @reply) and r["protocol_version"] === 2 and r["ruleset_version"] === 1 and
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
    fields?(s, @state) and s["schema_version"] === 1 and s["content_hash"] == content_hash() and
      match_id?(s["match_id"]) and counters?(s) and players?(s["players"]) and
      entities?(s["entities"], s["next_entity_id"]) and outcome?(s["outcome"])
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

  defp entities?(entities, next_id) when is_list(entities) and length(entities) <= 512 do
    Enum.all?(entities, &entity?/1) and
      Enum.reduce_while(entities, 0, fn e, last ->
        if e["id"] > last and e["id"] < next_id, do: {:cont, e["id"]}, else: {:halt, false}
      end) != false
  end

  defp entities?(_, _), do: false

  defp entity?(e) do
    fields?(e, ~w(id type_id owner x z hp construction)) and integer?(e["id"], 1) and
      definition?(e["type_id"], ["unit", "building"]) and e["owner"] in [1, 2] and
      integer?(e["x"], -@safe_integer) and integer?(e["z"], -@safe_integer) and
      integer?(e["hp"], 1) and construction?(e["construction"], e["type_id"])
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
    Map.take(state, ~w(match_id seed content_hash schema_version)) ==
      Map.take(previous, ~w(match_id seed content_hash schema_version)) and
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
