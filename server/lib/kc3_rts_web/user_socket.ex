defmodule KC3RTSWeb.UserSocket do
  @moduledoc false
  use Phoenix.Socket

  channel("game:*", KC3RTSWeb.GameChannel)

  @impl true
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl true
  def id(_socket), do: nil
end
