defmodule KC3RTSWeb.GameChannelTest do
  use ExUnit.Case, async: false
  import Phoenix.ChannelTest
  alias KC3RTS.Game.MatchManager
  @endpoint KC3RTSWeb.Endpoint
  test "joins with a RTS snapshot and applies a recruitment command" do
    {:ok, %{match_id: game_id, token: token}} = MatchManager.create()

    assert {:ok, %{world: %{protocol_version: 3, tick: 0}}, socket} =
             socket(KC3RTSWeb.UserSocket, nil, %{match_id: game_id, token: token})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> game_id)

    reference = command(socket, %{"type" => "spawn_villager", "building_id" => 1})
    assert_reply(reference, :ok, %{world: %{villagers: villagers}})
    assert length(villagers) == 4
    assert_broadcast("world_patch", %{protocol_version: 3, revision: 1})
  end

  test "rejects malformed game ids" do
    {:ok, %{match_id: game_id, token: token}} = MatchManager.create()

    assert {:error, %{reason: "invalid_game_id"}} =
             socket(KC3RTSWeb.UserSocket, nil, %{match_id: game_id, token: token})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:bad/id")
  end

  test "returns snapshots, applies orders, and reports rejected commands" do
    {:ok, %{match_id: game_id, token: token}} = MatchManager.create()

    assert {:ok, %{world: opening}, socket} =
             socket(KC3RTSWeb.UserSocket, nil, %{match_id: game_id, token: token})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> game_id)

    reference = push(socket, "request_snapshot", %{})
    assert_reply(reference, :ok, %{world: snapshot})
    assert snapshot.seed == opening.seed

    reference =
      command(socket, %{
        "type" => "order",
        "villager_ids" => [1, 2],
        "order" => %{"kind" => "move", "x" => 8, "z" => 8}
      })

    assert_reply(reference, :ok, %{world: %{villagers: villagers}})
    assert Enum.at(villagers, 0).order == %{kind: "move", x: 8, z: 8}

    reference = command(socket, %{"type" => "stop", "villager_ids" => [1]})
    assert_reply(reference, :ok, %{world: %{villagers: stopped}})
    assert hd(stopped).order == nil
    assert Enum.at(stopped, 1).order != nil

    reference = command(socket, %{"type" => "stop", "villager_ids" => [1, 999]})
    assert_reply(reference, :error, %{reason: "invalid_selection"})

    reference =
      command(socket, %{"type" => "build", "villager_ids" => [1], "x" => 0, "z" => 0})

    assert_reply(reference, :error, %{reason: "invalid_location"})

    reference =
      command(socket, %{
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
      reference = command(socket, payload)
      assert_reply(reference, :error, %{reason: "invalid_command"})
    end

    reference = push(socket, "unsupported_event", %{})
    assert_reply(reference, :error, %{reason: "unknown_command"})
  end

  test "rejects another guest's match and forged socket identity" do
    {:ok, %{match_id: own_id, token: own_token}} = MatchManager.create()
    {:ok, %{match_id: other_id, token: other_token}} = MatchManager.create()

    assert {:error, %{reason: "unauthorized"}} =
             socket(KC3RTSWeb.UserSocket, nil, %{match_id: own_id, token: own_token})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> other_id)

    assert {:error, %{reason: "unauthorized"}} =
             socket(KC3RTSWeb.UserSocket, nil, %{match_id: other_id, token: own_token})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> other_id)

    assert {:ok, %{world: _}, socket} =
             socket(KC3RTSWeb.UserSocket, nil, %{match_id: other_id, token: other_token})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> other_id)

    assert {:reply, {:error, %{reason: "unauthorized"}}, _socket} =
             KC3RTSWeb.GameChannel.handle_in(
               "command",
               %{"type" => "spawn_villager", "building_id" => 1},
               Phoenix.Socket.assign(socket, :token, own_token)
             )
  end

  test "authenticates the socket and reports a failed match process" do
    {:ok, %{match_id: match_id, token: token}} = MatchManager.create()
    assert {:ok, _socket} = connect(KC3RTSWeb.UserSocket, %{"token" => token})
    assert :error = connect(KC3RTSWeb.UserSocket, %{"token" => token <> "x"})
    assert :error = connect(KC3RTSWeb.UserSocket, %{})

    assert {:ok, %{world: _}, _socket} =
             socket(KC3RTSWeb.UserSocket, nil, %{match_id: match_id, token: token})
             |> subscribe_and_join(KC3RTSWeb.GameChannel, "game:" <> match_id)

    [{pid, _}] = Registry.lookup(KC3RTS.GameRegistry, match_id)
    Process.exit(pid, :kill)
    assert_push("match_unavailable", %{reason: "match_unavailable"})
    assert :error = MatchManager.authorize(token)
  end

  defp command(socket, payload) do
    push(
      socket,
      "command",
      Map.put(payload, "command_id", "cmd-#{System.unique_integer([:positive])}")
    )
  end
end
