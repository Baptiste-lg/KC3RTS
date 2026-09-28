defmodule KC3RTS.Game.WorldServerTest do
  use ExUnit.Case, async: true

  alias KC3RTS.Game.WorldServer

  test "owns a match state and applies validated recruitment commands" do
    game_id = "test-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised({WorldServer, game_id: game_id, tick_interval: :disabled, seed: 4})

    assert %{tick: 0, villagers: [], stockpile: 20} = WorldServer.snapshot(server)
    assert {:ok, %{id: 1}} = WorldServer.command(server, :spawn_villager)
    assert %{villagers: [%{id: 1}], stockpile: 15} = WorldServer.snapshot(server)
    assert {:error, :unknown_command} = WorldServer.command(server, :teleport_everyone)
  end

  test "advances simulation on its scheduled server tick" do
    game_id = "tick-#{System.unique_integer([:positive])}"

    assert {:ok, server} =
             start_supervised({WorldServer, game_id: game_id, tick_interval: 10, seed: 4})

    assert eventually(fn -> WorldServer.snapshot(server).tick >= 2 end)
  end

  defp eventually(assertion, attempts \\ 20)
  defp eventually(assertion, 0), do: assertion.()

  defp eventually(assertion, attempts) do
    if assertion.() do
      true
    else
      Process.sleep(5)
      eventually(assertion, attempts - 1)
    end
  end
end
