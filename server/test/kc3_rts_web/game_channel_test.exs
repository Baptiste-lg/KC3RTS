defmodule KC3RTSWeb.GameChannelTest do
  use ExUnit.Case, async: false
  import Phoenix.ChannelTest
  @endpoint KC3RTSWeb.Endpoint
  test "joins with a RTS snapshot and applies a recruitment command" do
    game_id = "channel-#{System.unique_integer([:positive])}"

    assert {:ok, %{world: %{protocol_version: 3, tick: 0}}, socket} =
             socket(KC3RTSWeb.UserSocket, nil, %{})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> game_id)

    reference = push(socket, "command", %{"type" => "spawn_villager", "building_id" => 1})
    assert_reply(reference, :ok, %{world: %{villagers: villagers}})
    assert length(villagers) == 4
    assert_broadcast("world_snapshot", %{world: %{protocol_version: 3}})
  end

  test "rejects malformed game ids" do
    assert {:error, %{reason: "invalid_game_id"}} =
             socket(KC3RTSWeb.UserSocket, nil, %{})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:bad/id")
  end
end
