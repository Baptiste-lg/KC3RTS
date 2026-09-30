defmodule KC3RTS.Game.KC3ContentTest do
  use ExUnit.Case, async: false
  alias KC3RTS.Game.KC3Protocol
  alias KC3RTS.KC3Boundary

  @moduletag skip: is_nil(System.get_env("KC3RTS_KC3S"))
  @root Path.expand("../../../..", __DIR__)

  for suite <- ~w(primitives content world navigation) do
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

  test "maximum entity state serializes in KC3 and passes complete reply validation" do
    binary = System.fetch_env!("KC3RTS_KC3S") |> Path.expand()

    {encoded, status} =
      System.cmd(binary, ["--load", Path.join(@root, "kc3/tests/scale.kc3"), "--quit"],
        cd: Path.dirname(Path.dirname(binary))
      )

    assert status == 0
    assert byte_size(encoded) < 262_144

    assert {:ok, reply} =
             KC3Protocol.decode_reply(
               encoded,
               KC3Boundary.request(1, "new_match"),
               nil
             )

    assert length(reply["state"]["entities"]) == 512
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
    assert catalog["schema_version"] == 2
  end
end
