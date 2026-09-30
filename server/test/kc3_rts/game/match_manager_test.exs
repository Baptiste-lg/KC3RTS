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
