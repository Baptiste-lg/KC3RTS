defmodule KC3RTSWeb.GameChannel do
  @moduledoc "Phoenix channel for authoritative RTS commands and snapshots."
  use Phoenix.Channel
  alias KC3RTS.Game.Snapshot
  alias KC3RTS.Game.WorldServer
  @max_game_id_length 48
  @impl true
  def join("game:" <> game_id, _payload, socket) do
    if byte_size(game_id) <= @max_game_id_length and
         String.match?(game_id, ~r/\A[a-zA-Z0-9_-]+\z/) do
      case WorldServer.ensure_started(game_id) do
        {:ok, server} ->
          {:ok, %{world: server |> WorldServer.snapshot() |> Snapshot.from_world()},
           assign(socket, :game_server, server)}

        {:error, _} ->
          {:error, %{reason: "game_unavailable"}}
      end
    else
      {:error, %{reason: "invalid_game_id"}}
    end
  end

  @impl true
  def handle_in("request_snapshot", _payload, socket) do
    {:reply,
     {:ok,
      %{world: socket.assigns.game_server |> WorldServer.snapshot() |> Snapshot.from_world()}},
     socket}
  end

  def handle_in("command", payload, socket) do
    case parse_command(payload) do
      {:ok, command} ->
        case WorldServer.command(socket.assigns.game_server, command) do
          {:ok, world} -> {:reply, {:ok, %{world: world}}, socket}
          {:error, reason} -> {:reply, {:error, %{reason: Atom.to_string(reason)}}, socket}
        end

      :error ->
        {:reply, {:error, %{reason: "invalid_command"}}, socket}
    end
  end

  def handle_in(_event, _payload, socket),
    do: {:reply, {:error, %{reason: "unknown_command"}}, socket}

  defp parse_command(%{"type" => "spawn_villager", "building_id" => id}) when is_integer(id),
    do: {:ok, %{type: :spawn_villager, building_id: id}}

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
