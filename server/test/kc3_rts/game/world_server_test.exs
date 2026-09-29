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
