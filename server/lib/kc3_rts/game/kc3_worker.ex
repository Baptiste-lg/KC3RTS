defmodule KC3RTS.Game.KC3Worker do
  @moduledoc """
  Experimental one-match KC3 process boundary. The worker owns the rules in
  `kc3/worker.kc3`; this adapter validates framing, the complete state shape and request continuity.
  """

  use GenServer
  alias KC3RTS.Game.KC3Protocol

  @max_reply_bytes 262_144
  @default_timeout 30_000

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts)

  def request(server, payload, timeout \\ @default_timeout)

  def request(server, payload, timeout) when is_integer(timeout) and timeout > 0 do
    GenServer.call(server, {:request, payload, timeout}, timeout + 1_000)
  end

  def request(_server, _payload, _timeout), do: {:error, :invalid_timeout}

  @impl true
  def init(opts) do
    bin = opts |> Keyword.fetch!(:binary) |> Path.expand()
    script = Keyword.get(opts, :script, Path.expand("../../../../kc3/worker.kc3", __DIR__))

    unless File.regular?(bin) and File.regular?(script) do
      raise ArgumentError, "KC3 binary and worker script must exist"
    end

    Process.flag(:trap_exit, true)

    runtime = Path.dirname(Path.dirname(bin))

    libraries =
      Enum.join(
        [
          Path.join(runtime, "libkc3"),
          Path.join(runtime, "lib/kc3/0.1"),
          System.get_env("LD_LIBRARY_PATH", "")
        ],
        ":"
      )

    port =
      Port.open({:spawn_executable, String.to_charlist(bin)}, [
        :binary,
        :exit_status,
        {:env, [{~c"LD_LIBRARY_PATH", String.to_charlist(libraries)}]},
        {:args, ["--load", script, "--quit"]},
        {:cd, Path.dirname(Path.dirname(bin))},
        {:line, @max_reply_bytes + 1}
      ])

    {:ok, %{port: port, pending: nil, world: nil}}
  end

  @impl true
  def handle_call({:request, payload, timeout}, from, state) do
    with {:ok, encoded} <- KC3Protocol.encode_request(payload),
         true <- is_integer(timeout) and timeout > 0,
         nil <- state.pending do
      token = make_ref()
      timer = Process.send_after(self(), {:request_timeout, token}, timeout)
      Port.command(state.port, encoded)
      {:noreply, %{state | pending: {from, timer, payload, token}}}
    else
      false -> {:reply, {:error, :invalid_timeout}, state}
      {:error, reason} -> {:reply, {:error, reason}, state}
      _ -> {:reply, {:error, :busy}, state}
    end
  end

  @impl true
  def handle_info(
        {port, {:data, {:eol, line}}},
        %{port: port, pending: {from, timer, request, _token}} = state
      ) do
    Process.cancel_timer(timer)

    reply =
      if byte_size(line) <= @max_reply_bytes do
        KC3Protocol.decode_reply(line, request, state.world)
      else
        {:error, :oversized_worker_reply}
      end

    GenServer.reply(from, reply)

    case reply do
      {:ok, data} -> {:noreply, %{state | pending: nil, world: data["state"]}}
      {:error, _reason} -> {:stop, :normal, %{state | pending: nil}}
    end
  end

  def handle_info({port, {:data, {:noeol, _chunk}}}, %{port: port} = state) do
    reply_pending(state.pending, {:error, :oversized_worker_reply})
    {:stop, :normal, %{state | pending: nil}}
  end

  def handle_info({port, {:data, _data}}, %{port: port} = state) do
    {:stop, :normal, state}
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
  def terminate(_reason, %{port: port}) do
    Port.close(port)
  rescue
    ArgumentError -> :ok
  end

  defp reply_pending({from, timer, _id, _token}, reply) do
    Process.cancel_timer(timer)
    GenServer.reply(from, reply)
  end

  defp reply_pending(nil, _reply), do: :ok
end
