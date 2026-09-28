defmodule KC3RTS.Game.Snapshot do
  @moduledoc "Versioned browser payload for the RTS simulation."
  alias KC3RTS.Game.World
  @spec from_world(World.t()) :: map()
  def from_world(%World{} = world) do
    %{
      protocol_version: 3,
      seed: world.seed,
      tick: world.tick,
      map_radius: world.map_radius,
      stockpile: world.stockpile,
      outcome: Atom.to_string(world.outcome),
      resources:
        Enum.map(world.resources, &Map.update!(&1, :kind, fn kind -> Atom.to_string(kind) end)),
      buildings:
        Enum.map(world.buildings, &Map.update!(&1, :owner, fn owner -> Atom.to_string(owner) end)),
      villagers:
        Enum.map(world.villagers, fn v ->
          v
          |> Map.update!(:cargo_kind, fn
            nil -> nil
            kind -> Atom.to_string(kind)
          end)
          |> Map.update!(:order, &order_payload/1)
        end)
    }
  end

  defp order_payload(nil), do: nil
  defp order_payload({:move, point}), do: Map.put(point, :kind, "move")
  defp order_payload({kind, id}), do: %{kind: Atom.to_string(kind), id: id}
end
