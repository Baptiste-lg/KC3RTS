# KC3RTS

A small browser RTS prototype built with Elixir, Phoenix, TypeScript and
Three.js. The world is rendered in 3D with an isometric camera. Villagers are
2D sprites drawn from code and always face the camera. The initial gameplay is
deliberately small: a town center, villagers, randomly scattered resources,
gathering and delivery.

No art assets are required. Terrain, buildings, resource nodes and villager
sprites are generated mathematically or drawn into a canvas at runtime.

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

Use the button or **B** to recruit a villager for 5 resources. Villagers choose
resource nodes, gather up to 5 units and deliver them to the town center on
their own. Drag or use **WASD**/arrow keys to move the camera; use the mouse
wheel to zoom. The map and resource placement are deterministic for the server
seed, and the simulation advances at 10 ticks per second.

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
```

The browser smoke command starts both services and headless Chrome, then checks
the live WebGL scene, WebSocket connection, recruitment and delivery. Chrome or
Chromium is required for this command; set `KC3RTS_CHROME` to its executable if
it is outside the common system paths.

## Architecture

- `server/`: authoritative Elixir simulation and Phoenix WebSocket endpoint.
- `web/`: TypeScript client, Vite development server and Three.js renderer.
- KC3 is an external service, not a vendored dependency. The current game runs
  without KC3. A future adapter can store versioned checkpoints through its
  HTTP API while the live simulation stays in the supervised Elixir process.
- Rust is reserved for operations shown by profiling to exceed the simulation
  tick budget.

The initial `game:lobby` is a shared local prototype without accounts or saved
games. For a production deployment, serve `web/dist` and proxy `/socket` to the
Phoenix endpoint on the same origin. See [PLAN.md](PLAN.md) for next milestones.

## License

MIT. See [LICENSE](LICENSE).
