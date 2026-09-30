alias KC3RTS.Game.ParityFixture

golden = %{
  "version" => 4,
  "source" => "Elixir prototype World + Snapshot; compare every field in browser preview",
  "scenarios" => Enum.map(ParityFixture.scenarios(), &ParityFixture.replay/1)
}

File.write!(ParityFixture.golden_path(), Jason.encode!(golden, pretty: true) <> "\n")
IO.puts("Wrote #{ParityFixture.golden_path()}")
