alias KC3RTS.Game.Snapshot
alias KC3RTS.Game.World

seed = 12_345
sample_ticks = 1_000

measure = fn unit_count, mode ->
  world = World.new(seed: seed, starting_stockpile: %{wood: 10_000, stone: 15, gold: 10_000})

  world =
    Enum.reduce(4..unit_count//1, world, fn _, current ->
      {:ok, next} = World.command(current, %{type: :spawn_villager, building_id: 1})
      next
    end)

  world =
    if mode == :crowded_move do
      ids = Enum.map(world.villagers, & &1.id)

      {:ok, ordered} =
        World.command(world, %{
          type: :order,
          villager_ids: ids,
          order: {:move, %{x: 13.0, z: 13.0}}
        })

      ordered
    else
      world
    end

  {world, timings} =
    Enum.reduce(1..sample_ticks, {world, []}, fn _, {current, timings} ->
      start = System.monotonic_time(:microsecond)
      next = World.step(current)
      {next, [System.monotonic_time(:microsecond) - start | timings]}
    end)

  timings = Enum.sort(timings)
  percentile = fn p -> Enum.at(timings, ceil(length(timings) * p) - 1) end

  %{
    mode: mode,
    units: unit_count,
    tick_p50_us: percentile.(0.50),
    tick_p95_us: percentile.(0.95),
    snapshot_bytes: world |> Snapshot.from_world() |> Jason.encode!() |> byte_size()
  }
end

IO.puts(
  Jason.encode!(%{
    seed: seed,
    sample_ticks: sample_ticks,
    elixir: System.version(),
    otp: System.otp_release(),
    logical_cpus: System.schedulers_online(),
    results: [measure.(3, :idle), measure.(100, :idle), measure.(100, :crowded_move)]
  })
)
