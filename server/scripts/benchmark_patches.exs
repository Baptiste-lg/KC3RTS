alias KC3RTS.Game.World
alias KC3RTS.Game.WorldServer

seed = 12_345
sample_ticks = 120
game_id = "patch-benchmark-#{System.unique_integer([:positive])}"

world = World.new(seed: seed, starting_stockpile: %{wood: 10_000, stone: 15, gold: 10_000})

world =
  Enum.reduce(4..100, world, fn _, current ->
    {:ok, next} = World.command(current, %{type: :spawn_villager, building_id: 1})
    next
  end)

{:ok, world} =
  World.command(world, %{
    type: :order,
    villager_ids: Enum.map(world.villagers, & &1.id),
    order: {:move, %{x: 13.0, z: 13.0}}
  })

{:ok, server} = WorldServer.ensure_started(game_id, seed: seed, tick_interval: 1_000_000)
:sys.replace_state(server, fn state -> %{state | world: world} end)
Phoenix.PubSub.subscribe(KC3RTS.PubSub, "game:" <> game_id)

initial_bytes = WorldServer.view(server) |> Jason.encode!() |> byte_size()

samples =
  Enum.map(1..sample_ticks, fn _ ->
    send(server, {:tick, :sys.get_state(server).next_deadline})

    receive do
      %Phoenix.Socket.Broadcast{event: "world_patch", payload: payload} ->
        %{
          bytes: payload |> Jason.encode!() |> byte_size(),
          moved: length(payload.villagers.upsert)
        }
    after
      5_000 -> raise "missing patch from benchmark match"
    end
  end)

DynamicSupervisor.terminate_child(KC3RTS.GameSupervisor, server)
sizes = samples |> Enum.map(& &1.bytes) |> Enum.sort()

IO.puts(
  Jason.encode!(%{
    seed: seed,
    units: 100,
    sample_ticks: sample_ticks,
    initial_bytes: initial_bytes,
    patch_p50_bytes: Enum.at(sizes, ceil(sample_ticks * 0.50) - 1),
    patch_p95_bytes: Enum.at(sizes, ceil(sample_ticks * 0.95) - 1),
    patch_mean_bytes: Float.round(Enum.sum(sizes) / sample_ticks, 1),
    patch_total_bytes: Enum.sum(sizes),
    moved_p50:
      samples |> Enum.map(& &1.moved) |> Enum.sort() |> Enum.at(ceil(sample_ticks * 0.50) - 1)
  })
)
