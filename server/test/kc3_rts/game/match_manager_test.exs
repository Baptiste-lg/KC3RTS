defmodule KC3RTS.Game.MatchManagerTest do
  use ExUnit.Case, async: false
  alias KC3RTS.Game.MatchManager

  test "caps matches, validates the signed capability, and expires idle games" do
    manager =
      start_supervised!({MatchManager, name: nil, max_matches: 1, idle_ms: 30, sweep_ms: 10})

    assert {:ok, %{match_id: match_id, token: token}} = MatchManager.create(manager)
    assert [{pid, _}] = Registry.lookup(KC3RTS.GameRegistry, match_id)
    assert {:error, :match_limit} = MatchManager.create(manager)
    assert {:ok, ^match_id} = MatchManager.authorize(token, manager)
    refute MatchManager.member?(match_id, token <> "x", manager)
    assert eventually(fn -> Registry.lookup(KC3RTS.GameRegistry, match_id) == [] end)
    assert :error = MatchManager.authorize(token, manager)
    refute Process.alive?(pid)
    assert {:ok, %{match_id: replacement}} = MatchManager.create(manager)
    assert replacement != match_id
  end

  test "rejects a dead match even before Registry consumes its DOWN message" do
    manager = start_supervised!({MatchManager, name: nil})
    assert {:ok, %{match_id: id, token: token}} = MatchManager.create(manager)
    [{pid, _}] = Registry.lookup(KC3RTS.GameRegistry, id)

    partitions =
      for {_, partition, _, _} <- Supervisor.which_children(KC3RTS.GameRegistry), do: partition

    Enum.each(partitions, &:sys.suspend/1)

    try do
      monitor = Process.monitor(pid)
      Process.exit(pid, :kill)
      assert_receive {:DOWN, ^monitor, :process, ^pid, :killed}
      assert Registry.lookup(KC3RTS.GameRegistry, id) != []
      assert :error = MatchManager.authorize(token, manager)
      refute MatchManager.member?(id, token, manager)
    after
      Enum.each(partitions, &:sys.resume/1)
    end
  end

  defp eventually(assertion, attempts \\ 20)
  defp eventually(assertion, 0), do: assertion.()

  defp eventually(assertion, attempts) do
    if assertion.() do
      true
    else
      Process.sleep(10)
      eventually(assertion, attempts - 1)
    end
  end
end
