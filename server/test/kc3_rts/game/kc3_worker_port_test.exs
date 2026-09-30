defmodule KC3RTS.Game.KC3WorkerPortTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.KC3Worker
  import KC3RTS.KC3Boundary

  @fixture Path.expand("../../../../fixtures/kc3_opening_v2.json", __DIR__)
           |> File.read!()
           |> String.trim_trailing()
  @limit 262_144

  test "shutdown tolerates a port that has already closed" do
    port = Port.open({:spawn_executable, String.to_charlist(System.find_executable("cat"))}, [])
    Port.close(port)
    assert :ok = KC3Worker.terminate(:normal, %{port: port})
  end

  test "accepts an exact-limit reply and rejects one byte beyond, excluding newline" do
    for size <- [@limit, @limit + 1, @limit + 100] do
      worker = fake(@fixture <> String.duplicate(" ", size - byte_size(@fixture)) <> "\n")
      monitor = Process.monitor(worker)

      if size == @limit do
        assert {:ok, %{"accepted" => true}} = KC3Worker.request(worker, request(1, "new_match"))
      else
        assert {:error, :oversized_worker_reply} =
                 KC3Worker.request(worker, request(1, "new_match"))

        assert_receive {:DOWN, ^monitor, :process, ^worker, :normal}
      end
    end
  end

  test "malformed JSON, mismatched identity and partial replies stop the boundary" do
    for output <- [
          "broken\n",
          String.replace(@fixture, "\"request_id\":1", "\"request_id\":2") <> "\n",
          "{\n"
        ] do
      worker = fake(output)
      monitor = Process.monitor(worker)
      assert {:error, :invalid_worker_reply} = KC3Worker.request(worker, request(1, "new_match"))
      assert_receive {:DOWN, ^monitor, :process, ^worker, :normal}
    end

    worker = fake("{", "", "")
    assert {:error, :worker_exited} = KC3Worker.request(worker, request(1, "new_match"))
  end

  test "timeouts kill the worker, busy requests reject, stale timers are harmless" do
    worker = fake("", "sleep 1\nexit 0\n")
    send(worker, {:request_timeout, make_ref()})
    task = Task.async(fn -> KC3Worker.request(worker, request(1, "new_match"), 200) end)
    wait_pending(worker)
    assert {:error, :busy} = KC3Worker.request(worker, request(2, "snapshot"))
    assert {:error, :timeout} = Task.await(task)
    monitor = Process.monitor(worker)
    assert_receive {:DOWN, ^monitor, :process, ^worker, _reason}
  end

  test "bad input does not reach the worker and process exits cannot fall back" do
    worker = fake(@fixture <> "\n")
    assert {:error, :invalid_request} = KC3Worker.request(worker, %{})
    assert {:error, :invalid_timeout} = KC3Worker.request(worker, request(1, "new_match"), 0)
    assert {:ok, _} = KC3Worker.request(worker, request(1, "new_match"))
    failed = fake("", "exit 1\n")
    assert {:error, :worker_exited} = KC3Worker.request(failed, request(1, "new_match"))
  end

  test "unsolicited output stops the process" do
    worker = fake(@fixture <> "\n", "", "sleep 1\n", false)
    monitor = Process.monitor(worker)
    assert_receive {:DOWN, ^monitor, :process, ^worker, :normal}, 2000
  end

  defp fake(output, before_reply \\ "", after_reply \\ "sleep 1\n", read? \\ true) do
    directory = Path.join(System.tmp_dir!(), "kc3rts-port-#{System.unique_integer([:positive])}")
    File.mkdir_p!(directory)
    File.write!(Path.join(directory, "reply"), output)
    binary = Path.join(directory, "worker")
    read = if read?, do: "IFS= read -r request\n", else: ""

    File.write!(
      binary,
      "#!/bin/sh\n" <> read <> before_reply <> "cat '" <> directory <> "/reply'\n" <> after_reply
    )

    File.chmod!(binary, 0o700)
    {:ok, worker} = KC3Worker.start_link(binary: binary)

    on_exit(fn ->
      try do
        GenServer.stop(worker)
      catch
        :exit, _ -> :ok
      end

      File.rm_rf!(directory)
    end)

    worker
  end

  defp wait_pending(worker, retries \\ 100) do
    case :sys.get_state(worker) do
      %{pending: nil} when retries > 0 ->
        Process.sleep(1)
        wait_pending(worker, retries - 1)

      %{pending: pending} ->
        assert pending != nil
    end
  end
end
