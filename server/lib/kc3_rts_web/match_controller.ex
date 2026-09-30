defmodule KC3RTSWeb.MatchController do
  @moduledoc false
  use Phoenix.Controller, formats: [:json]

  alias KC3RTS.Game.MatchManager

  def create(conn, _params) do
    conn = Plug.Conn.put_resp_header(conn, "cache-control", "no-store")

    case MatchManager.create() do
      {:ok, match} ->
        json(Plug.Conn.put_status(conn, :created), match)

      {:error, :match_limit} ->
        json(Plug.Conn.put_status(conn, :too_many_requests), %{reason: "match_limit"})

      {:error, _} ->
        json(Plug.Conn.put_status(conn, :service_unavailable), %{reason: "match_unavailable"})
    end
  end
end
