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

  test "returns snapshots, applies orders, and reports rejected commands" do
    game_id = "commands-#{System.unique_integer([:positive])}"

    assert {:ok, %{world: opening}, socket} =
             socket(KC3RTSWeb.UserSocket, nil, %{})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> game_id)

    reference = push(socket, "request_snapshot", %{})
    assert_reply(reference, :ok, %{world: snapshot})
    assert snapshot.seed == opening.seed

    reference =
      push(socket, "command", %{
        "type" => "order",
        "villager_ids" => [1, 2],
        "order" => %{"kind" => "move", "x" => 8, "z" => 8}
      })

    assert_reply(reference, :ok, %{world: %{villagers: villagers}})
    assert Enum.at(villagers, 0).order == %{kind: "move", x: 8, z: 8}

    reference = push(socket, "command", %{"type" => "stop", "villager_ids" => [1]})
    assert_reply(reference, :ok, %{world: %{villagers: stopped}})
    assert hd(stopped).order == nil
    assert Enum.at(stopped, 1).order != nil

    reference = push(socket, "command", %{"type" => "stop", "villager_ids" => [1, 999]})
    assert_reply(reference, :error, %{reason: "invalid_selection"})

    reference =
      push(socket, "command", %{"type" => "build", "villager_ids" => [1], "x" => 0, "z" => 0})

    assert_reply(reference, :error, %{reason: "invalid_location"})

    reference =
      push(socket, "command", %{
        "type" => "order",
        "villager_ids" => [1],
        "order" => %{"kind" => "attack", "id" => 999}
      })

    assert_reply(reference, :error, %{reason: "invalid_target"})

    for payload <- [
          %{"type" => "order", "villager_ids" => [1], "order" => %{"kind" => "dance"}},
          %{"type" => "build", "villager_ids" => [1], "x" => "far", "z" => 0},
          %{"type" => "spawn_villager", "building_id" => "one"},
          %{"type" => "stop", "villager_ids" => "one"}
        ] do
      reference = push(socket, "command", payload)
      assert_reply(reference, :error, %{reason: "invalid_command"})
    end

    reference = push(socket, "unsupported_event", %{})
    assert_reply(reference, :error, %{reason: "unknown_command"})
  end
end
