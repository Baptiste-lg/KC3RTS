# mix run scripts/benchmark_navigation.exs
# KC3RTS_BENCH_ROOT can select a frozen source checkout for an A/B comparison.
# Run alone, without coverage. Geometry and patch checks are outside timing;
# every reported tick includes the real port, JSON codec and reply validation.
defmodule KC3RTS.NavigationBenchmark do
  alias KC3RTS.Game.{KC3Match, KC3Protocol, KC3Worker, Snapshot}

  def run(root, count, timeout) do
    {:ok, worker} =
      KC3Worker.start_link(
        binary: System.fetch_env!("KC3RTS_KC3S"),
        script: Path.join(root, "kc3/tests/army_worker.kc3")
      )

    try do
      opening_request =
        request(1, "new_match", 0)
        |> Map.merge(%{"seed" => count, "factions" => ["kiln.concord", "lantern.synod"]})

      {startup_us, {:ok, %{"state" => opening}}} =
        :timer.tc(fn -> KC3Worker.request(worker, opening_request) end)

      command =
        request(2, "command", 1)
        |> Map.merge(%{
          "actor_slot" => 1,
          "command" => %{
            "type" => "move",
            "entity_ids" => Enum.to_list(1..count),
            "x" => 3072,
            "z" => 0
          }
        })

      {ack_us, {:ok, %{"accepted" => true, "state" => moving}}} =
        :timer.tc(fn -> KC3Worker.request(worker, command, timeout) end)

      goals =
        Map.new(moving["entities"], &{&1["id"], goal_point(&1["order"]["goal"], moving["map"])})

      initial = {moving, [], [], :crypto.hash_init(:sha256)}

      {final, times, bytes, digest} =
        Enum.reduce_while(1..450, initial, fn tick, {previous, times, bytes, digest} ->
          {elapsed, {:ok, %{"accepted" => true, "state" => state}}} =
            :timer.tc(fn ->
              KC3Worker.request(worker, request(tick + 2, "tick", previous["revision"]), timeout)
            end)

          geometry!(state)
          if state["rng_state"] != opening["rng_state"], do: raise("navigation changed RNG")
          before = Snapshot.from_world(%KC3Match{state: previous})
          current = Snapshot.from_world(%KC3Match{state: state})
          size = byte_size(Jason.encode!(Snapshot.patch(before, current)))
          frame = Enum.map(state["entities"], &Map.take(&1, ~w(id x z status)))
          digest = :crypto.hash_update(digest, Jason.encode!(frame))
          result = {state, [elapsed | times], [size | bytes], digest}

          if Enum.all?(state["entities"], &is_nil(&1["order"])),
            do: {:halt, result},
            else: {:cont, result}
        end)

      arrived =
        Enum.count(final["entities"], fn e ->
          {e["x"], e["z"]} == goals[e["id"]] and is_nil(e["order"]) and is_nil(e["status"])
        end)

      times = Enum.sort(times)
      percentile = fn p -> Enum.at(times, ceil(length(times) * p) - 1) end

      %{
        units: count,
        seed: count,
        ticks: final["tick"],
        arrived: arrived,
        startup_us: startup_us,
        ack_us: ack_us,
        p50_us: percentile.(0.50),
        p95_us: percentile.(0.95),
        p99_us: percentile.(0.99),
        max_patch_bytes: Enum.max(bytes),
        average_patch_bytes: Enum.sum(bytes) / length(bytes),
        trajectory_hash: Base.encode16(:crypto.hash_final(digest), case: :lower),
        production_timeout_met: ack_us < 2_000_000 and Enum.max(times) < 2_000_000,
        timing_budget_met:
          ack_us < 200_000 and percentile.(0.95) < 20_000 and percentile.(0.99) < 50_000
      }
    after
      if Process.alive?(worker), do: GenServer.stop(worker)
    end
  end

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

      for other <- Enum.drop(units, index + 1) do
        if abs(unit["x"] - other["x"]) < 128 and abs(unit["z"] - other["z"]) < 128,
          do: raise("overlapping fixture units")
      end
    end
  end
end

root = System.get_env("KC3RTS_BENCH_ROOT", Path.expand("../..", __DIR__))
# Opt-in diagnostic headroom for a slow historical baseline, never the game.
timeout = System.get_env("KC3RTS_BENCH_TIMEOUT_MS", "2000") |> String.to_integer()
unless timeout in 1..30_000, do: raise("benchmark timeout must be 1..30000 ms")
{machine, 0} = System.cmd("uname", ["-smr"])

commit =
  System.get_env("KC3RTS_BENCH_LABEL") ||
    root |> then(&System.cmd("git", ["rev-parse", "HEAD"], cd: &1)) |> elem(0) |> String.trim()

runtime = System.fetch_env!("KC3RTS_KC3S") |> Path.expand() |> Path.dirname() |> Path.dirname()
{runtime_commit, 0} = System.cmd("git", ["rev-parse", "HEAD"], cd: runtime)

IO.puts(
  Jason.encode!(%{
    benchmark: "kc3_navigation_real_port",
    source_root: root,
    source_commit: commit,
    runtime_commit: String.trim(runtime_commit),
    content_hash: KC3RTS.Game.KC3Protocol.content_hash(),
    ruleset_version: 4,
    schema_version: 4,
    diagnostic_timeout_ms: timeout,
    machine: String.trim(machine),
    elixir: System.version(),
    otp: System.otp_release(),
    results: Enum.map([50, 100], &KC3RTS.NavigationBenchmark.run(root, &1, timeout))
  })
)
