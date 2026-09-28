# KC3RTS implementation plan

## Current playable slice (2026-09-28)

KC3RTS is a browser RTS prototype with one building type: the town center.
Each match starts with one center, three villagers, procedurally placed wood,
stone and gold, and an enemy base at a random seeded position. The resource
layout has a starter grove, three large forests and five smaller groves, with
104 trees, 8 stone deposits and 6 gold deposits. Each tree holds 160 wood,
each stone deposit 480 stone and each gold deposit 520 gold. The enemy has
250 HP but no AI. The player selects villagers, orders movement, gathering,
construction and attacks, recruits at completed centers and wins by destroying
the enemy base. Villagers have 30 HP; centers have 350 HP. There is no opposing
army yet.

The browser uses Three.js for the isometric map and generated geometry. The
Phoenix server owns authoritative matches in development and can receive the
same command set as the static solo simulation used on GitHub Pages. The
snapshot protocol is version 2 and contains resources, buildings, villagers,
orders, hit points, stockpiles and outcome.

## Next work

1. Add pathfinding and unit collision around buildings and resource nodes.
2. Add a combat unit and an opponent simulation, with balancing and defeat
   conditions. Keep the current passive enemy as a useful test scenario.
3. Add save and restore through a versioned KC3 adapter. The live simulation
   should remain in the supervised Elixir process.
4. Profile growing maps and unit counts before adding Rust or a spatial index.
5. Add multiplayer match ownership and authentication before exposing shared
   matches beyond the local prototype.

## Quality gate

Run `mix format --check-formatted`, `mix credo --strict`, `mix test`,
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run smoke`, and `npm run smoke:pages`. The browser checks exercise WebGL,
initial RTS state, recruitment and player ordered resource delivery in both
Phoenix and solo modes.
