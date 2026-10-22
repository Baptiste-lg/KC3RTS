# Diagnostic runner only; never loaded by the game application.
defmodule KC3RTS.NavigationBenchmark do
  @moduledoc false
  alias KC3RTS.Game.{KC3Match, KC3Protocol, KC3Worker, Snapshot}

  def run(root, count, timeout) do
    validate_options!(count, timeout)

    with_scene(root, count, timeout, &run_single(&1, timeout))
  end

  # Two resident workers, but only one request in flight. Setup is serial and
  # outside tick timing. Reverse the leading variant each tick and each round.
  # This diagnoses differences; it is not a concurrent-match capacity test.
  def pair(reference_root, candidate_root, count, timeout, first \\ :reference) do
    validate_options!(count, timeout)
    [leading, following] = order(0, first)
    roots = %{reference: reference_root, candidate: candidate_root}

    with_scene(roots[leading], count, timeout, fn lead ->
      with_scene(roots[following], count, timeout, fn follow ->
        run_pair(%{leading => lead, following => follow}, timeout, first)
      end)
    end)
  end

  def order(step, first)
      when is_integer(step) and step >= 0 and first in [:reference, :candidate] do
    other = if first == :reference, do: :candidate, else: :reference
    if rem(step, 2) == 0, do: [first, other], else: [other, first]
  end

  def paired_summary(reference, candidate) do
    unless reference != [] and length(reference) == length(candidate) and
             Enum.all?(reference ++ candidate, &(is_integer(&1) and &1 > 0)) do
      raise ArgumentError, "paired timings must be equal-length nonempty positive integer series"
    end

    deltas = Enum.zip_with(reference, candidate, fn before, after_us -> after_us - before end)

    %{
      samples: length(deltas),
      candidate_faster_ticks: Enum.count(deltas, &(&1 < 0)),
      median_delta_us: percentile(deltas, 0.5),
      p95_delta_us: percentile(deltas, 0.95),
      mean_delta_us: Enum.sum(deltas) / length(deltas),
      candidate_total_ratio: Enum.sum(candidate) / Enum.sum(reference)
    }
  end

  def assert_same!(reference, candidate, phase) do
    if reference != candidate, do: raise("canonical state mismatch at #{phase}")
    :ok
  end

  # Keep historical 50/100 trajectories unchanged. Larger stress scenes use
  # disjoint destination regions and multiple legal selections, never a raised
  # production command limit. These are moving workers, not a combat fixture.
  def commands(count) when count in [50, 100],
    do: [move_command(Enum.to_list(1..count), {3072, 0})]

  def commands(count) when count in [150, 300] do
    destinations = [{3072, -2304}, {3072, 2304}, {-3072, -2304}, {-3072, 2304}]

    1..count
    |> Enum.chunk_every(75)
    |> Enum.zip(destinations)
    |> Enum.map(fn {ids, destination} -> move_command(ids, destination) end)
  end

  def commands(_), do: raise(ArgumentError, "fixture count must be 50, 100, 150 or 300")

  defp move_command(ids, {x, z}),
    do: %{"type" => "move", "entity_ids" => ids, "x" => x, "z" => z}

  defp run_single(scene, timeout) do
    Enum.reduce_while(1..450, scene, fn tick, previous ->
      {elapsed, state} = request_tick(previous, tick, timeout)
      current = record(previous, elapsed, state)
      if finished?(state), do: {:halt, current}, else: {:cont, current}
    end)
    |> report()
  end

  defp run_pair(initial, timeout, first) do
    assert_same!(initial.reference.opening, initial.candidate.opening, "opening")
    assert_same!(initial.reference.state, initial.candidate.state, "command")

    final =
      Enum.reduce_while(1..450, initial, fn tick, scenes ->
        current = step_pair(scenes, tick, timeout, first)
        if finished?(current.reference.state), do: {:halt, current}, else: {:cont, current}
      end)

    %{
      first_variant: first,
      reference: report(final.reference),
      candidate: report(final.candidate),
      paired: paired_summary(final.reference.times, final.candidate.times),
      # Chronological [reference_us, candidate_us] for each matched tick.
      tick_samples_us:
        Enum.zip_with(
          Enum.reverse(final.reference.times),
          Enum.reverse(final.candidate.times),
          fn reference, candidate -> [reference, candidate] end
        )
    }
  end

  defp step_pair(scenes, tick, timeout, first) do
    replies =
      Map.new(order(tick - 1, first), fn variant ->
        {variant, request_tick(scenes[variant], tick, timeout)}
      end)

    {_, reference_state} = replies.reference
    {_, candidate_state} = replies.candidate
    assert_same!(reference_state, candidate_state, tick)

    # All geometry, patch and equality checks follow BOTH requests.
    Map.new(scenes, fn {variant, previous} ->
      {elapsed, state} = replies[variant]
      {variant, record(previous, elapsed, state)}
    end)
  end

  defp validate_options!(count, timeout) do
    unless count in [50, 100, 150, 300] and timeout in 1..30_000 do
      raise ArgumentError,
            "fixture count must be 50, 100, 150 or 300 and timeout must be 1..30000 ms"
    end
  end

  defp with_scene(root, count, timeout, action) do
    binary = System.fetch_env!("KC3RTS_KC3S") |> Path.expand()
    script = Path.join(root, "kc3/tests/army_worker.kc3")

    unless File.regular?(binary) and File.regular?(script),
      do: raise(ArgumentError, "benchmark binary and worker script must exist")

    {:ok, worker} =
      KC3Worker.start_link(
        binary: binary,
        script: script
      )

    try do
      opening_request =
        request(1, "new_match", 0)
        |> Map.merge(%{"seed" => count, "factions" => ["kiln.concord", "lantern.synod"]})

      {startup_us, {:ok, %{"state" => opening}}} =
        :timer.tc(fn -> KC3Worker.request(worker, opening_request) end)

      unless length(opening["entities"]) == count,
        do: raise("worker fixture size differs from requested count #{count}")

      {moving, acks} =
        count
        |> commands()
        |> Enum.with_index(2)
        |> Enum.reduce({opening, []}, fn {command, id}, {state, acks} ->
          payload =
            request(id, "command", state["revision"])
            |> Map.merge(%{"actor_slot" => 1, "command" => command})

          {elapsed, {:ok, %{"accepted" => true, "state" => updated}}} =
            :timer.tc(fn -> KC3Worker.request(worker, payload, timeout) end)

          {updated, acks ++ [elapsed]}
        end)

      goals =
        Map.new(moving["entities"], &{&1["id"], goal_point(&1["order"]["goal"], moving["map"])})

      unless map_size(goals) == count and length(Enum.uniq(Map.values(goals))) == count,
        do: raise("fixture commands must assign a distinct goal to every unit")

      geometry!(opening)

      action.(%{
        worker: worker,
        count: count,
        opening: opening,
        state: moving,
        goals: goals,
        startup_us: startup_us,
        ack_us: Enum.max(acks),
        command_ack_us: acks,
        last_setup_request_id: 1 + length(acks),
        times: [],
        bytes: [],
        digest: :crypto.hash_init(:sha256)
      })
    after
      if Process.alive?(worker), do: GenServer.stop(worker)
    end
  end

  defp request_tick(scene, tick, timeout) do
    {elapsed, {:ok, %{"accepted" => true, "state" => state}}} =
      :timer.tc(fn ->
        KC3Worker.request(
          scene.worker,
          request(tick + scene.last_setup_request_id, "tick", scene.state["revision"]),
          timeout
        )
      end)

    {elapsed, state}
  end

  defp record(scene, elapsed, state) do
    geometry!(state)
    if state["rng_state"] != scene.opening["rng_state"], do: raise("navigation changed RNG")
    before = Snapshot.from_world(%KC3Match{state: scene.state})
    current = Snapshot.from_world(%KC3Match{state: state})
    size = byte_size(Jason.encode!(Snapshot.patch(before, current)))
    frame = Enum.map(state["entities"], &Map.take(&1, ~w(id x z status)))

    %{
      scene
      | state: state,
        times: [elapsed | scene.times],
        bytes: [size | scene.bytes],
        digest: :crypto.hash_update(scene.digest, Jason.encode!(frame))
    }
  end

  defp finished?(state), do: Enum.all?(state["entities"], &is_nil(&1["order"]))

  defp report(scene) do
    arrived =
      Enum.count(scene.state["entities"], fn e ->
        {e["x"], e["z"]} == scene.goals[e["id"]] and is_nil(e["order"]) and is_nil(e["status"])
      end)

    unless arrived == scene.count and length(scene.state["entities"]) == scene.count,
      do:
        raise(
          "navigation fixture did not finish: #{arrived}/#{scene.count} arrived at tick " <>
            "#{scene.state["tick"]}; " <>
            inspect(Enum.frequencies_by(scene.state["entities"], & &1["status"])) <>
            "; diagnostic p95_us=#{percentile(scene.times, 0.95)} " <>
            "p99_us=#{percentile(scene.times, 0.99)} max_ack_us=#{scene.ack_us}"
        )

    %{
      units: scene.count,
      seed: scene.count,
      ticks: scene.state["tick"],
      arrived: arrived,
      startup_us: scene.startup_us,
      ack_us: scene.ack_us,
      command_ack_us: scene.command_ack_us,
      command_count: length(scene.command_ack_us),
      command_total_us: Enum.sum(scene.command_ack_us),
      workload: "moving workers; 300 is stress only, not supported capacity",
      p50_us: percentile(scene.times, 0.50),
      p95_us: percentile(scene.times, 0.95),
      p99_us: percentile(scene.times, 0.99),
      max_patch_bytes: Enum.max(scene.bytes),
      average_patch_bytes: Enum.sum(scene.bytes) / length(scene.bytes),
      trajectory_hash: Base.encode16(:crypto.hash_final(scene.digest), case: :lower),
      production_timeout_met: scene.ack_us < 2_000_000 and Enum.max(scene.times) < 2_000_000,
      timing_budget_met:
        scene.ack_us < 200_000 and percentile(scene.times, 0.95) < 20_000 and
          percentile(scene.times, 0.99) < 50_000
    }
  end

  defp percentile(values, p), do: Enum.at(Enum.sort(values), ceil(length(values) * p) - 1)

  defp request(id, operation, revision),
    do: %{
      "protocol_version" => 2,
      "ruleset_version" => 4,
      "content_hash" => KC3Protocol.content_hash(),
      "request_id" => id,
      "match_id" => "navigation-benchmark",
      "expected_revision" => revision,
      "operation" => operation
    }

  defp goal_point(cell, map) do
    width = div(map["width"] * map["cell_size"], 256)

    {map["origin_x"] + rem(cell, width) * 256 + 128,
     map["origin_z"] + div(cell, width) * 256 + 128}
  end

  defp geometry!(state) do
    units = state["entities"]
    map = state["map"]

    for {unit, index} <- Enum.with_index(units) do
      unless unit["x"] - 64 >= map["origin_x"] and unit["z"] - 64 >= map["origin_z"] and
               unit["x"] + 64 <= map["origin_x"] + map["width"] * map["cell_size"] and
               unit["z"] + 64 <= map["origin_z"] + map["height"] * map["cell_size"],
             do: raise("unit outside fixture map")

      no_overlap!(unit, Enum.drop(units, index + 1))
    end
  end

  defp no_overlap!(unit, others) do
    for other <- others do
      if abs(unit["x"] - other["x"]) < 128 and abs(unit["z"] - other["z"]) < 128,
        do: raise("overlapping fixture units")
    end
  end
end
