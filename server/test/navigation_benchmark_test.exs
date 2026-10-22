Code.require_file("../scripts/support/navigation_benchmark.exs", __DIR__)

defmodule KC3RTS.NavigationBenchmarkTest do
  use ExUnit.Case, async: false
  alias KC3RTS.Game.KC3Protocol
  alias KC3RTS.NavigationBenchmark, as: Benchmark

  test "paired requests alternate and can reverse the initial leader" do
    assert Benchmark.order(0, :reference) == [:reference, :candidate]
    assert Benchmark.order(1, :reference) == [:candidate, :reference]
    assert Benchmark.order(2, :reference) == [:reference, :candidate]
    assert Benchmark.order(0, :candidate) == [:candidate, :reference]
    assert Benchmark.order(1, :candidate) == [:reference, :candidate]
  end

  test "paired deltas retain signs and do not subtract independently sorted timings" do
    result = Benchmark.paired_summary([10, 100, 30], [15, 90, 20])
    assert result.samples == 3
    assert result.candidate_faster_ticks == 2
    assert result.median_delta_us == -10
    assert result.p95_delta_us == 5
    assert result.mean_delta_us == -5.0
    assert_in_delta result.candidate_total_ratio, 125 / 140, 0.000001
  end

  test "empty, unequal or nonpositive timing series cannot produce a comparison" do
    for {reference, candidate} <- [{[], []}, {[1], [1, 2]}, {[0], [1]}, {[1], [-1]}] do
      assert_raise ArgumentError, fn -> Benchmark.paired_summary(reference, candidate) end
    end
  end

  test "comparison checks hidden planner and economy state, not just positions" do
    state = %{"entities" => [%{"x" => 0, "z" => 0}], "navigation" => %{"wait" => 1}, "stock" => 9}
    assert :ok = Benchmark.assert_same!(state, state, 1)

    for different <- [put_in(state, ["navigation", "wait"], 2), Map.put(state, "stock", 8)] do
      assert_raise RuntimeError, "canonical state mismatch at 1", fn ->
        Benchmark.assert_same!(state, different, 1)
      end
    end
  end

  test "unsupported fixture counts and timeout bounds fail before starting workers" do
    for {count, timeout} <- [{0, 2000}, {51, 2000}, {100, 0}, {100, 30_001}] do
      assert_raise ArgumentError, fn -> Benchmark.run("missing", count, timeout) end
    end
  end

  test "scaling uses legal disjoint selections without changing historical commands" do
    for count <- [50, 100, 150, 300] do
      commands = Benchmark.commands(count)
      assert Enum.flat_map(commands, & &1["entity_ids"]) == Enum.to_list(1..count)
      assert Enum.all?(commands, &KC3Protocol.command_payload?/1)
      assert length(Enum.uniq_by(commands, &{&1["x"], &1["z"]})) == length(commands)

      if count <= 100 do
        assert commands == [
                 %{
                   "type" => "move",
                   "entity_ids" => Enum.to_list(1..count),
                   "x" => 3072,
                   "z" => 0
                 }
               ]
      else
        assert Enum.all?(commands, &(length(&1["entity_ids"]) == 75))
      end
    end

    assert_raise ArgumentError, fn -> Benchmark.commands(101) end
  end

  @tag skip: is_nil(System.get_env("KC3RTS_KC3S"))
  @tag timeout: 300_000
  test "identical real KC3 workers preserve every frame and release both ports" do
    root = Path.expand("../..", __DIR__)
    ports = kc3_ports()
    result = Benchmark.pair(root, root, 50, 2000, :candidate)
    assert result.reference.arrived == 50
    assert result.candidate.arrived == 50
    assert result.reference.ticks == 184
    assert result.reference.trajectory_hash == result.candidate.trajectory_hash

    assert result.reference.trajectory_hash ==
             "871bff6f90266cfd996dffb02044f24772ed8c49672f7834c4c2b77f0292a4ee"

    assert result.paired.samples == 184
    assert length(result.tick_samples_us) == 184
    assert result.first_variant == :candidate
    single = Benchmark.run(root, 50, 2000)
    assert single.trajectory_hash == result.reference.trajectory_hash
    assert single.ticks == 184
    assert kc3_ports() == ports
  end

  @tag skip: is_nil(System.get_env("KC3RTS_KC3S"))
  @tag timeout: 120_000
  test "a failed second worker setup releases the already initialized first worker" do
    root = Path.expand("../..", __DIR__)
    ports = kc3_ports()

    assert_raise ArgumentError, "benchmark binary and worker script must exist", fn ->
      Benchmark.pair(root, Path.join(root, "missing-benchmark-checkout"), 50, 2000)
    end

    assert kc3_ports() == ports
  end

  @tag skip: is_nil(System.get_env("KC3RTS_KC3S"))
  @tag timeout: 300_000
  test "150 workers complete two legal group orders through the production protocol" do
    root = Path.expand("../..", __DIR__)
    ports = kc3_ports()
    result = Benchmark.run(root, 150, 2000)
    assert result.arrived == 150
    assert result.ticks == 329

    assert result.trajectory_hash ==
             "7de05fc203b9d7271fb2fcd73367555d3c13bf2d8e843ed4c2ac0e8653278a9e"

    assert result.command_count == 2
    assert length(result.command_ack_us) == 2
    assert result.ack_us == Enum.max(result.command_ack_us)
    assert result.command_total_us == Enum.sum(result.command_ack_us)
    assert result.ticks <= 450
    assert result.production_timeout_met
    assert kc3_ports() == ports
  end

  defp kc3_ports do
    Enum.filter(Port.list(), fn port ->
      case Port.info(port, :name) do
        {:name, name} -> Path.basename(to_string(name)) == "kc3s"
        nil -> false
      end
    end)
    |> Enum.sort()
  end
end
