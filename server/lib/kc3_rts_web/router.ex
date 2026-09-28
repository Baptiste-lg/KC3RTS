defmodule KC3RTSWeb.Router do
  @moduledoc false
  use Phoenix.Router

  get("/health", KC3RTSWeb.HealthController, :index)
end
