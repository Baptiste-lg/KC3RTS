defmodule KC3RTS.MixProject do
  use Mix.Project

  def project do
    [
      app: :kc3_rts,
      version: "0.1.0",
      elixir: "~> 1.20",
      start_permanent: Mix.env() == :prod,
      elixirc_paths: elixirc_paths(Mix.env()),
      test_coverage: [summary: [threshold: 70]],
      deps: deps()
    ]
  end

  def application do
    [extra_applications: [:logger], mod: {KC3RTS.Application, []}]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_env), do: ["lib"]

  defp deps do
    [
      {:bandit, "~> 1.6"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:jason, "~> 1.4"},
      {:phoenix, "~> 1.8.0"}
    ]
  end
end
