# Run alone, without coverage. Each timed request includes the real port,
# JSON codec and reply validation. Geometry, parity and patch checks are untimed.
# Default: mix run scripts/benchmark_navigation.exs
# Paired: set KC3RTS_BENCH_REFERENCE_ROOT to a frozen game checkout.
# KC3RTS_BENCH_ROOT selects the candidate; KC3RTS_BENCH_ROUNDS defaults to 3.
# Both roots use the SAME pinned runtime and game bridge. Warm their KC3 module
# caches first; startup/command times are reported separately, not warm ticks.
# No warmup ticks are dropped: planning and arrivals remain in the distribution.
# KC3RTS_BENCH_COUNTS defaults to 50,100,150,300; use 50,100 with old fixtures.
Code.require_file("support/navigation_benchmark.exs", __DIR__)
alias KC3RTS.NavigationBenchmark

root = System.get_env("KC3RTS_BENCH_ROOT", Path.expand("../..", __DIR__)) |> Path.expand()
reference = System.get_env("KC3RTS_BENCH_REFERENCE_ROOT")
timeout = System.get_env("KC3RTS_BENCH_TIMEOUT_MS", "2000") |> String.to_integer()
unless timeout in 1..30_000, do: raise("benchmark timeout must be 1..30000 ms")

counts =
  System.get_env("KC3RTS_BENCH_COUNTS", "50,100,150,300")
  |> String.split(",")
  |> Enum.map(&String.to_integer/1)

unless counts != [] and counts == Enum.uniq(counts) and
         Enum.all?(counts, &(&1 in [50, 100, 150, 300])),
       do: raise("benchmark counts must be distinct supported sizes: 50,100,150,300")

{machine, 0} = System.cmd("uname", ["-smr"])

commit = fn path ->
  {sha, 0} = System.cmd("git", ["rev-parse", "HEAD"], cd: path)
  String.trim(sha)
end

source_hash = fn path ->
  Path.wildcard(Path.join(path, "kc3/**/*.kc3"))
  |> Enum.sort()
  |> Enum.reduce(:crypto.hash_init(:sha256), fn file, digest ->
    :crypto.hash_update(digest, [Path.relative_to(file, path), <<0>>, File.read!(file), <<0>>])
  end)
  |> :crypto.hash_final()
  |> Base.encode16(case: :lower)
end

runtime = System.fetch_env!("KC3RTS_KC3S") |> Path.expand() |> Path.dirname() |> Path.dirname()
bridge = Path.join(runtime, "lib/kc3/0.1/kc3rts.so")

metadata = %{
  benchmark: "kc3_navigation_real_port",
  source_root: root,
  source_commit: System.get_env("KC3RTS_BENCH_LABEL") || commit.(root),
  kc3_source_sha256: source_hash.(root),
  native_bridge_sha256: :crypto.hash(:sha256, File.read!(bridge)) |> Base.encode16(case: :lower),
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
      reference_kc3_source_sha256: source_hash.(reference),
      request_schedule: "serial, alternating each tick and each round",
      warmup_ticks: 0,
      rounds: rounds
    })

  for round <- 1..rounds, count <- counts do
    first = if rem(round, 2) == 1, do: :reference, else: :candidate
    result = NavigationBenchmark.pair(reference, root, count, timeout, first)
    IO.puts(Jason.encode!(Map.merge(metadata, %{round: round, units: count, result: result})))
  end
else
  # Emit each completed size immediately; a later strict arrival failure must
  # not discard the earlier measurements. The failed size still exits nonzero.
  for count <- counts do
    IO.puts(
      Jason.encode!(Map.put(metadata, :results, [NavigationBenchmark.run(root, count, timeout)]))
    )
  end
end
