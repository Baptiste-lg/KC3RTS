# KC3 field trial

Install the pinned runtime with `sh scripts/setup-kc3.sh`, start Phoenix with
`cd server && mix run --no-halt`, and start Vite with `cd web && npm run dev`
in another terminal. Open `http://127.0.0.1:5173/?mode=kc3`.

The field trial runs move/stop orders and integer simulation ticks in KC3.
Phoenix owns guest identity, transport, request sequencing and process lifetime.
The default network game and static Pages build retain the legacy simulation
until the economy and combat migrations are complete. A missing or failed KC3
worker makes the field trial unavailable; it never switches simulation engines.

## Content

Author trusted definitions in `content/core.kc3`. Stable, namespaced definition
IDs differ from integer entity IDs. Resource balances and recipe costs are
maps keyed by resource ID. Unit speed and footprint are catalog integers;
faction art keys resolve through catalog overrides. Templates use shallow
`Map.merge` overrides.
`rts/content.kc3` validates closed schemas, references, costs, acquisition
methods, prerequisite cycles, bounded effects and faction overrides. It
builds immutable lookups and a worker-local Facts database for recipe rights.
Unsupported mechanics require a new KC3 handler and tests.

Generate browser metadata with:

```sh
sh scripts/export-content.sh
sh scripts/export-content.sh --check
```

The second command runs in CI. `web/src/game/generated/catalog.json` contains
canonical JSON and its SHA256. The Elixir boundary reads that same generated
file at compilation, without maintaining another gameplay table. Changing
content requires regeneration and server recompilation. Definitions are
sorted by ID; object keys are sorted, arrays retain their defined order.

`tests/extension.kc3` adds a specialist resource, unit, production building,
faction, technologies, offer, effect and tribe. It is never loaded by the
production worker. Trade acquisition and treaty effect execution remain
future work; this package validates and exports their data only.

## Worker protocol 2 / KC3 ruleset 2 / state schema 2

One persistent process owns one match. Input and output are UTF-8 JSON lines.
Request fields: `protocol_version`, `ruleset_version`, `content_hash`,
`request_id`, `match_id`, `expected_revision`, `operation`.

- `new_match`: `seed` (1–2147483646), `factions` (two catalog IDs).
- `command`: `actor_slot` (1 or 2), `command` with `type: "produce"`,
  `recipe_id`, `entity_id`, integer `x` and `z`; or `type: "move"`,
  `entity_ids`, integer `x`, `z`; or `type: "stop"`, `entity_ids`.
  Phoenix supplies the guest's slot; browser commands cannot choose it.
- `tick`: advance one tick with the current revision.
- `snapshot`: read without requiring the current revision.

Replies identify the request and include `accepted`, `reason`, `revision`,
`content_hash` and the complete `state` (null before match creation).
Rejected operations leave state unchanged. Revisions advance once per
accepted mutation. Coordinates use 256 integer units per tile; ticks
represent 100 ms. PRNG state uses Park–Miller, multiplier 48271. Outcome is
explicitly `ongoing` until victory rules are implemented.

The development scenario has two factions with shared mechanics, one hall,
five workers and one scout each, on a 12×10 obstacle grid. Move commands
accept 1–16 owned mobile entities atomically. One reverse breadth-first field
serves a group; stable IDs assign lanes through the cells. Targets currently
snap to a cell, with integer axis steps and stop clearing orders immediately.
This bounded route implementation is for the first playable slice. Local
avoidance, larger armies and terrain generation belong to P04.

The browser receives protocol 4 full snapshots, validates the catalog hash,
and renders generic entities through a temporary one-way presentation bridge
in `web/src/game/kc3_view.ts`. Selection, drag selection, control groups, camera
and minimap stay available. Production exists only at the native boundary;
its recruitment is still immediate. The field trial deliberately exposes only
move and stop. Queues, gathering, faction rules, combat and tribe transactions
remain later packages.

## Pixel scale

`web/src/scene/pixel_art.ts` owns the shared palette and the scale of eight
source pixels per world unit. Units use 24×24 frames, halls 64×64, trees 32×48
and ore 32×32. Nearest filtering, disabled antialiasing and a fixed render
pixel ratio preserve edges. Copper/teal kiln workers and indigo lantern mages
have authored silhouettes; team markings remain separate from faction motifs.
The default camera elevation is 30° (the 2:1 ground projection), with `?angle=steep` selecting 40° for
comparison and `?zoom=tactical` selecting 0.7×. Camera snapping, animation
sets and the full HUD redesign remain P06.

The adapter checks every state field, content references, canonical ID order,
ownership slots, resource caps and revision continuity. It permits one
pending request, limits requests to 4096 bytes and replies to 262144 bytes
(excluding newline), and stops on timeout, process exit or malformed output.
The current scenario caps entities at 512. These are versioned boundary
limits, not per-resource or per-faction switch statements.

## Verification and measurement

```sh
cd server
KC3RTS_KC3S=../.toolchain/kc3/kc3s/kc3s \
LD_LIBRARY_PATH=../.toolchain/kc3/libkc3:../.toolchain/kc3/lib/kc3/0.1 \
mix test --cover
```

`cd web && npm run smoke:kc3` exercises the real browser→Phoenix→KC3 path:
selection, control-group recall, movement, stop and continued ticks.
`KC3RTS_OPENING_SCREENSHOT=/tmp/opening.png npm run smoke:kc3 -- --capture`
saves the opening without replaying commands; `KC3RTS_ANGLE=steep` and
`KC3RTS_ZOOM=tactical` select the comparison views.

Run `kc3/benchmark.kc3` with the same binary/library environment and
`--load kc3/benchmark.kc3 --quit` to measure 1000 Facts queries and 100
14-entity ticks including canonical serialization, plus a six-unit route. On the development OpenBSD host, one isolated run measured 157 ms for the
six-unit route and 54.8 ms per tick plus encoding (100 ticks, 14 entities).
This leaves little capacity for armies; route scheduling, snapshot frequency
and encoding need profiling before increasing the scenario limits in P04.
These measurements do not establish multiplayer capacity.

Runtime details covered by regressions: integer promotion; `!` grouping;
`List.find_if` returning callback values; explicit script termination;
module loading from another working directory (loader functions receive the
entrypoint root at runtime so parse caches cannot retain the caller's path); Unicode/control escaping;
list serialization; canonical hashing. The pinned native JSON writer cannot
serialize lists, so `rts/wire.kc3` supplies a small integer-only encoder with
a native fast check for strings needing escapes. Native `.kc3c` parse caches
are ignored by Git. The pin emits a diagnostic to stderr for long strings;
stdout is reserved for replies.
