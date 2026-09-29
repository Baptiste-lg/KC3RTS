defmodule KC3RTS.Game.KC3WorkerTest do
  use ExUnit.Case, async: false
  alias KC3RTS.Game.KC3Worker

  @moduletag skip: is_nil(System.get_env("KC3RTS_KC3S"))

  test "KC3 retains a match, applies its recruitment cost, rejects commands, and advances ticks" do
    {:ok, worker} = KC3Worker.start_link(binary: System.fetch_env!("KC3RTS_KC3S"))
    on_exit(fn -> stop_if_running(worker) end)

    assert {:ok, %{"accepted" => true, "revision" => 1, "state" => opening}} =
             KC3Worker.request(worker, request(1, "new_match", 0) |> Map.put("seed", 1234))

    assert opening["wood"] == 30
    assert opening["gold"] == 20
    assert opening["villagers"] == 3

    assert {:error, :invalid_request} =
             KC3Worker.request(worker, request(8, "new_match", 0) |> Map.put("seed", 0))

    recruit = %{"type" => "spawn_villager", "building_id" => 1}

    assert {:ok, %{"accepted" => true, "revision" => 2, "state" => recruited}} =
             KC3Worker.request(
               worker,
               request(2, "command", 1) |> Map.merge(%{"actor_slot" => 1, "command" => recruit})
             )

    assert {recruited["wood"], recruited["gold"], recruited["villagers"]} == {25, 15, 4}

    assert {:error, :oversized_request} =
             KC3Worker.request(
               worker,
               request(9, "tick", 2) |> Map.put("padding", String.duplicate("x", 4_100))
             )

    assert {:ok, %{"accepted" => false, "reason" => "invalid_command", "revision" => 2}} =
             KC3Worker.request(
               worker,
               request(3, "command", 2) |> Map.merge(%{"actor_slot" => 2, "command" => recruit})
             )

    assert {:ok, %{"accepted" => false, "reason" => "stale_revision", "revision" => 2}} =
             KC3Worker.request(worker, request(4, "tick", 1))

    assert {:ok, %{"accepted" => true, "revision" => 3, "state" => %{"tick" => 1}}} =
             KC3Worker.request(worker, request(5, "tick", 2))

    assert {:ok, %{"accepted" => true, "revision" => 4, "state" => %{"tick" => 2}}} =
             KC3Worker.request(worker, request(6, "tick", 3))

    assert {:ok, %{"accepted" => true, "revision" => 4, "state" => snapshot}} =
             KC3Worker.request(worker, request(7, "snapshot", 4))

    assert {snapshot["wood"], snapshot["gold"], snapshot["villagers"], snapshot["tick"]} ==
             {25, 15, 4, 2}
  end

  test "a slow or failed worker ends the match instead of falling back to Elixir" do
    {:ok, slow} = KC3Worker.start_link(binary: System.fetch_env!("KC3RTS_KC3S"))

    assert {:error, :timeout} =
             KC3Worker.request(slow, request(1, "new_match", 0) |> Map.put("seed", 1), 1)

    monitor = Process.monitor(slow)
    assert_receive {:DOWN, ^monitor, :process, ^slow, _reason}, 1_000

    {:ok, failed} = KC3Worker.start_link(binary: System.find_executable("false"))

    assert {:error, :worker_exited} =
             KC3Worker.request(failed, request(1, "new_match", 0) |> Map.put("seed", 1))

    {:ok, restarted} = KC3Worker.start_link(binary: System.fetch_env!("KC3RTS_KC3S"))
    on_exit(fn -> stop_if_running(restarted) end)

    assert {:ok, %{"accepted" => true, "revision" => 1}} =
             KC3Worker.request(restarted, request(1, "new_match", 0) |> Map.put("seed", 1))
  end

  test "KC3 reserves construction cost, validates the site and builder, and finishes the center on ticks" do
    {:ok, worker} = KC3Worker.start_link(binary: System.fetch_env!("KC3RTS_KC3S"))
    on_exit(fn -> stop_if_running(worker) end)

    assert {:ok, %{"accepted" => true, "state" => opening}} =
             KC3Worker.request(worker, request(1, "new_match", 0) |> Map.put("seed", 91))

    assert opening["stone"] == 15
    build = %{"type" => "build_center", "villager_id" => 1, "x" => 22, "z" => -22}

    assert {:ok, %{"accepted" => false, "reason" => "invalid_location", "revision" => 1}} =
             KC3Worker.request(worker, command_request(2, 1, %{build | "x" => 0, "z" => 0}))

    assert {:ok, %{"accepted" => false, "reason" => "invalid_builder", "revision" => 1}} =
             KC3Worker.request(worker, command_request(3, 1, %{build | "villager_id" => 99}))

    assert {:ok, %{"accepted" => false, "reason" => "invalid_building", "revision" => 1}} =
             KC3Worker.request(
               worker,
               command_request(4, 1, %{"type" => "spawn_villager", "building_id" => 3})
             )

    assert {:ok, %{"accepted" => true, "revision" => 2, "state" => reserved}} =
             KC3Worker.request(worker, command_request(5, 1, build))

    assert {reserved["wood"], reserved["stone"], reserved["center_2_progress"]} == {5, 0, 0}
    assert {reserved["center_2_x"], reserved["center_2_z"]} == {22, -22}

    assert {:ok, %{"accepted" => false, "reason" => "invalid_building", "revision" => 2}} =
             KC3Worker.request(
               worker,
               command_request(6, 2, %{"type" => "spawn_villager", "building_id" => 3})
             )

    assert {:ok, %{"accepted" => false, "reason" => "invalid_builder", "revision" => 2}} =
             KC3Worker.request(worker, command_request(7, 2, build))

    for tick <- 1..100 do
      assert {:ok, %{"accepted" => true, "revision" => revision}} =
               KC3Worker.request(worker, request(7 + tick, "tick", 1 + tick))

      assert revision == tick + 2
    end

    assert {:ok, %{"accepted" => true, "revision" => 102, "state" => finished}} =
             KC3Worker.request(worker, request(108, "snapshot", 102))

    assert finished["center_2_finished"] == true
    assert finished["center_2_progress"] == 100

    assert {:ok, %{"accepted" => true, "revision" => 103, "state" => recruited}} =
             KC3Worker.request(
               worker,
               command_request(109, 102, %{"type" => "spawn_villager", "building_id" => 3})
             )

    assert {recruited["wood"], recruited["gold"], recruited["villagers"]} == {0, 15, 4}

    assert {:ok, %{"accepted" => false, "reason" => "insufficient_resources", "revision" => 103}} =
             KC3Worker.request(
               worker,
               command_request(110, 103, %{"type" => "spawn_villager", "building_id" => 1})
             )
  end

  test "the Elixir port rejects malformed requests before KC3 receives them" do
    {:ok, worker} = KC3Worker.start_link(binary: System.fetch_env!("KC3RTS_KC3S"))
    on_exit(fn -> stop_if_running(worker) end)

    assert {:error, :invalid_request} = KC3Worker.request(worker, %{})

    assert {:error, :invalid_request} =
             KC3Worker.request(
               worker,
               request(1, "new_match", 0)
               |> Map.put("seed", 91)
               |> Map.put("ruleset_version", 0)
             )

    assert {:error, :invalid_request} =
             KC3Worker.request(worker, request(1, "new_match", 0) |> Map.put("seed", -1))

    assert {:error, :invalid_request} =
             KC3Worker.request(worker, request(1, "tick", 0) |> Map.put("match_id", "bad/id"))

    assert {:error, :invalid_request} =
             KC3Worker.request(
               worker,
               command_request(1, 0, %{
                 "type" => "build_center",
                 "villager_id" => 1,
                 "x" => "far",
                 "z" => 0
               })
             )

    assert {:error, :invalid_timeout} = KC3Worker.request(worker, request(1, "tick", 0), 0)

    assert {:ok, %{"accepted" => true, "revision" => 1}} =
             KC3Worker.request(worker, request(2, "new_match", 0) |> Map.put("seed", 91))
  end

  test "a malformed process reply stops the rules boundary" do
    binary =
      Path.join(System.tmp_dir!(), "kc3rts-bad-worker-#{System.unique_integer([:positive])}.sh")

    File.write!(binary, "#!/bin/sh\nread request\nprintf 'broken-json\\n'\n")
    File.chmod!(binary, 0o700)
    on_exit(fn -> File.rm(binary) end)

    {:ok, worker} = KC3Worker.start_link(binary: binary)
    monitor = Process.monitor(worker)

    assert {:error, :invalid_worker_reply} =
             KC3Worker.request(worker, request(1, "new_match", 0) |> Map.put("seed", 91))

    assert_receive {:DOWN, ^monitor, :process, ^worker, _reason}, 1_000
  end

  defp request(id, operation, revision) do
    %{
      "protocol_version" => 1,
      "ruleset_version" => 1,
      "request_id" => id,
      "match_id" => "port-test",
      "expected_revision" => revision,
      "operation" => operation
    }
  end

  defp command_request(id, revision, command) do
    request(id, "command", revision)
    |> Map.merge(%{"actor_slot" => 1, "command" => command})
  end

  defp stop_if_running(worker) do
    GenServer.stop(worker)
  catch
    :exit, _reason -> :ok
  end
end
