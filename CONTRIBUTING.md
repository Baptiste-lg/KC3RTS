# Contributing

## Development principles

- Keep simulation rules deterministic and independent from Phoenix and the
  renderer.
- Follow test-driven development: add a failing regression or behavior test
  before implementing a feature.
- Keep Phoenix matches authoritative on the server. The static Pages build
  contains an isolated solo simulation; keep its gameplay rules in sync with
  the server and test complete seeded replay results in `fixtures/parity_v3.json`.
- Migrate gameplay rules into the pinned KC3 worker in reviewable steps. Keep
  the legacy Phoenix and Pages paths labelled honestly until the network game
  actually runs through KC3. Run `sh scripts/setup-kc3.sh` and set
  `KC3RTS_KC3S=../.toolchain/kc3/kc3s/kc3s` from `server/` to include KC3
  integration tests.
- Replay fixtures can be regenerated with
  `cd server && MIX_ENV=test mix run scripts/generate_parity.exs`; review each
  complete-state diff before accepting a changed rule.
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
npm run smoke
npm run smoke:pages
```

`npm run smoke` launches Phoenix, Vite and headless Chrome. `npm run smoke:pages`
checks the static Pages build without Phoenix. Both require Chrome/Chromium;
set `KC3RTS_CHROME` if the browser is not at a standard path. CI runs these
same checks on pull requests and pushes to `main`, then publishes Pages only
after all checks pass on `main`. Keep commits focused and use `[ADD]` or `[FIX]`
followed by a short description.
