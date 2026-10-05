defmodule KC3RTS.Game.Snapshot do
  @moduledoc "Versioned browser payload for the RTS simulation."
  alias KC3RTS.Game.World
  # Full development view; visibility filtering is introduced before multiplayer.
  def from_world(%KC3RTS.Game.KC3Match{state: state}) do
    state
    |> Map.drop(["navigation"])
    |> Map.update!(
      "entities",
      fn entities ->
        Enum.map(entities, fn entity -> Map.update!(entity, "order", &public_order/1) end)
      end
    )
    |> Map.merge(%{"protocol_version" => 6, "ruleset_version" => 4, "viewer_slot" => 1})
  end

  @spec from_world(World.t()) :: map()
  def from_world(%World{} = world) do
    %{
      protocol_version: 3,
      ruleset_version: 2,
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

  def patch(before, current) do
    %{
      protocol_version: 6,
      ruleset_version: 4,
      content_hash: current["content_hash"],
      base_revision: before["revision"],
      revision: current["revision"],
      tick: current["tick"],
      next_entity_id: current["next_entity_id"],
      next_job_id: current["next_job_id"],
      players: changed(before["players"], current["players"]),
      outcome: changed(before["outcome"], current["outcome"]),
      entities: row_changes(before["entities"], current["entities"]),
      nodes: row_changes(before["nodes"], current["nodes"])
    }
  end

  defp changed(before, current), do: if(before == current, do: nil, else: current)

  defp row_changes(before, current) do
    previous = Map.new(before, &{&1["id"], &1})
    ids = MapSet.new(current, & &1["id"])

    upsert =
      Enum.flat_map(current, fn row ->
        case Map.get(previous, row["id"]) do
          ^row ->
            []

          nil ->
            [row]

          old ->
            [
              row
              |> Map.reject(fn {key, value} -> old[key] == value end)
              |> Map.put("id", row["id"])
            ]
        end
      end)

    %{
      upsert: upsert,
      remove: for(row <- before, not MapSet.member?(ids, row["id"]), do: row["id"])
    }
  end

  defp public_order(nil), do: nil
  defp public_order(order), do: Map.take(order, ["kind", "goal"])

  defp order_payload(nil), do: nil
  defp order_payload({:move, point}), do: Map.put(point, :kind, "move")
  defp order_payload({kind, id}), do: %{kind: Atom.to_string(kind), id: id}
end
