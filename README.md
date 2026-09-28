# KC3RTS

A browser RTS prototype built with Elixir, Phoenix, TypeScript and Three.js.
The isometric map starts with a town center and three villagers. Wood, stone
and gold appear as separate resource nodes. You select villagers and give them
orders to move, gather, build another town center or attack a passive enemy base.
Units and buildings have hit points. Destroying the enemy base wins the match.

All terrain, buildings, resources and villager sprites are generated in code.

## Play online

[Play KC3RTS on GitHub Pages](https://baptiste-lg.github.io/KC3RTS/). This is a
solo match simulated in your browser, so it needs no running Phoenix server.
Each visit starts a fresh match; there are no accounts or saved games yet.
Pushes to `main` publish only when all CI checks pass.

## Play locally

Requirements: Elixir 1.20 with Erlang/OTP 28, Node.js 22.12 or newer, and npm.

Start the game server in one terminal:

```sh
cd server
mix deps.get
mix run --no-halt
```

Start the browser client in another terminal:

```sh
cd web
npm ci
npm run dev
```

Open <http://127.0.0.1:5173/>. Vite relays `/socket` and `/health` to the
Phoenix server at `127.0.0.1:4000` during development.

Select villagers with a left click or drag a selection box. Shift-click adds
or removes a villager from the selection; double-click selects all visible
villagers. **Ctrl+A** selects all your villagers. Save a selection with
**Ctrl+1–9**, recall it with **1–9**, and press the number twice to center the
camera on that group. Right-click terrain to move, a
resource to gather, an unfinished town center to build, or the enemy base to
attack. Select a completed town center and press **V** or the recruitment button
to recruit a villager for 5 wood and 5 gold. Select one or more villagers and
press **B** or the construction button, then click free ground to place a town
center for 25 wood and 15 stone. Villagers carry up to 5 units and deliver to
the nearest completed town center. Press **X** to stop selected villagers.
**WASD** or arrow keys pan the camera; the mouse wheel zooms. Click the
mini-map to center the camera elsewhere. The command panel shows the selected
unit's health, current order and cargo. Each new match uses a fresh map seed,
shown in the HUD. The enemy base spawns at a random location and has
250 HP but no AI. There is no opposing army yet.
Add `?quality=low` to the page URL on machines with slow graphics rendering.

## Quality checks

Run the same checks as CI from the repository root:

```sh
cd server
mix format --check-formatted
mix credo --strict
mix test
cd ../web
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:pages
```

The browser smoke command starts both services and headless Chrome, then checks
the live WebGL map, WebSocket connection, recruitment and ordered wood delivery.
Chrome or Chromium is required for both smoke commands; set `KC3RTS_CHROME` to its
executable if it is outside the common system paths. `smoke:pages` builds the
static site at `/KC3RTS/` and checks the solo play loop without Phoenix.

## Architecture

- `server/`: authoritative Elixir simulation and Phoenix WebSocket endpoint.
- `web/`: TypeScript client, Vite development server and Three.js renderer.
- GitHub Pages serves the static browser build with a local deterministic
  simulation. The local development build uses the authoritative Phoenix
  server. The solo build is intended for one visitor per match.
- KC3 is an external service, not a vendored dependency. The current game runs
  without KC3. A future adapter can store versioned checkpoints through its
  HTTP API while the live simulation stays in the supervised Elixir process.
- Rust is reserved for operations shown by profiling to exceed the simulation
  tick budget.

The initial `game:lobby` is a shared local prototype without accounts or saved
games. A later networked deployment can serve the normal `web/dist` and proxy
`/socket` to Phoenix on the same origin. See [PLAN.md](PLAN.md) for next milestones.

## GitHub Pages setup

This repository publishes through **Settings → Pages → Build and deployment →
Source: GitHub Actions**. When copying the workflow to a new repository, select
that source once. The `pages` CI job builds `web/dist` with the `/KC3RTS/` base
path and publishes it after the server, web and both browser checks succeed on a
push to `main`. Pull requests run checks but cannot publish.

## License

MIT. See [LICENSE](LICENSE).
