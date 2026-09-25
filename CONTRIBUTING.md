# Contributing

## Development principles

- Keep simulation rules deterministic and independent from Phoenix and the
  renderer.
- Follow test-driven development: add a failing regression or behavior test
  before implementing a feature.
- Keep all simulation decisions on the server. Treat browser commands as
  untrusted input.
- Add Rust only after profiling demonstrates a specific hot path and include a
  benchmark that justifies the boundary.
- Keep generated visuals procedural; do not add external art files without
  updating the project direction and license notes.

## Local quality checks

Run the same checks as CI before opening a pull request:

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
```

The repository CI runs these checks on pull requests and pushes to `main`.
Keep commits focused and use `[ADD]` or `[FIX]` followed by a short description.
