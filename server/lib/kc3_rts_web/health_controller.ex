defmodule KC3RTSWeb.HealthController do
  @moduledoc false
  use Phoenix.Controller, formats: [:json]

  def index(conn, _params), do: json(conn, %{status: "ok"})
end
