defmodule KC3RTS.KC3Boundary do
  @moduledoc false
  @catalog Path.expand("../../../web/src/game/generated/catalog.json", __DIR__)
  @document @catalog |> File.read!() |> Jason.decode!()

  def request(id, operation, revision \\ 0) do
    %{
      "protocol_version" => 2,
      "ruleset_version" => 1,
      "request_id" => id,
      "content_hash" => @document["content_hash"],
      "match_id" => "port-test",
      "expected_revision" => revision,
      "operation" => operation
    }
    |> extras(operation)
  end

  def command(id, revision, recipe \\ "core.train_worker", entity \\ 1, slot \\ 1) do
    request(id, "command", revision)
    |> Map.merge(%{
      "actor_slot" => slot,
      "command" => %{
        "type" => "produce",
        "recipe_id" => recipe,
        "entity_id" => entity,
        "x" => 0,
        "z" => 0
      }
    })
  end

  defp extras(request, "new_match"),
    do: Map.merge(request, %{"seed" => 1234, "factions" => ["kiln.concord", "lantern.synod"]})

  defp extras(request, _), do: request
end
