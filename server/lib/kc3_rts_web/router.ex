defmodule KC3RTSWeb.Router do
  @moduledoc false
  use Phoenix.Router

  pipeline :api do
    plug(:fetch_query_params)
  end

  pipe_through(:api)

  get("/health", KC3RTSWeb.HealthController, :index)
  post("/api/matches", KC3RTSWeb.MatchController, :create)
end
