defmodule KC3RTSWeb.GameChannelTest do
  use ExUnit.Case, async: false
  import Phoenix.ChannelTest

  @endpoint KC3RTSWeb.Endpoint

  test "joins with a world snapshot and applies a villager recruitment command" do
    game_id = "channel-#{System.unique_integer([:positive])}"

    assert {:ok, %{world: %{protocol_version: 1, tick: 0}}, socket} =
             socket(KC3RTSWeb.UserSocket, nil, %{})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> game_id)

    reference = push(socket, "spawn_villager", %{})

    assert_reply(reference, :ok, %{villager: %{id: 1}, world: %{stockpile: 15}})

    assert_broadcast("world_snapshot", %{
      world: %{tick: 0, stockpile: 15, villagers: [%{id: 1}]}
    })
  end

  test "rejects malformed game ids" do
    assert {:error, %{reason: "invalid_game_id"}} =
             socket(KC3RTSWeb.UserSocket, nil, %{})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:bad/id")
  end
end
