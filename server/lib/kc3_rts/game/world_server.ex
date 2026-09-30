defmodule KC3RTS.Game.WorldServer do
  @moduledoc """
  Owns the authoritative state and fixed-step timer for one active match.
  """

  use GenServer

  alias KC3RTS.Game.Snapshot
  alias KC3RTS.Game.World

  @default_tick_interval 100
  @max_catchup_ticks 10
  @command_cache_limit 128
  @max_commands_per_second 30

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
      restart: :temporary,
      shutdown: 5_000,
      type: :worker
    }
  end

  @spec snapshot(GenServer.server()) :: World.t()
  def snapshot(server), do: GenServer.call(server, :snapshot)

  @spec view(GenServer.server()) :: map()
  def view(server), do: GenServer.call(server, :view)

  @spec command(GenServer.server(), map()) :: {:ok, map()} | {:error, atom()}
  def command(server, command), do: GenServer.call(server, {:command, command})

  @spec submit(GenServer.server(), binary(), map()) :: {:ok, map()} | {:error, map()}
  def submit(server, command_id, command),
    do: GenServer.call(server, {:submit, command_id, command})

  @spec ensure_started(binary(), keyword()) :: {:ok, pid()} | {:error, term()}
  def ensure_started(game_id, opts \\ []) do
    case Registry.lookup(KC3RTS.GameRegistry, game_id) do
      [{pid, _value}] ->
        {:ok, pid}

      [] ->
        case DynamicSupervisor.start_child(
               KC3RTS.GameSupervisor,
               {__MODULE__, Keyword.merge(opts, game_id: game_id)}
             ) do
          {:error, {:already_started, pid}} -> {:ok, pid}
          result -> result
        end
    end
  end

  @impl true
  def init(opts) do
    tick_interval = Keyword.get(opts, :tick_interval, @default_tick_interval)

    next_deadline =
      if tick_interval == :disabled, do: nil, else: now() + tick_interval

    schedule_tick(next_deadline)

    {:ok,
     %{
       world:
         World.new(
           seed:
             Keyword.get_lazy(opts, :seed, fn ->
               :binary.decode_unsigned(:crypto.strong_rand_bytes(4))
             end)
         ),
       tick_interval: tick_interval,
       next_deadline: next_deadline,
       revision: 0,
       command_cache: %{},
       command_order: :queue.new(),
       command_window: now(),
       command_count: 0,
       max_commands_per_second:
         Keyword.get(opts, :max_commands_per_second, @max_commands_per_second),
       game_id: Keyword.fetch!(opts, :game_id)
     }}
  end

  @impl true
  def handle_call(:snapshot, _from, state), do: {:reply, state.world, state}
  def handle_call(:view, _from, state), do: {:reply, view_payload(state), state}

  def handle_call({:command, command}, _from, state) do
    case World.command(state.world, command) do
      {:ok, world} ->
        updated = %{state | world: world, revision: state.revision + 1}
        broadcast_patch(state, updated)
        {:reply, {:ok, Snapshot.from_world(world)}, updated}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:submit, command_id, command}, _from, state) do
    case Map.fetch(state.command_cache, command_id) do
      {:ok, {^command, result}} ->
        {:reply, result, state}

      {:ok, {_other_command, _result}} ->
        {:reply,
         {:error,
          %{reason: "command_id_conflict", revision: state.revision, command_id: command_id}},
         state}

      :error ->
        submit_new(state, command_id, command)
    end
  end

  defp submit_new(state, command_id, command) do
    case consume_command_slot(state) do
      {:error, state} ->
        {:reply,
         {:error, %{reason: "rate_limited", revision: state.revision, command_id: command_id}},
         state}

      {:ok, state} ->
        {result, state} = apply_command(state, command_id, command)
        {:reply, result, cache_result(state, command_id, command, result)}
    end
  end

  defp apply_command(state, command_id, command) do
    case World.command(state.world, command) do
      {:ok, world} ->
        updated = %{state | world: world, revision: state.revision + 1}
        broadcast_patch(state, updated)
        {{:ok, Map.put(view_payload(updated), :command_id, command_id)}, updated}

      {:error, reason} ->
        {{:error,
          %{reason: Atom.to_string(reason), revision: state.revision, command_id: command_id}},
         state}
    end
  end

  defp consume_command_slot(state) do
    current = now()

    state =
      if current - state.command_window >= 1_000,
        do: %{state | command_window: current, command_count: 0},
        else: state

    if state.command_count >= state.max_commands_per_second,
      do: {:error, state},
      else: {:ok, %{state | command_count: state.command_count + 1}}
  end

  @impl true
  def handle_info(
        {:tick, deadline},
        %{next_deadline: deadline, world: %{outcome: outcome}} = state
      )
      when outcome != :playing do
    {:noreply, %{state | next_deadline: nil}}
  end

  def handle_info({:tick, deadline}, %{next_deadline: deadline} = state) do
    due =
      min(@max_catchup_ticks, max(1, div(max(0, now() - deadline), state.tick_interval) + 1))

    updated = %{
      state
      | world: World.step(state.world, due),
        revision: state.revision + due,
        next_deadline: deadline + due * state.tick_interval
    }

    broadcast_patch(state, updated)
    schedule_tick(updated.next_deadline)
    {:noreply, updated}
  end

  def handle_info({:tick, _stale_deadline}, state), do: {:noreply, state}

  defp broadcast_patch(previous, state) do
    before = Snapshot.from_world(previous.world)
    after_world = Snapshot.from_world(state.world)

    KC3RTSWeb.Endpoint.broadcast(
      topic(state.game_id),
      "world_patch",
      %{
        protocol_version: 3,
        base_revision: previous.revision,
        revision: state.revision,
        tick: after_world.tick,
        stockpile: changed(before.stockpile, after_world.stockpile),
        outcome: changed(before.outcome, after_world.outcome),
        resources: diff_entities(before.resources, after_world.resources),
        buildings: diff_entities(before.buildings, after_world.buildings),
        villagers: diff_entities(before.villagers, after_world.villagers)
      }
    )
  end

  defp changed(before, after_value), do: if(before == after_value, do: nil, else: after_value)

  defp diff_entities(before, after_entities) do
    old = Map.new(before, &{&1.id, &1})
    current = Map.new(after_entities, &{&1.id, true})

    %{
      upsert: Enum.filter(after_entities, &(Map.get(old, &1.id) != &1)),
      remove: Enum.reject(Enum.map(before, & &1.id), &Map.has_key?(current, &1))
    }
  end

  defp view_payload(state),
    do: %{world: Snapshot.from_world(state.world), revision: state.revision}

  defp schedule_tick(nil), do: :ok

  defp schedule_tick(deadline) do
    Process.send_after(self(), {:tick, deadline}, max(0, deadline - now()))
  end

  defp cache_result(state, command_id, command, result) do
    cache = Map.put(state.command_cache, command_id, {command, result})
    order = :queue.in(command_id, state.command_order)

    if map_size(cache) > @command_cache_limit do
      {{:value, oldest}, order} = :queue.out(order)
      %{state | command_cache: Map.delete(cache, oldest), command_order: order}
    else
      %{state | command_cache: cache, command_order: order}
    end
  end

  defp now, do: System.monotonic_time(:millisecond)

  defp via(game_id), do: {:via, Registry, {KC3RTS.GameRegistry, game_id}}
  defp topic(game_id), do: "game:" <> game_id
end
