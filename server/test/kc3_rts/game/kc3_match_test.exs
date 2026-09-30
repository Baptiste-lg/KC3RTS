defmodule KC3RTS.Game.KC3MatchTest do
  use ExUnit.Case, async: false
  alias KC3RTS.Game.WorldServer
  @moduletag timeout: 120_000
  @moduletag skip: is_nil(System.get_env("KC3RTS_KC3S"))

  test "browser-shaped move and stop orders mutate only the KC3 state" do
    id = "kc3-match-#{System.unique_integer([:positive])}"

    server =
      start_supervised!(
        {WorldServer, game_id: id, engine: :kc3, tick_interval: :disabled, seed: 1234}
      )

    assert %{world: %{"protocol_version" => 5, "entities" => entities}, revision: 1} =
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

  test "queue and cancellation retries preserve exact payment and reservation" do
    id = "kc3-economy-#{System.unique_integer([:positive])}"

    server =
      start_supervised!(
        {WorldServer, game_id: id, engine: :kc3, tick_interval: :disabled, seed: 1234}
      )

    train = %{
      "type" => "produce",
      "entity_id" => 1,
      "recipe_id" => "core.train_worker",
      "x" => 0,
      "z" => 0
    }

    assert {:ok, paid} = WorldServer.submit(server, "train", train)
    assert {:ok, ^paid} = WorldServer.submit(server, "train", train)
    assert hd(paid.world["players"])["stocks"]["core.food"] == 150
    assert hd(paid.world["players"])["population"]["reserved"] == 1
    assert [%{"id" => job}] = hd(paid.world["entities"])["queue"]
    cancel = %{"type" => "cancel", "entity_id" => 1, "queue_id" => job}

    assert {:error, %{reason: "command_id_conflict"}} =
             WorldServer.submit(server, "train", cancel)

    assert {:ok, refunded} = WorldServer.submit(server, "cancel", cancel)
    assert {:ok, ^refunded} = WorldServer.submit(server, "cancel", cancel)
    assert hd(refunded.world["players"])["stocks"]["core.food"] == 200
    assert hd(refunded.world["players"])["population"]["reserved"] == 0

    assert {:error, %{reason: "invalid_queue"}} =
             WorldServer.submit(server, "cancel-again", cancel)

    assert WorldServer.view(server).world == refunded.world
  end

  test "overdue KC3 ticks yield to queued player calls after one step" do
    id = "kc3-catchup-#{System.unique_integer([:positive])}"

    server =
      start_supervised!(
        {WorldServer, game_id: id, engine: :kc3, tick_interval: :disabled, seed: 1234}
      )

    :sys.suspend(server)
    deadline = System.monotonic_time(:millisecond) - 1000
    :sys.replace_state(server, &%{&1 | tick_interval: 100, next_deadline: deadline})
    send(server, {:tick, deadline})
    ref = make_ref()
    send(server, {:"$gen_call", {self(), ref}, :view})
    :sys.resume(server)
    assert_receive {^ref, %{world: %{"tick" => 1}, revision: 2}}, 5000
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
