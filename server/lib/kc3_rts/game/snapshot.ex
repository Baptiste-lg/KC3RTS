defmodule KC3RTS.Game.Snapshot do
  @moduledoc "Converts internal simulation state into a versioned browser-safe payload."

  alias KC3RTS.Game.World

  @protocol_version 1

  @spec from_world(World.t()) :: map()
  def from_world(%World{} = world) do
    %{
      protocol_version: @protocol_version,
      tick: world.tick,
      map_radius: world.map_radius,
      town_center: world.town_center,
      stockpile: world.stockpile,
      resources:
        Enum.map(world.resources, fn resource ->
          Map.take(resource, [:id, :x, :z, :amount, :initial_amount])
        end),
      villagers:
        Enum.map(world.villagers, fn villager ->
          villager
          |> Map.take([:id, :x, :z, :cargo, :target])
          |> Map.update!(:target, &target_payload/1)
        end)
    }
  end

  defp target_payload(nil), do: nil
  defp target_payload(:town_center), do: %{kind: "town_center"}
  defp target_payload({:resource, id}), do: %{kind: "resource", id: id}
end
