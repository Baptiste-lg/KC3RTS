defmodule KC3RTS.Game.ParityFixtureTest do
  use ExUnit.Case, async: true
  alias KC3RTS.Game.ParityFixture

  test "server replays all golden scenarios without changing canonical state" do
    golden = ParityFixture.golden_path() |> File.read!() |> Jason.decode!()
    assert golden["version"] == 3

    expected = Map.new(golden["scenarios"], &{&1["name"], &1})

    for scenario <- ParityFixture.scenarios() do
      assert ParityFixture.replay(scenario) == expected[scenario["name"]]
    end
  end
end
