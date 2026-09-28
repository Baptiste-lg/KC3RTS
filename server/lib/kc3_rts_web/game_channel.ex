defmodule KC3RTSWeb.GameChannel do
  @moduledoc "Phoenix channel for the authoritative match state and player commands."
  use Phoenix.Channel

  alias KC3RTS.Game.Snapshot
  alias KC3RTS.Game.WorldServer

  @max_game_id_length 48

  @impl true
  def join("game:" <> game_id, _payload, socket) do
    if valid_game_id?(game_id) do
      case WorldServer.ensure_started(game_id) do
        {:ok, server} ->
          world = server |> WorldServer.snapshot() |> Snapshot.from_world()
          {:ok, %{world: world}, assign(socket, :game_server, server)}

        {:error, _reason} ->
          {:error, %{reason: "game_unavailable"}}
      end
    else
      {:error, %{reason: "invalid_game_id"}}
    end
  end

  @impl true
  def handle_in("request_snapshot", _payload, socket) do
    world = socket.assigns.game_server |> WorldServer.snapshot() |> Snapshot.from_world()
    {:reply, {:ok, %{world: world}}, socket}
  end

  def handle_in("spawn_villager", _payload, socket) do
    case WorldServer.command(socket.assigns.game_server, :spawn_villager) do
      {:ok, villager} ->
        world = socket.assigns.game_server |> WorldServer.snapshot() |> Snapshot.from_world()
        {:reply, {:ok, %{villager: villager, world: world}}, socket}

      {:error, :insufficient_resources} ->
        {:reply, {:error, %{reason: "insufficient_resources"}}, socket}

      {:error, _reason} ->
        {:reply, {:error, %{reason: "command_rejected"}}, socket}
    end
  end

  def handle_in(_event, _payload, socket),
    do: {:reply, {:error, %{reason: "unknown_command"}}, socket}

  defp valid_game_id?(game_id) do
    byte_size(game_id) <= @max_game_id_length and
      String.match?(game_id, ~r/\A[a-zA-Z0-9_-]+\z/)
  end
end
