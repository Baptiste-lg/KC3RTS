defmodule KC3RTSWeb.UserSocket do
  @moduledoc false
  use Phoenix.Socket
  alias KC3RTS.Game.MatchManager

  channel("game:*", KC3RTSWeb.GameChannel)

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case MatchManager.authorize(token) do
      {:ok, match_id} -> {:ok, assign(socket, match_id: match_id, token: token)}
      :error -> :error
    end
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(_socket), do: nil
end
