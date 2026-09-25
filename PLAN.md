# KC3RTS implementation plan

## Product slice

A browser-playable, single-player RTS prototype. The first map is a small, empty
3D field viewed with an orthographic isometric camera. The town center is the
only building. It spawns villagers; procedural billboard villagers find
procedurally placed resource nodes, gather, and return resources to the center.
All visual geometry and sprite pixels are generated at runtime. There are no
downloaded art assets.

## Architecture decisions

- **Browser:** TypeScript, Vite, Three.js. Three.js owns the 3D field, camera,
  grid, simple geometric structures and resource nodes. Villagers use
  `THREE.Sprite` with a generated `CanvasTexture`, so they remain camera-facing.
- **Game server:** Elixir/OTP and Phoenix Channels. A supervised game process is
  authoritative for each active match. Simulation rules are pure Elixir
  functions and advance on a fixed server tick. Phoenix sends snapshots and
  accepts validated commands.
- **Persistence:** KC3 is not vendored or copied into this repository. The
  initial playable slice runs without KC3. A later `KC3Client` boundary will
  store accounts, match metadata and periodic snapshots through KC3's internal
  HTTP/JSON API. Active simulation state stays in the game process and is
  checkpointed in batches.
- **Rust:** no Rust code in the initial slice. Add a Rust worker only after
  profiling identifies a CPU-bound operation that misses the tick budget.
  Prefer a supervised external worker protocol first; consider NIFs only if
  measured message overhead is material.
- **Transport:** Phoenix WebSocket in production; Vite proxies `/socket` to the
  local Phoenix server for development.

## Milestones

1. Repository foundation: license, architecture, formatting/lint/test commands,
   CI, contribution and security guidance.
2. Simulation core: deterministic map generation, town center, resource nodes,
   villager spawning, gather/return behavior and resource stockpile. Write
   ExUnit tests first; keep simulation independent of Phoenix and Three.js.
3. Authoritative server: supervised match process, fixed tick, Phoenix channel,
   command validation and snapshot protocol. Test rules and channel behavior.
4. Browser scene: isometric 3D field, procedural geometry, camera controls,
   billboard villagers and HUD. Add browser-facing tests for projection,
   rendering setup and client protocol.
5. Play loop and polish: spawn controls, live snapshot updates, error states,
   accessibility, keyboard controls and public-facing documentation.
6. KC3 persistence adapter: define versioned payloads, add checkpoint/load
   routes on KC3 and integration tests. KC3 remains an external dependency.
7. Performance gate: profile increasing map/unit sizes. Add Rust only when a
   documented benchmark shows Elixir cannot meet the selected simulation
   budget.

## First-slice acceptance criteria

- `mix test`, `mix format --check-formatted`, `mix credo --strict`,
  `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- A developer can start the app with documented commands and open it in a
  browser without third-party art files.
- The server creates a deterministic map for a supplied seed; resource nodes
  are in bounds and spaced away from the town center.
- A player can spawn villagers; each living villager gathers from a node and
  returns cargo to the town center; the stockpile increases on delivery.
- The browser displays the current map and server state and stays connected
  through Phoenix WebSocket.
- Every completed feature is committed with `[ADD]` or `[FIX]` and a concise
  description. No commit message mentions AI.

## TDD and quality workflow

For each feature, add or update the failing test first, run the narrow test,
implement the smallest useful change, then run the full relevant local quality
commands before committing. CI repeats the same format, lint, test, and build
checks. No auto-commit or auto-fix workflow is used: the author reviews and
commits the changes explicitly.

## Risks and boundaries

- A simulation tick must not block Phoenix schedulers. Keep the first map and
  unit cap small, measure tick duration, and move only proven hot loops to Rust.
- KC3's HTTP server does not currently provide a general WebSocket game API.
  Phoenix owns real-time sockets; KC3 is called internally for durable state.
- Network dependencies may be unavailable in a restricted environment. CI
  caches dependencies, while setup instructions list the required toolchains.
- Networked competitive RTS features (anti-cheat, authoritative reconnection,
  matchmaking and distributed match placement) are outside the first slice.
