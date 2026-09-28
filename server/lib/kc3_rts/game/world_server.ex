defmodule KC3RTS.Game.WorldServer do
  @moduledoc """
  Owns the authoritative state and fixed-step timer for one active match.
  """

  use GenServer

  alias KC3RTS.Game.Snapshot
  alias KC3RTS.Game.World

  @default_tick_interval 100

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    game_id = Keyword.fetch!(opts, :game_id)
    GenServer.start_link(__MODULE__, opts, name: via(game_id))
  end

  @spec child_spec(keyword()) :: Supervisor.child_spec()
  def child_spec(opts) do
    game_id = Keyword.fetch!(opts, :game_id)

    %{
      id: {__MODULE__, game_id},
      start: {__MODULE__, :start_link, [opts]},
      restart: :permanent,
      shutdown: 5_000,
      type: :worker
    }
  end

  @spec snapshot(GenServer.server()) :: World.t()
  def snapshot(server), do: GenServer.call(server, :snapshot)

  @spec command(GenServer.server(), atom()) :: {:ok, map()} | {:error, atom()}
  def command(server, command), do: GenServer.call(server, {:command, command})

  @spec ensure_started(binary(), keyword()) :: {:ok, pid()} | {:error, term()}
  def ensure_started(game_id, opts \\ []) do
    case Registry.lookup(KC3RTS.GameRegistry, game_id) do
      [{pid, _value}] ->
        {:ok, pid}

      [] ->
        DynamicSupervisor.start_child(
          KC3RTS.GameSupervisor,
          {__MODULE__, Keyword.merge(opts, game_id: game_id)}
        )
    end
  end

  @impl true
  def init(opts) do
    tick_interval = Keyword.get(opts, :tick_interval, @default_tick_interval)
    schedule_tick(tick_interval)

    {:ok,
     %{
       world: World.new(seed: Keyword.get(opts, :seed, 12_345)),
       tick_interval: tick_interval,
       game_id: Keyword.fetch!(opts, :game_id)
     }}
  end

  @impl true
  def handle_call(:snapshot, _from, state), do: {:reply, state.world, state}

  def handle_call({:command, :spawn_villager}, _from, state) do
    case World.spawn_villager(state.world) do
      {:ok, world, villager} ->
        broadcast_world(state.game_id, world)
        {:reply, {:ok, villager}, %{state | world: world}}

      {:error, reason, _world} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:command, _unknown}, _from, state),
    do: {:reply, {:error, :unknown_command}, state}

  @impl true
  def handle_info(:tick, %{tick_interval: :disabled} = state), do: {:noreply, state}

  def handle_info(:tick, state) do
    schedule_tick(state.tick_interval)
    world = World.step(state.world)
    broadcast_world(state.game_id, world)

    {:noreply, %{state | world: world}}
  end

  defp broadcast_world(game_id, world) do
    topic = topic(game_id)

    Phoenix.PubSub.broadcast(
      KC3RTS.PubSub,
      topic,
      %Phoenix.Socket.Broadcast{
        topic: topic,
        event: "world_snapshot",
        payload: %{world: Snapshot.from_world(world)}
      }
    )
  end

  defp schedule_tick(:disabled), do: :ok

  defp schedule_tick(interval) when is_integer(interval) and interval > 0 do
    Process.send_after(self(), :tick, interval)
  end

  defp via(game_id), do: {:via, Registry, {KC3RTS.GameRegistry, game_id}}
  defp topic(game_id), do: "game:" <> game_id
end
