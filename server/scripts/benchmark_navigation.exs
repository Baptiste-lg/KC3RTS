# Run alone, without coverage. Each timed request includes the real port,
# JSON codec and reply validation. Geometry, parity and patch checks are untimed.
# Default: mix run scripts/benchmark_navigation.exs
# Paired: set KC3RTS_BENCH_REFERENCE_ROOT to a frozen game checkout.
# KC3RTS_BENCH_ROOT selects the candidate; KC3RTS_BENCH_ROUNDS defaults to 3.
# Both roots use the SAME pinned runtime and game bridge. Warm their KC3 module
# caches first; startup/command times are reported separately, not warm ticks.
# No warmup ticks are dropped: planning and arrivals remain in the distribution.
Code.require_file("support/navigation_benchmark.exs", __DIR__)
alias KC3RTS.NavigationBenchmark

root = System.get_env("KC3RTS_BENCH_ROOT", Path.expand("../..", __DIR__)) |> Path.expand()
reference = System.get_env("KC3RTS_BENCH_REFERENCE_ROOT")
timeout = System.get_env("KC3RTS_BENCH_TIMEOUT_MS", "2000") |> String.to_integer()
unless timeout in 1..30_000, do: raise("benchmark timeout must be 1..30000 ms")
{machine, 0} = System.cmd("uname", ["-smr"])

commit = fn path ->
  {sha, 0} = System.cmd("git", ["rev-parse", "HEAD"], cd: path)
  String.trim(sha)
end

runtime = System.fetch_env!("KC3RTS_KC3S") |> Path.expand() |> Path.dirname() |> Path.dirname()

metadata = %{
  benchmark: "kc3_navigation_real_port",
  source_root: root,
  source_commit: System.get_env("KC3RTS_BENCH_LABEL") || commit.(root),
  runtime_commit: commit.(runtime),
  content_hash: KC3RTS.Game.KC3Protocol.content_hash(),
  ruleset_version: 4,
  schema_version: 4,
  diagnostic_timeout_ms: timeout,
  machine: String.trim(machine),
  elixir: System.version(),
  otp: System.otp_release()
}

if reference do
  reference = Path.expand(reference)
  rounds = System.get_env("KC3RTS_BENCH_ROUNDS", "3") |> String.to_integer()
  unless rounds in 1..10, do: raise("benchmark rounds must be 1..10")

  metadata =
    Map.merge(metadata, %{
      benchmark: "kc3_navigation_paired_real_port",
      reference_root: reference,
      reference_commit: commit.(reference),
      request_schedule: "serial, alternating each tick and each round",
      warmup_ticks: 0,
      rounds: rounds
    })

  for round <- 1..rounds, count <- [50, 100] do
    first = if rem(round, 2) == 1, do: :reference, else: :candidate
    result = NavigationBenchmark.pair(reference, root, count, timeout, first)
    IO.puts(Jason.encode!(Map.merge(metadata, %{round: round, units: count, result: result})))
  end
else
  IO.puts(
    Jason.encode!(
      Map.put(
        metadata,
        :results,
        Enum.map([50, 100], &NavigationBenchmark.run(root, &1, timeout))
      )
    )
  )
end
