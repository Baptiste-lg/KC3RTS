defmodule KC3RTSWeb.RouterTest do
  use ExUnit.Case, async: true

  import Plug.Test

  test "health endpoint returns a JSON status" do
    conn = conn(:get, "/health") |> KC3RTSWeb.Router.call([])

    assert conn.status == 200
    assert Plug.Conn.get_resp_header(conn, "content-type") == ["application/json; charset=utf-8"]
    assert Jason.decode!(conn.resp_body) == %{"status" => "ok"}
  end
end
