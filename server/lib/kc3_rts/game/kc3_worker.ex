defmodule KC3RTS.Game.KC3Worker do
  @moduledoc """
  Experimental one-match KC3 process boundary. The worker owns the rules in
  `kc3/worker.kc3`; this adapter only validates framing and request identity.
  """

  use GenServer

  @max_request_bytes 4096
  @max_reply_bytes 64_000
  @default_timeout 30_000

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts)

  def request(server, payload, timeout \\ @default_timeout) do
    GenServer.call(server, {:request, payload, timeout}, timeout + 1_000)
  end

  @impl true
  def init(opts) do
    bin = opts |> Keyword.fetch!(:binary) |> Path.expand()
    script = Keyword.get(opts, :script, Path.expand("../../../../kc3/worker.kc3", __DIR__))

    unless File.regular?(bin) and File.regular?(script) do
      raise ArgumentError, "KC3 binary and worker script must exist"
    end

    Process.flag(:trap_exit, true)

    port =
      Port.open({:spawn_executable, String.to_charlist(bin)}, [
        :binary,
        :exit_status,
        {:args, ["--load", script]},
        {:cd, Path.dirname(Path.dirname(bin))},
        {:line, @max_reply_bytes}
      ])

    {:ok, %{port: port, pending: nil}}
  end

  @impl true
  def handle_call({:request, payload, timeout}, from, state) do
    with :ok <- validate_request(payload),
         true <- is_integer(timeout) and timeout > 0,
         nil <- state.pending do
      encoded = Jason.encode!(payload) <> "\n"
      token = make_ref()
      timer = Process.send_after(self(), {:request_timeout, token}, timeout)
      Port.command(state.port, encoded)
      {:noreply, %{state | pending: {from, timer, payload["request_id"], token}}}
    else
      false -> {:reply, {:error, :invalid_timeout}, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
      _ -> {:reply, {:error, :busy}, state}
    end
  end

  @impl true
  def handle_info(
        {port, {:data, {:eol, line}}},
        %{port: port, pending: {from, timer, id, _token}} = state
      ) do
    Process.cancel_timer(timer)

    reply =
      case Jason.decode(line) do
        {:ok, %{"protocol_version" => 1, "ruleset_version" => 1, "request_id" => ^id} = data} ->
          {:ok, data}

        _ ->
          {:error, :invalid_worker_reply}
      end

    GenServer.reply(from, reply)

    case reply do
      {:ok, _data} -> {:noreply, %{state | pending: nil}}
      {:error, _reason} -> {:stop, :normal, %{state | pending: nil}}
    end
  end

  def handle_info({port, {:data, {:noeol, _chunk}}}, %{port: port} = state) do
    reply_pending(state.pending, {:error, :oversized_worker_reply})
    {:stop, :normal, %{state | pending: nil}}
  end

  def handle_info({port, {:exit_status, _status}}, %{port: port} = state) do
    reply_pending(state.pending, {:error, :worker_exited})
    {:stop, :normal, %{state | pending: nil}}
  end

  def handle_info({:EXIT, port, _reason}, %{port: port} = state) do
    reply_pending(state.pending, {:error, :worker_exited})
    {:stop, :normal, %{state | pending: nil}}
  end

  def handle_info({:request_timeout, token}, %{pending: {_, _, _, token}} = state) do
    reply_pending(state.pending, {:error, :timeout})
    {:stop, :normal, %{state | pending: nil}}
  end

  def handle_info({:request_timeout, _token}, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state) do
    if Port.info(state.port), do: Port.close(state.port)
  end

  defp reply_pending({from, timer, _id, _token}, reply) do
    Process.cancel_timer(timer)
    GenServer.reply(from, reply)
  end

  defp reply_pending(nil, _reply), do: :ok

  defp validate_request(payload) when is_map(payload) do
    cond do
      not valid_envelope?(payload) ->
        {:error, :invalid_request}

      not valid_operation?(payload) ->
        {:error, :invalid_request}

      byte_size(Jason.encode!(payload)) > @max_request_bytes ->
        {:error, :oversized_request}

      true ->
        :ok
    end
  end

  defp validate_request(_), do: {:error, :invalid_request}

  defp valid_envelope?(%{
         "protocol_version" => 1,
         "ruleset_version" => 1,
         "request_id" => id,
         "match_id" => match_id,
         "expected_revision" => revision,
         "operation" => operation
       })
       when is_integer(id) and id > 0 and is_binary(match_id) and byte_size(match_id) in 1..48 and
              is_integer(revision) and revision >= 0 and
              operation in ["new_match", "command", "tick", "snapshot"] do
    String.match?(match_id, ~r/\A[a-zA-Z0-9_-]+\z/)
  end

  defp valid_envelope?(_), do: false

  defp valid_operation?(%{"operation" => "new_match", "seed" => seed}),
    do: is_integer(seed) and seed in 1..2_147_483_646

  defp valid_operation?(%{"operation" => "command", "actor_slot" => slot, "command" => command})
       when slot in [1, 2] and is_map(command) do
    valid_command?(command)
  end

  defp valid_operation?(%{"operation" => operation}) when operation in ["tick", "snapshot"],
    do: true

  defp valid_operation?(_), do: false

  defp valid_command?(%{"type" => "spawn_villager", "building_id" => id}),
    do: is_integer(id) and id > 0

  defp valid_command?(%{"type" => "build_center", "villager_id" => id, "x" => x, "z" => z}),
    do: is_integer(id) and id > 0 and is_number(x) and is_number(z)

  defp valid_command?(%{"type" => type, "building_id" => id}) when is_binary(type),
    do: byte_size(type) in 1..32 and is_integer(id) and id > 0

  defp valid_command?(_), do: false
end
