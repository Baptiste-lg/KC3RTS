defmodule KC3RTSWeb.GameChannel do
  @moduledoc "Phoenix channel for authoritative RTS commands and snapshots."
  use Phoenix.Channel
  alias KC3RTS.Game.KC3Protocol
  alias KC3RTS.Game.MatchManager
  alias KC3RTS.Game.WorldServer
  @max_game_id_length 48
  @impl true
  def join("game:" <> game_id, _payload, socket) do
    cond do
      byte_size(game_id) > @max_game_id_length or
          not String.match?(game_id, ~r/\A[a-zA-Z0-9_-]+\z/) ->
        {:error, %{reason: "invalid_game_id"}}

      socket.assigns[:match_id] != game_id or
          not MatchManager.member?(game_id, socket.assigns[:token]) ->
        {:error, %{reason: "unauthorized"}}

      true ->
        case Registry.lookup(KC3RTS.GameRegistry, game_id) do
          [{server, _}] ->
            monitor = Process.monitor(server)

            {:ok, WorldServer.view(server),
             socket |> assign(:game_server, server) |> assign(:game_monitor, monitor)}

          [] ->
            {:error, %{reason: "game_unavailable"}}
        end
    end
  end

  @impl true
  def handle_in("request_snapshot", _payload, socket) do
    if authorized?(socket) do
      {:reply, {:ok, WorldServer.view(socket.assigns.game_server)}, socket}
    else
      {:reply, {:error, %{reason: "unauthorized"}}, socket}
    end
  end

  def handle_in("command", payload, socket) do
    if authorized?(socket) do
      submit_command(payload, socket)
    else
      {:reply, {:error, %{reason: "unauthorized"}}, socket}
    end
  end

  def handle_in(_event, _payload, socket),
    do: {:reply, {:error, %{reason: "unknown_command"}}, socket}

  @impl true
  def handle_info({:DOWN, monitor, :process, server, _reason}, socket)
      when monitor == socket.assigns.game_monitor and server == socket.assigns.game_server do
    push(socket, "match_unavailable", %{reason: "match_unavailable"})
    {:noreply, socket}
  end

  def handle_info(_message, socket), do: {:noreply, socket}

  defp authorized?(socket),
    do: MatchManager.member?(socket.assigns.match_id, socket.assigns.token)

  defp submit_command(payload, socket) do
    case {command_id(payload), parse_command(payload)} do
      {{:ok, id}, {:ok, command}} ->
        {status, result} = WorldServer.submit(socket.assigns.game_server, id, command)
        {:reply, {status, result}, socket}

      _ ->
        {:reply, {:error, %{reason: "invalid_command"}}, socket}
    end
  end

  defp command_id(%{"command_id" => id})
       when is_binary(id) and byte_size(id) in 1..64 do
    if String.match?(id, ~r/\A[a-zA-Z0-9_-]+\z/), do: {:ok, id}, else: :error
  end

  defp command_id(_), do: :error

  defp parse_command(%{"type" => type, "entity_ids" => _} = payload)
       when type in ["move", "stop"] do
    command = Map.delete(payload, "command_id")
    if KC3Protocol.command_payload?(command), do: {:ok, command}, else: :error
  end

  defp parse_command(%{"type" => "spawn_villager", "building_id" => id}) when is_integer(id),
    do: {:ok, %{type: :spawn_villager, building_id: id}}

  defp parse_command(%{"type" => "stop", "villager_ids" => ids}) when is_list(ids),
    do: {:ok, %{type: :stop, villager_ids: ids}}

  defp parse_command(%{"type" => "build", "villager_ids" => ids, "x" => x, "z" => z})
       when is_list(ids) and is_number(x) and is_number(z),
       do: {:ok, %{type: :build, villager_ids: ids, x: x, z: z}}

  defp parse_command(%{"type" => "order", "villager_ids" => ids, "order" => order})
       when is_list(ids) do
    case parse_order(order) do
      :error -> :error
      parsed -> {:ok, %{type: :order, villager_ids: ids, order: parsed}}
    end
  end

  defp parse_command(_), do: :error

  defp parse_order(%{"kind" => "move", "x" => x, "z" => z}) when is_number(x) and is_number(z),
    do: {:move, %{x: x, z: z}}

  defp parse_order(%{"kind" => "gather", "id" => id}) when is_integer(id), do: {:gather, id}
  defp parse_order(%{"kind" => "build", "id" => id}) when is_integer(id), do: {:build, id}
  defp parse_order(%{"kind" => "attack", "id" => id}) when is_integer(id), do: {:attack, id}
  defp parse_order(_), do: :error
end
