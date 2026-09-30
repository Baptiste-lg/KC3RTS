defmodule KC3RTS.Application do
  @moduledoc false
  use Application

  alias KC3RTS.Game.MatchManager

  @impl true
  def start(_type, _args) do
    children = [
      {Registry, keys: :unique, name: KC3RTS.GameRegistry},
      {Phoenix.PubSub, name: KC3RTS.PubSub},
      {DynamicSupervisor, strategy: :one_for_one, name: KC3RTS.GameSupervisor},
      MatchManager,
      KC3RTSWeb.Endpoint
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: KC3RTS.Supervisor)
  end
end
