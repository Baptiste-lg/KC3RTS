# KC3RTS

A small browser RTS prototype built with Elixir, Phoenix, TypeScript and
Three.js. The world is rendered in 3D with an isometric camera. Villagers are
2D sprites drawn from code and always face the camera. The initial gameplay is
deliberately small: a town center, villagers, randomly scattered resources,
gathering and delivery.

No art assets are required. Terrain, buildings, resource nodes and villager
sprites are generated mathematically or drawn into a canvas at runtime.

## Project status

This repository is at the implementation start. See [PLAN.md](PLAN.md) for the
architecture, milestones and acceptance criteria.

## Architecture

- `server/`: authoritative Elixir simulation and Phoenix WebSocket endpoint.
- `web/`: TypeScript client, Vite development server and Three.js renderer.
- KC3 is an external service, not a vendored dependency. The first prototype
  can run without it; a versioned checkpoint adapter will be added after the
  local game loop is playable.
- Rust is reserved for operations shown by profiling to exceed the simulation
  tick budget.

## Requirements

- Elixir 1.20 and Erlang/OTP 28 (or compatible newer versions).
- Node.js 22 or newer and npm.

## Development

Setup and run instructions will be completed with the first playable vertical
slice. Quality commands are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
