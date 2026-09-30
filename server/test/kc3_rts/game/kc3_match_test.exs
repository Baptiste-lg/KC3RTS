defmodule KC3RTS.Game.KC3MatchTest do
  use ExUnit.Case, async: false
  alias KC3RTS.Game.WorldServer
  @moduletag skip: is_nil(System.get_env("KC3RTS_KC3S"))

  test "browser-shaped move and stop orders mutate only the KC3 state" do
    id = "kc3-match-#{System.unique_integer([:positive])}"

    server =
      start_supervised!(
        {WorldServer, game_id: id, engine: :kc3, tick_interval: :disabled, seed: 1234}
      )

    assert %{world: %{"protocol_version" => 4, "entities" => entities}, revision: 1} =
             WorldServer.view(server)

    assert length(entities) == 14
    move = %{"type" => "move", "entity_ids" => [2], "x" => 1536, "z" => 512}
    assert {:ok, %{revision: 2} = accepted} = WorldServer.submit(server, "move", move)
    assert {:ok, ^accepted} = WorldServer.submit(server, "move", move)

    assert {:error, %{reason: "invalid_selection", revision: 2}} =
             WorldServer.submit(server, "mixed", %{move | "entity_ids" => [2, 9]})

    assert {:error, %{reason: "invalid_selection", revision: 2}} =
             WorldServer.submit(server, "enemy", %{move | "entity_ids" => [9]})

    assert {:ok, %{revision: 3, world: %{"entities" => stopped}}} =
             WorldServer.submit(server, "stop", %{"type" => "stop", "entity_ids" => [2]})

    assert Enum.find(stopped, &(&1["id"] == 2))["order"] == nil
  end

  test "KC3 failure makes the match unavailable without switching engines" do
    id = "kc3-failure-#{System.unique_integer([:positive])}"

    server =
      start_supervised!({WorldServer, game_id: id, engine: :kc3, tick_interval: 100, seed: 1234})

    Phoenix.PubSub.subscribe(KC3RTS.PubSub, "game:" <> id)

    assert_receive %Phoenix.Socket.Broadcast{
                     event: "world_snapshot",
                     payload: %{world: %{"tick" => tick}}
                   },
                   3000

    assert tick > 0
    worker = :sys.get_state(server).world.worker
    monitor = Process.monitor(server)
    port = :sys.get_state(worker).port
    Port.close(port)
    assert_receive {:DOWN, ^monitor, :process, ^server, _}, 3000
    refute Process.alive?(server)

    assert Enum.all?(Registry.lookup(KC3RTS.GameRegistry, id), fn {pid, _} ->
             not Process.alive?(pid)
           end)
  end
end
