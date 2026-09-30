defmodule KC3RTSWeb.RouterTest do
  use ExUnit.Case, async: true

  import Plug.Test
  alias KC3RTS.Game.MatchManager

  test "health endpoint returns a JSON status" do
    conn = conn(:get, "/health") |> KC3RTSWeb.Router.call([])

    assert conn.status == 200
    assert Plug.Conn.get_resp_header(conn, "content-type") == ["application/json; charset=utf-8"]
    assert Jason.decode!(conn.resp_body) == %{"status" => "ok"}
  end

  test "creates an isolated guest match with an uncached token" do
    conn = conn(:post, "/api/matches") |> KC3RTSWeb.Router.call([])

    assert conn.status == 201
    assert Plug.Conn.get_resp_header(conn, "cache-control") == ["no-store"]
    assert %{"match_id" => match_id, "token" => token} = Jason.decode!(conn.resp_body)
    assert {:ok, ^match_id} = MatchManager.authorize(token)
  end
end
