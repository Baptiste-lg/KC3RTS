defmodule KC3RTS.Game.KC3Protocol do
  @moduledoc "Shape, identity and continuity checks for KC3 protocol 2; no gameplay decisions."
  @external_resource Path.expand("../../../../web/src/game/generated/catalog.json", __DIR__)
  @document @external_resource |> File.read!() |> Jason.decode!()
  @definitions Map.new(@document["catalog"]["definitions"], &{&1["id"], &1})
  @resources for {id, %{"kind" => "resource"}} <- @definitions, do: id
  @safe_integer 9_007_199_254_740_991
  @envelope ~w(protocol_version ruleset_version content_hash request_id match_id expected_revision operation)
  @reply ~w(protocol_version ruleset_version content_hash request_id match_id accepted reason revision state)
  @state ~w(schema_version content_hash match_id seed rng_state tick revision next_entity_id next_job_id players entities nodes outcome map)
  @reasons ~w(incompatible_version incompatible_content invalid_request match_exists unknown_match stale_revision invalid_command unknown_content invalid_producer prerequisite_required invalid_location entity_limit insufficient_resources invalid_selection unreachable invalid_target cargo_mismatch farm_busy empty_cargo storage_full invalid_queue population_full queue_full)

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
    p["protocol_version"] === 2 and p["ruleset_version"] === 3 and hash?(p["content_hash"]) and
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
      when type in ["move", "stop", "gather", "deliver", "work", "repair"] do
    extra =
      case type do
        "move" -> ~w(x z)
        "gather" -> ~w(target_id target_kind)
        type when type in ["work", "repair"] -> ~w(target_id)
        _ -> []
      end

    fields?(c, ~w(type entity_ids) ++ extra) and is_list(ids) and length(ids) in 1..16 and
      Enum.all?(ids, &integer?(&1, 1)) and command_target?(c)
  end

  def command_payload?(%{"type" => "cancel"} = c),
    do:
      fields?(c, ~w(type entity_id queue_id)) and integer?(c["entity_id"], 1) and
        integer?(c["queue_id"], 1)

  def command_payload?(%{"type" => "cancel_build"} = c),
    do: fields?(c, ~w(type entity_id)) and integer?(c["entity_id"], 1)

  def command_payload?(%{"type" => "rally"} = c),
    do: fields?(c, ~w(type entity_id x z)) and integer?(c["entity_id"], 1) and point?(c)

  def command_payload?(_), do: false
  defp command_target?(%{"type" => "move"} = c), do: point?(c)

  defp command_target?(%{"type" => "gather"} = c),
    do: integer?(c["target_id"], 1) and c["target_kind"] in ["node", "farm"]

  defp command_target?(%{"type" => type} = c) when type in ["work", "repair"],
    do: integer?(c["target_id"], 1)

  defp command_target?(_), do: true

  defp point?(p), do: integer?(p["x"], -@safe_integer) and integer?(p["z"], -@safe_integer)

  defp reply?(r, q, previous) do
    fields?(r, @reply) and r["protocol_version"] === 2 and r["ruleset_version"] === 3 and
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
    fields?(s, @state) and s["schema_version"] === 3 and s["content_hash"] == content_hash() and
      match_id?(s["match_id"]) and counters?(s) and players?(s["players"]) and
      world_contents?(s) and
      outcome?(s["outcome"])
  end

  defp world_contents?(s),
    do:
      map?(s["map"]) and entities?(s["entities"], s["next_entity_id"], s["next_job_id"], s["map"]) and
        nodes?(s["nodes"], s["map"])

  defp counters?(s) do
    integer?(s["seed"], 1, 2_147_483_646) and integer?(s["rng_state"], 1, 2_147_483_646) and
      integer?(s["tick"], 0) and integer?(s["revision"], 1) and s["tick"] < s["revision"] and
      integer?(s["next_entity_id"], 1) and integer?(s["next_job_id"], 1)
  end

  defp players?([%{"slot" => 1} = first, %{"slot" => 2} = second]),
    do: Enum.all?([first, second], &player?/1)

  defp players?(_), do: false

  defp player?(p) do
    fields?(p, ~w(slot faction_id stocks population)) and
      definition?(p["faction_id"], ["faction"]) and
      fields?(p["stocks"], @resources) and population?(p["population"]) and
      Enum.all?(p["stocks"], fn {id, amount} -> integer?(amount, 0, @definitions[id]["cap"]) end)
  end

  defp population?(p),
    do:
      fields?(p, ~w(used reserved cap)) and integer?(p["used"], 0, 5120) and
        integer?(p["reserved"], 0, 5120) and integer?(p["cap"], 0, 60)

  defp entities?(entities, next_id, next_job, map)
       when is_list(entities) and length(entities) <= 512 do
    Enum.all?(entities, &entity?(&1, map, next_job)) and ordered_ids?(entities, next_id) and
      jobs_unique?(entities)
  end

  defp entities?(_, _, _, _), do: false

  defp ordered_ids?(entities, next_id),
    do:
      Enum.reduce_while(entities, 0, fn e, last ->
        if e["id"] > last and e["id"] < next_id, do: {:cont, e["id"]}, else: {:halt, false}
      end) != false

  defp jobs_unique?(entities) do
    ids = Enum.flat_map(entities, fn e -> Enum.map(e["queue"], & &1["id"]) end)
    length(entities) + length(ids) <= 512 and length(ids) == length(Enum.uniq(ids))
  end

  defp entity?(e, map, next_job) do
    fields?(
      e,
      ~w(id type_id owner x z hp max_hp construction order task cargo queue rally status)
    ) and integer?(e["id"], 1) and
      definition?(e["type_id"], ["unit", "building"]) and entity_body?(e) and
      entity_orders?(e, map, next_job)
  end

  defp entity_body?(e),
    do:
      e["owner"] in [1, 2] and point?(e) and integer?(e["max_hp"], 1, 1_000_000) and
        integer?(e["hp"], 1, e["max_hp"])

  defp entity_orders?(e, map, next_job) do
    order?(e["order"], map) and construction?(e["construction"], e["type_id"]) and
      cargo?(e["cargo"], e["type_id"]) and task?(e["task"]) and queue?(e, next_job) and
      rally?(e["rally"]) and
      e["status"] in [
        nil,
        "unreachable",
        "no_depot",
        "depleted",
        "storage_full",
        "insufficient_resources",
        "population_blocked",
        "exit_blocked"
      ]
  end

  defp rally?(nil), do: true
  defp rally?(p), do: fields?(p, ~w(x z)) and point?(p)

  defp cargo?(nil, _), do: true

  defp cargo?(c, type),
    do:
      fields?(c, ~w(resource_id amount)) and definition?(c["resource_id"], ["resource"]) and
        integer?(c["amount"], 1, @definitions[type]["cargo_capacity"])

  defp amounts?(m),
    do:
      is_map(m) and
        Enum.all?(m, fn {id, amount} ->
          definition?(id, ["resource"]) and integer?(amount, 0, @definitions[id]["cap"])
        end)

  defp task?(nil), do: true

  defp task?(%{"kind" => "gather"} = t),
    do:
      fields?(t, ~w(kind target_kind target_id resource_id phase progress)) and
        t["target_kind"] in ["node", "farm"] and integer?(t["target_id"], 0) and
        definition?(t["resource_id"], ["resource"]) and
        t["phase"] in ["gather", "deliver"] and integer?(t["progress"], 0, 99)

  defp task?(%{"kind" => kind} = t) when kind in ["work", "repair"],
    do:
      fields?(t, ~w(kind target_id progress)) and integer?(t["target_id"], 1) and
        integer?(t["progress"], 0, @document["catalog"]["rules"]["repair_interval"])

  defp task?(_), do: false

  defp queue?(e, next_job) do
    q = e["queue"]

    is_list(q) and length(q) <= @definitions[e["type_id"]]["queue_capacity"] and
      Enum.all?(q, fn job ->
        fields?(job, ~w(id recipe_id remaining_ticks started paid)) and
          integer?(job["id"], 1, next_job - 1) and
          definition?(job["recipe_id"], ["recipe"]) and
          @definitions[job["recipe_id"]]["producer"] == e["type_id"] and
          integer?(job["remaining_ticks"], 0, @definitions[job["recipe_id"]]["ticks"]) and
          is_boolean(job["started"]) and amounts?(job["paid"])
      end)
  end

  defp nodes?(nodes, map) when is_list(nodes) and length(nodes) <= 1024 do
    Enum.all?(nodes, &node?(&1, map)) and ordered_ids?(nodes, @safe_integer)
  end

  defp nodes?(_, _), do: false

  defp node?(n, map),
    do:
      fields?(n, ~w(id resource_id x z amount)) and integer?(n["id"], 1) and
        definition?(n["resource_id"], ["resource"]) and
        "node" in @definitions[n["resource_id"]]["sources"] and
        integer?(n["amount"], 0, @definitions[n["resource_id"]]["cap"]) and point?(n) and
        inside?(n, map)

  defp inside?(n, map),
    do:
      n["x"] >= map["origin_x"] and n["x"] < map["origin_x"] + map["width"] * map["cell_size"] and
        n["z"] >= map["origin_z"] and n["z"] < map["origin_z"] + map["height"] * map["cell_size"]

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
    fields?(c, ~w(recipe_id remaining_ticks paid)) and amounts?(c["paid"]) and
      definition?(c["recipe_id"], ["recipe"]) and
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
      state["next_entity_id"] >= previous["next_entity_id"] and
      state["next_job_id"] >= previous["next_job_id"]
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
