defmodule KC3RTS.Game.KC3WorkerPortTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.KC3Worker

  test "shutdown tolerates a port that has already closed" do
    port = Port.open({:spawn_executable, String.to_charlist(System.find_executable("cat"))}, [])
    Port.close(port)

    assert :ok = KC3Worker.terminate(:normal, %{port: port})
  end
end
