defmodule KC3RTS.Game.KC3Match do
  @moduledoc "KC3 process lifecycle and sequencing for a development match. No simulation rules."
  alias KC3RTS.Game.{KC3Protocol, KC3Worker}
  defstruct [:worker, :monitor, :state, :match_id, tick: 0, outcome: :playing]

  def new(opts) do
    binary =
      System.get_env("KC3RTS_KC3S") ||
        Path.expand("../../../../.toolchain/kc3/kc3s/kc3s", __DIR__)

    with true <- File.regular?(binary),
         {:ok, worker} <- KC3Worker.start_link(binary: binary) do
      initialize(worker, opts)
    else
      false -> {:error, :kc3_unavailable}
      error -> error
    end
  end

  defp initialize(worker, opts) do
    match = %__MODULE__{
      worker: worker,
      monitor: Process.monitor(worker),
      match_id: Keyword.fetch!(opts, :game_id)
    }

    seed = Keyword.get_lazy(opts, :seed, fn -> :rand.uniform(2_147_483_646) end)

    case request(
           match,
           "new_match",
           %{"seed" => seed, "factions" => ["kiln.concord", "lantern.synod"]},
           KC3Worker.startup_timeout()
         ) do
      {:ok, updated} ->
        {:ok, updated}

      {:error, reason} ->
        close(match)
        {:error, reason}
    end
  end

  def command(match, command),
    do: request(match, "command", %{"actor_slot" => 1, "command" => command})

  def step(match, 0), do: match

  def step(match, count) do
    case request(match, "tick", %{}) do
      {:ok, updated} -> step(updated, count - 1)
      {:error, reason} -> exit({:kc3_unavailable, reason})
    end
  end

  def close(match) do
    GenServer.stop(match.worker, :normal, 1000)
  catch
    :exit, _ -> :ok
  end

  defp request(match, operation, extra, timeout \\ 2000) do
    payload =
      Map.merge(
        %{
          "protocol_version" => 2,
          "ruleset_version" => 3,
          "content_hash" => KC3Protocol.content_hash(),
          "request_id" => System.unique_integer([:positive, :monotonic]),
          "match_id" => match.match_id,
          "expected_revision" => if(match.state, do: match.state["revision"], else: 0),
          "operation" => operation
        },
        extra
      )

    case KC3Worker.request(match.worker, payload, timeout) do
      {:ok, %{"accepted" => true, "state" => state}} ->
        {:ok, %{match | state: state, tick: state["tick"]}}

      {:ok, %{"reason" => reason}} ->
        {:error, reason}

      {:error, :invalid_request} ->
        {:error, :invalid_command}

      {:error, _reason} ->
        {:error, :match_unavailable}
    end
  catch
    :exit, _ -> {:error, :match_unavailable}
  end
end
