# Codec-only paired diagnostic, not a simulation/capacity benchmark.
# KC3RTS_CODEC_REFERENCE=<commit> mix run scripts/benchmark_protocol.exs
# Both variants decode the SAME bytes and validate the complete response.
alias KC3RTS.Game.KC3Protocol
root = Path.expand("../..", __DIR__)
relative = "server/lib/kc3_rts/game/kc3_protocol.ex"
reference = System.fetch_env!("KC3RTS_CODEC_REFERENCE")

unless Regex.match?(~r/\A[0-9a-f]{7,40}\z/, reference),
  do: raise("reference must be a commit SHA")

{reference, 0} = System.cmd("git", ["rev-parse", reference <> "^{commit}"], cd: root)
reference = String.trim(reference)
{old, 0} = System.cmd("git", ["show", reference <> ":" <> relative], cd: root)

old =
  String.replace(
    old,
    "defmodule KC3RTS.Game.KC3Protocol do",
    "defmodule KC3RTS.CodecReference do"
  )

# The source filename preserves the catalog's relative external-resource path.
Code.compile_string(old, Path.join(root, relative))
{candidate, 0} = System.cmd("git", ["rev-parse", "HEAD"], cd: root)
{machine, 0} = System.cmd("uname", ["-smr"])

candidate_source_hash =
  :crypto.hash(:sha256, File.read!(Path.join(root, relative))) |> Base.encode16(case: :lower)

fixture =
  Path.join(root, "fixtures/kc3_opening_v4.json") |> File.read!() |> Jason.decode!()

worker = Enum.find(fixture["state"]["entities"], &(&1["type_id"] == "core.worker"))
median = fn values -> values |> Enum.sort() |> Enum.at(div(length(values), 2)) end

for count <- [50, 100, 150, 300] do
  entities =
    Enum.map(1..count, fn id ->
      Map.merge(worker, %{
        "id" => id,
        "order" => %{
          "kind" => "move",
          "path" => Enum.to_list(1..64),
          "goal" => 64,
          "wait" => 0,
          "revision" => 1,
          "attempt" => 0,
          "priority" => 0
        }
      })
    end)

  previous = Map.merge(fixture["state"], %{"entities" => entities, "next_entity_id" => count + 1})
  state = Map.merge(previous, %{"tick" => 1, "revision" => 2})
  reply = Map.merge(fixture, %{"state" => state, "request_id" => 2, "revision" => 2})

  request = %{
    "protocol_version" => 2,
    "ruleset_version" => 4,
    "content_hash" => KC3Protocol.content_hash(),
    "request_id" => 2,
    "match_id" => state["match_id"],
    "operation" => "tick",
    "expected_revision" => 1
  }

  line = Jason.encode!(reply)
  modules = [KC3RTS.CodecReference, KC3Protocol]

  for _ <- 1..10, module <- modules do
    {:ok, ^reply} = module.decode_reply(line, request, previous)
  end

  samples =
    for iteration <- 1..51 do
      order = if rem(iteration, 2) == 1, do: modules, else: Enum.reverse(modules)

      Map.new(order, fn module ->
        {elapsed, {:ok, ^reply}} =
          :timer.tc(fn -> module.decode_reply(line, request, previous) end)

        {module, elapsed}
      end)
    end

  old_times = Enum.map(samples, & &1[KC3RTS.CodecReference])
  new_times = Enum.map(samples, & &1[KC3Protocol])

  IO.puts(
    Jason.encode!(%{
      benchmark: "protocol_decode_paired",
      fixture: "synthetic codec only; 64-cell paths, no simulation or arrival claim",
      units: count,
      reply_bytes: byte_size(line),
      samples: 51,
      warmup_calls_per_variant: 10,
      reference_commit: reference,
      candidate_commit: String.trim(candidate),
      candidate_protocol_sha256: candidate_source_hash,
      candidate_label: System.get_env("KC3RTS_BENCH_LABEL"),
      machine: String.trim(machine),
      elixir: System.version(),
      otp: System.otp_release(),
      reference_median_us: median.(old_times),
      candidate_median_us: median.(new_times),
      paired_median_delta_us: median.(Enum.zip_with(old_times, new_times, &(&2 - &1))),
      reference_us: old_times,
      candidate_us: new_times
    })
  )
end
