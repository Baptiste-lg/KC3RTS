# KC3 economy and navigation field trial

Install the pinned runtime with `sh scripts/setup-kc3.sh`, start Phoenix with
`cd server && mix run --no-halt`, and start Vite with `cd web && npm run dev`
in another terminal. Open `http://127.0.0.1:5173/?mode=kc3`.

KC3 owns movement, gathering, delivery, construction, repair, production,
population and refunds. Phoenix owns guest identity, transport, sequencing
and process lifetime. The default network game and static Pages build still
use the legacy simulation. Combat, army-scale performance and the default KC3 cutover
remain subsequent packages. A failed worker makes the trial unavailable.

## Playing the economy slice

- Select workers, then right click berries, wood, stone or gold. Workers carry
  up to their catalog capacity, return to reachable compatible storage, and
  seek another node of the same resource after depletion. Stop retains cargo.
- Select a worker and choose a building in the command grid, then click a
  site. Cost is paid on placement; nearby assigned builders provide progress.
  Right click unfinished buildings to resume work or damaged buildings to
  repair them. A completed farm supports one assigned worker at a time.
- Select a hall, barracks or range to queue its units. Entries display remaining
  simulation time; click an entry to cancel. Right click ground to set rally.
- Population shows living units + paid reservations / completed capacity.
  A hall supplies 10, a house 5, up to 60. Lost capacity preserves existing
  units; completed queued units wait for capacity and a clear exit.

Both factions start with one hall, five workers, one scout, 200 food, 200 wood,
50 stone and 50 gold. A worker costs 50 food and takes 150 ticks. The simulation
uses ten ticks per second. All recipe costs, durations, cargo, storage, farm
rates, queue sizes and policy values come from the KC3 catalog.

Unstarted queue entries refund 100%; started entries refund 50%, rounded down
per resource. Construction refunds 75% of its unbuilt cost, rounded down.
Destruction refunds nothing. A refund that would overflow stocks is rejected;
delivery overflow stays in cargo. Worker repair pays its catalog repair cost
per repair interval, with HP clamped to the target maximum.

## Content

Author trusted definitions in `content/core.kc3`. Namespaced definition IDs
are separate from integer entity, resource-node and job IDs. Stocks, recipe
costs and paid investments are maps keyed by resource ID. Entity capabilities,
footprints, population, supply, cargo, storage and yields drive generic rules.
Faction art resolves through catalog overrides; templates use `Map.merge`.

`rts/content.kc3` validates closed schemas, references, costs, acquisition
methods, prerequisite cycles, bounded effects and coherent capabilities. It
compiles one definition index, resource IDs, policies and a worker-local Facts
database for recipe permissions. The compiled world does not duplicate the
public catalog. Regenerate metadata after editing content:

```sh
sh scripts/export-content.sh
sh scripts/export-content.sh --check
```

The generated browser catalog contains canonical JSON and its SHA256. Phoenix
reads that same file at compilation. Definitions sort by ID; object keys sort;
arrays retain their defined order. Content edits require a server recompile.

`tests/extension.kc3` adds a specialist resource, unit, producer, faction,
technologies, offer, effect and tribe. The economy suite also harvests and
delivers a new ordinary resource using only catalog and node data. These packs
are test-only. Tribe trade, technologies and treaty effects are validated data;
their gameplay handlers are future work. The two playable factions currently
share economy mechanics and have distinct visual motifs.

## Worker protocol 2 / KC3 ruleset 4 / state schema 4

Setup builds the small native storage/JSON bridge and preloads project modules.
After editing KC3 sources, run `kc3/preload.kc3` with the pinned interpreter
before starting matches: cold parsing can exceed the initialization budget on
the development host. Worker initialization has a 90-second budget; active match requests
retain their two-second limit. One persistent worker owns one match. Input and output are UTF-8 JSON lines.
Every request contains `protocol_version`, `ruleset_version`, `content_hash`,
`request_id`, `match_id`, `expected_revision` and `operation`.

- `new_match`: `seed` (1–2147483646), `factions` (two catalog IDs).
- `command`: a trusted `actor_slot` and a closed command payload below.
- `tick`: advance one deterministic step.
- `snapshot`: read without mutation; does not require the current revision.

| Command type | Payload after `type` |
| --- | --- |
| `move` | `entity_ids`, `x`, `z` |
| `stop`, `deliver` | `entity_ids` |
| `gather` | `entity_ids`, `target_kind` (`node`/`farm`), `target_id` |
| `work`, `repair` | `entity_ids`, `target_id` |
| `produce` | `entity_id`, `recipe_id`, `x`, `z` (zero for training) |
| `cancel` | `entity_id`, `queue_id` |
| `cancel_build` | `entity_id` |
| `rally` | `entity_id`, `x`, `z` |

Replies contain request identity, `accepted`, `reason`, `revision`,
`content_hash` and complete `state` (null before creation). Rejections leave
state unchanged. Accepted mutations advance the revision once. Coordinates
use 256 integer units per world unit. PRNG is Park–Miller, multiplier 48271.
Outcome remains `ongoing` until combat and victory rules are implemented.

Browser protocol 6 snapshots retain canonical entities, tasks, paid queues,
cargo, nodes and population, but omit private planner state and route steps.
Revision-linked patches transmit changed fields, additions and removals;
a missing base revision triggers resynchronization. `web/src/game/kc3_view.ts` validates them and
provides a temporary one-way bridge into the existing scene. Context buttons
are generated from faction recipes; the browser does not advance game rules.

The boundary checks IDs, ownership, numeric bounds, references, queue identity,
content hash and revision continuity. One request may be pending; requests
are limited to 4096 bytes and replies to 262144 bytes, excluding newline.
The entity-plus-reservation limit is 512. This is a defensive limit, not a
verified playable army size. Timeout, process exit or malformed output ends
the worker; transport retries retain their original command result.

## Map, timing and pixel scale

The current scenario is a fixed 12×10 field with four-unit cells and finite
resource nodes. Navigation subdivides it into 48×40 one-unit cells and assigns
unique formation destinations to selections of up to 100 units. Two direct
corridors are checked before bounded deterministic A* (128 expansions and at
most eight planning jobs per tick). A BFS comparator remains in the tests.
Cached static occupancy is invalidated by construction, destruction and depletion.
Local footprint reservations prevent overlap. A stalled unit tries another route
after 20 ticks and terminates after 70 ticks without reaching a waypoint;
reaching a waypoint renews that obstruction budget. Stop or replacement discards
an obsolete incremental search. Economy routing chooses reachable approach cells.

P04 remains in progress: collision/arrival checks and the timing budget are
separate acceptance criteria. Supporting 100 selected IDs is not a claim that
100 units currently run at ten ticks per second.

Idle ticks skip occupancy work. Population is refreshed on mutations that
change its ledger: commands, deaths, completed buildings and spawned units.
KC3 catch-up yields after each tick so player commands can be processed between
native round trips. Tick durations describe simulation time; overloaded hosts
can run slower than real time.

`web/src/scene/pixel_art.ts` owns the shared palette and eight source pixels
per world unit. Units use 24×24 frames, halls 64×64, outbuildings 40×40, trees
32×48, ore 32×32 and berries 32×24. Nearest filtering and disabled antialiasing
preserve edges. Buildings keep pixel proportions while under construction.
Copper/teal kiln dwarves and indigo lantern mages have authored silhouettes;
team markings remain separate from faction motifs. The default camera is 30°;
`?angle=steep` selects 40° and `?zoom=tactical` selects 0.7×. Animation atlases,
foot sorting, occlusion handling and the full HUD redesign remain P06.

## Verification and measurement

```sh
cd server
KC3RTS_KC3S=../.toolchain/kc3/kc3s/kc3s \
LD_LIBRARY_PATH=../.toolchain/kc3/libkc3:../.toolchain/kc3/lib/kc3/0.1 \
mix test --cover
```

Native suites cover catalog extension, deterministic navigation, depletion,
cargo, farms, construction interruption, repair, queue limits, blocked exits,
population loss and exact refunds. Phoenix tests additionally exercise real
ports, malformed messages, retries, channel identity and worker failure.

For the army-scale scenarios, run the same environment with
`mix test test/kc3_rts/game/kc3_navigation_test.exs --seed 0` without other
heavy work. The 50/100-unit cases measure command acknowledgement, p95/p99
tick round trips (including worker transport and validation), maximum browser
patch size, exact final destinations and collision at every tick. Six additional
scenes cover a hall, corridor, opposing groups, a new building, depletion and
a larger convoy unit. Timing is reported, not silently treated as a passing
performance gate: the targets remain p95 <20 ms, p99 <50 ms and ack <200 ms.
`kc3/profile_navigation.kc3` provides phase samples to locate costs; it is not
a substitute for the real-port benchmark.

Development OpenBSD host, 5 October 2026, full integration run with coverage
(`--seed 0`, pinned runtime, no concurrent heavy tests):

| Units | Arrival | Ticks | Ack | Tick p95 / p99 | Largest patch |
| --- | --- | --- | --- | --- | --- |
| 50 | 100% | 184 | 432 ms | 118 / 136 ms | 1365 bytes |
| 100 | 100% | 192 | 1857 ms | 347 / 454 ms | 2352 bytes |

Both cases pass collision, arrival deadline and bandwidth checks, but **fail
the timing targets**. These are development measurements, not supported capacity.

The subsequent P04 optimization keeps orders/entities in shared storage and
uses a derived KC3 Facts spatial index. Its single worker-local cache entry is
consumed before mutation and reused only for an identical entity list/layout;
it is never serialized. Six baseline scene hashes check every canonical tick,
alongside footprint, collision, cache invalidation and restoration tests.

Run `mix run scripts/benchmark_navigation.exs` from `server` with the same
runtime environment for an isolated real-port measurement without coverage.
`KC3RTS_BENCH_ROOT` and `KC3RTS_BENCH_LABEL` can identify a frozen source tree;
the label should identify uncommitted changes when measuring a dirty checkout.
`KC3RTS_BENCH_TIMEOUT_MS` optionally extends diagnostic headroom only, not the
production timeout. Run without concurrent heavy tests.

Isolated optimized working-tree measurement on the same OpenBSD host,
5 October 2026 (not a controlled A/B comparison with the coverage run above):

| Units | Arrival | Ticks | Ack | Tick p95 / p99 | Largest patch |
| --- | --- | --- | --- | --- | --- |
| 50 | 100% | 184 | 72 ms | 63 / 92 ms | 1365 bytes |
| 100 | 100% | 192 | 189 ms | 128 / 170 ms | 2352 bytes |

Both cases remain below the production two-second timeout, but **P04 remains
in progress**: tail tick latency still exceeds its targets.

`cd web && npm run smoke:kc3` exercises visible selection, group recall,
move/stop, queueing, cancellation, food delivery, worker spawn and house
completion through the browser→Phoenix→KC3 path. `KC3RTS_SMOKE_SCREENSHOT`
saves the final view; `KC3RTS_OPENING_SCREENSHOT` saves the opening.
`npm run smoke` and `npm run smoke:pages` check legacy compatibility.

Run `kc3/benchmark.kc3` with the pinned interpreter and library environment:
`--load kc3/benchmark.kc3 --quit`. It reports 1000 Facts queries, a six-unit
route, and 100 ticks each of idle, moving and gathering-with-production states.
Tick and JSON encoding times are reported separately. Run without other heavy
tests. These small scenarios do not establish multiplayer or army capacity.
An isolated P03 run on the development OpenBSD host measured:

| Scenario (14 entities, 100 ticks) | Mean tick | Mean JSON encoding |
| --- | --- | --- |
| Idle | 12.1 ms | 38.7 ms |
| Six units moving | 93.5 ms | 55.4 ms |
| One gatherer plus one paid queue | 48.2 ms | 52.2 ms |

The group route took 218 ms. Active cases consume or exceed the 100 ms budget;
P04 must reduce routing/occupancy and serialization cost before adding armies.
A worker launched from an uncached source copy took 43.6 seconds to initialize.

Runtime regressions cover integer promotion, boolean grouping, callback-valued
`List.find_if`, canonical hashing, UTF-8/control escaping, list serialization
and loading from another working directory. Loaders receive the entrypoint
root explicitly so parse caches cannot retain a caller's path. The pinned
native JSON writer lacks List support; `native/data.c` supplies the bounded,
integer-only encoder and immutable Map/`RTS.Shared` access primitives through
`rts/data.kc3` and `rts/wire.kc3`. Shared storage is internal: serialized and
restored worlds keep identical canonical values. Gameplay decisions remain in
KC3. Generated `.kc3c` parse caches are ignored. The pin logs long-string
diagnostics to stderr; stdout is reserved for replies.
