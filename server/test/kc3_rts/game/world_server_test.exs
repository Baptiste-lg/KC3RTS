defmodule KC3RTS.Game.WorldServerTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.WorldServer

  test "owns a match and applies validated RTS commands" do
    game_id = "test-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised({WorldServer, game_id: game_id, tick_interval: :disabled, seed: 4})

    assert %{tick: 0, villagers: [_, _, _]} = WorldServer.snapshot(server)

    assert {:ok, %{villagers: villagers}} =
             WorldServer.command(server, %{type: :spawn_villager, building_id: 1})

    assert length(villagers) == 4
    assert {:error, :unknown_command} = WorldServer.command(server, %{})
  end

  test "advances simulation on scheduled ticks" do
    game_id = "tick-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised({WorldServer, game_id: game_id, tick_interval: 10, seed: 4})

    assert eventually(fn -> WorldServer.snapshot(server).tick >= 2 end)
  end

  test "catches up elapsed ticks after the process is suspended" do
    game_id = "delayed-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised({WorldServer, game_id: game_id, tick_interval: 10, seed: 4})

    :sys.suspend(server)
    Process.sleep(90)
    :sys.resume(server)
    assert eventually(fn -> WorldServer.snapshot(server).tick >= 7 end)
  end

  test "stops scheduling ticks after the match ends" do
    game_id = "ended-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised({WorldServer, game_id: game_id, tick_interval: 10, seed: 4})

    :sys.replace_state(server, fn state ->
      %{state | world: %{state.world | outcome: :victory}}
    end)

    %{world: %{tick: tick}, revision: revision} = WorldServer.view(server)
    Process.sleep(50)
    assert %{world: %{tick: ^tick}, revision: ^revision} = WorldServer.view(server)
  end

  test "returns one versioned result for a retried command" do
    game_id = "revision-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised({WorldServer, game_id: game_id, tick_interval: :disabled, seed: 4})

    command = %{type: :spawn_villager, building_id: 1}

    assert {:ok, %{revision: 1, command_id: "first", world: %{villagers: villagers}} = result} =
             WorldServer.submit(server, "first", command)

    assert length(villagers) == 4
    assert {:ok, ^result} = WorldServer.submit(server, "first", command)

    assert {:error, %{reason: "command_id_conflict", revision: 1}} =
             WorldServer.submit(server, "first", %{type: :stop, villager_ids: [1]})

    assert {:error, %{reason: "unknown_command", revision: 1, command_id: "bad"}} =
             WorldServer.submit(server, "bad", %{})

    assert %{revision: 1, world: %{villagers: villagers}} = WorldServer.view(server)
    assert length(villagers) == 4
  end

  test "broadcasts only changed entities in a revisioned patch" do
    game_id = "patch-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised({WorldServer, game_id: game_id, tick_interval: :disabled, seed: 4})

    Phoenix.PubSub.subscribe(KC3RTS.PubSub, "game:" <> game_id)

    assert {:ok, _} =
             WorldServer.submit(server, "recruit", %{type: :spawn_villager, building_id: 1})

    assert_receive %Phoenix.Socket.Broadcast{
      event: "world_patch",
      payload: %{
        base_revision: 0,
        revision: 1,
        resources: %{upsert: []},
        buildings: %{upsert: []},
        villagers: %{upsert: [%{id: 4}]}
      }
    }
  end

  test "limits new commands while allowing a retry of an acknowledged command" do
    game_id = "throttle-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised(
               {WorldServer,
                game_id: game_id, tick_interval: :disabled, seed: 4, max_commands_per_second: 1}
             )

    command = %{type: :spawn_villager, building_id: 1}
    assert {:ok, result} = WorldServer.submit(server, "first", command)
    assert {:ok, ^result} = WorldServer.submit(server, "first", command)

    assert {:error, %{reason: "rate_limited", revision: 1}} =
             WorldServer.submit(server, "second", command)

    assert length(WorldServer.snapshot(server).villagers) == 4
  end

  test "concurrent joins share one match process" do
    game_id = "race-#{System.unique_integer([:positive])}"

    results =
      1..20
      |> Task.async_stream(
        fn _ -> WorldServer.ensure_started(game_id, tick_interval: :disabled, seed: 4) end,
        max_concurrency: 20
      )
      |> Enum.to_list()

    assert [{:ok, {:ok, pid}}] = Enum.uniq(results)
    assert Process.alive?(pid)
    assert [{^pid, _}] = Registry.lookup(KC3RTS.GameRegistry, game_id)
    on_exit(fn -> DynamicSupervisor.terminate_child(KC3RTS.GameSupervisor, pid) end)
  end

  defp eventually(assertion, attempts \\ 20)
  defp eventually(assertion, 0), do: assertion.()

  defp eventually(assertion, attempts) do
    if assertion.(),
      do: true,
      else:
        (
          Process.sleep(5)
          eventually(assertion, attempts - 1)
        )
  end
end
