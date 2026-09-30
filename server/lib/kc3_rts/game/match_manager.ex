defmodule KC3RTS.Game.MatchManager do
  @moduledoc "Owns bounded, expiring guest matches and their join capabilities."
  use GenServer

  alias KC3RTS.Game.WorldServer

  @default_max_matches 32
  @default_idle_ms :timer.minutes(30)
  @sweep_ms :timer.minutes(1)
  @token_salt "guest-match-v1"

  def start_link(opts \\ []) do
    case Keyword.get(opts, :name, __MODULE__) do
      nil -> GenServer.start_link(__MODULE__, opts)
      name -> GenServer.start_link(__MODULE__, opts, name: name)
    end
  end

  def create(server \\ __MODULE__), do: GenServer.call(server, :create)
  def authorize(token, server \\ __MODULE__), do: GenServer.call(server, {:authorize, token})

  def member?(match_id, token, server \\ __MODULE__),
    do: GenServer.call(server, {:member?, match_id, token})

  @impl true
  def init(opts) do
    state = %{
      matches: %{},
      max_matches: Keyword.get(opts, :max_matches, @default_max_matches),
      idle_ms: Keyword.get(opts, :idle_ms, @default_idle_ms),
      sweep_ms: Keyword.get(opts, :sweep_ms, @sweep_ms)
    }

    schedule_sweep(state)
    {:ok, state}
  end

  @impl true
  def handle_call(:create, _from, state) do
    state = expire_idle(state)

    if map_size(state.matches) >= state.max_matches do
      {:reply, {:error, :match_limit}, state}
    else
      match_id = Base.url_encode64(:crypto.strong_rand_bytes(18), padding: false)
      nonce = Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false)
      token = Phoenix.Token.sign(KC3RTSWeb.Endpoint, @token_salt, {match_id, nonce})

      case WorldServer.ensure_started(match_id) do
        {:ok, _pid} ->
          entry = %{token_hash: hash(token), last_seen: now()}

          {:reply, {:ok, %{match_id: match_id, token: token}},
           %{state | matches: Map.put(state.matches, match_id, entry)}}

        {:error, _reason} ->
          {:reply, {:error, :match_unavailable}, state}
      end
    end
  end

  def handle_call({:authorize, token}, _from, state) do
    state = expire_idle(state)

    case token_match(token, state) do
      {:ok, match_id} -> {:reply, {:ok, match_id}, touch(state, match_id)}
      :error -> {:reply, :error, state}
    end
  end

  def handle_call({:member?, match_id, token}, _from, state) do
    state = expire_idle(state)

    case token_match(token, state) do
      {:ok, ^match_id} -> {:reply, true, touch(state, match_id)}
      _ -> {:reply, false, state}
    end
  end

  @impl true
  def handle_info(:sweep, state) do
    schedule_sweep(state)
    {:noreply, expire_idle(state)}
  end

  defp token_match(token, state) when is_binary(token) do
    with {:ok, {match_id, _nonce}} <-
           Phoenix.Token.verify(KC3RTSWeb.Endpoint, @token_salt, token, max_age: 86_400),
         %{token_hash: expected} <- Map.get(state.matches, match_id),
         [{_pid, _}] <- Registry.lookup(KC3RTS.GameRegistry, match_id),
         true <- Plug.Crypto.secure_compare(expected, hash(token)) do
      {:ok, match_id}
    else
      _ -> :error
    end
  end

  defp token_match(_, _state), do: :error

  defp expire_idle(state) do
    cutoff = now() - state.idle_ms

    matches =
      Enum.reduce(state.matches, %{}, fn {match_id, entry}, kept ->
        if entry.last_seen <= cutoff or Registry.lookup(KC3RTS.GameRegistry, match_id) == [] do
          terminate_match(match_id)
          kept
        else
          Map.put(kept, match_id, entry)
        end
      end)

    %{state | matches: matches}
  end

  defp terminate_match(match_id) do
    case Registry.lookup(KC3RTS.GameRegistry, match_id) do
      [{pid, _}] -> DynamicSupervisor.terminate_child(KC3RTS.GameSupervisor, pid)
      [] -> :ok
    end
  end

  defp touch(state, match_id) do
    update_in(state.matches[match_id].last_seen, fn _ -> now() end)
  end

  defp hash(token), do: :crypto.hash(:sha256, token)
  defp now, do: System.monotonic_time(:millisecond)
  defp schedule_sweep(state), do: Process.send_after(self(), :sweep, state.sweep_ms)
end
