defmodule KC3RTS.Game.KC3ContentTest do
  use ExUnit.Case, async: false

  @moduletag skip: is_nil(System.get_env("KC3RTS_KC3S"))
  @root Path.expand("../../../..", __DIR__)

  for suite <- ~w(primitives content) do
    @tag timeout: 120_000
    test "KC3 #{suite} contracts" do
      binary = System.fetch_env!("KC3RTS_KC3S") |> Path.expand()
      script = Path.join(@root, "kc3/tests/#{unquote(suite)}.kc3")

      {output, status} =
        System.cmd(binary, ["--load", script, "--quit"],
          cd: Path.dirname(Path.dirname(binary)),
          stderr_to_stdout: true
        )

      assert status == 0, output
      assert output =~ "PASS:"
      refute output =~ "FAIL:"
      refute output =~ "env_"
    end
  end

  test "committed browser catalog matches KC3 and its SHA256" do
    {output, status} =
      System.cmd("sh", [Path.join(@root, "scripts/export-content.sh"), "--check"])

    assert status == 0, output
    encoded = File.read!(Path.join(@root, "web/src/game/generated/catalog.json"))
    assert %{"content_hash" => hash, "catalog" => catalog} = Jason.decode!(encoded)
    # Export places canonical catalog first, so verify its exact bytes independently.
    [_, canonical, ^hash] =
      Regex.run(~r/^\{"catalog":(.*),"content_hash":"([a-f0-9]{64})"\}\n$/, encoded)

    assert Base.encode16(:crypto.hash(:sha256, canonical), case: :lower) == hash
    assert catalog["schema_version"] == 1
  end
end
