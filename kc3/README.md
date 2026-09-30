# Experimental KC3 boundary

The network game and static Pages build still use their legacy simulations.
This worker is the P01 foundation; browser integration follows separately.
It uses the pinned runtime installed by `sh scripts/setup-kc3.sh`.

## Content

Author trusted definitions in `content/core.kc3`. Stable, namespaced definition
IDs differ from integer entity IDs. Resource balances and recipe costs are
maps keyed by resource ID. Templates use shallow `Map.merge` overrides.
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

## Worker protocol 2 / KC3 ruleset 1 / state schema 1

One persistent process owns one match. Input and output are UTF-8 JSON lines.
Request fields: `protocol_version`, `ruleset_version`, `content_hash`,
`request_id`, `match_id`, `expected_revision`, `operation`.

- `new_match`: `seed` (1–2147483646), `factions` (two catalog IDs).
- `command`: `actor_slot` (1 or 2), `command` with `type: "produce"`,
  `recipe_id`, `entity_id`, integer `x` and `z`.
- `tick`: advance one tick with the current revision.
- `snapshot`: read without requiring the current revision.

Replies identify the request and include `accepted`, `reason`, `revision`,
`content_hash` and the complete `state` (null before match creation).
Rejected operations leave state unchanged. Revisions advance once per
accepted mutation. Coordinates use 256 integer units per tile; ticks
represent 100 ms. PRNG state uses Park–Miller, multiplier 48271. Outcome is
explicitly `ongoing` until victory rules are implemented.

The boundary scenario has two factions with shared mechanics, one hall,
five workers and one scout each. Recruitment is immediate, preserving the
old spike's behavior; construction advances on ticks. Production queues,
gathering, faction bonuses, movement, combat and tribe transactions are
later packages. Placeholder art keys do not claim finished pixel assets.

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

Run `kc3/benchmark.kc3` with the same binary/library environment and
`--load kc3/benchmark.kc3 --quit` to measure 1000 Facts queries and 100
14-entity ticks including canonical serialization. Results describe the
current machine, not a multiplayer capacity guarantee.

Runtime details covered by regressions: integer promotion; `!` grouping;
`List.find_if` returning callback values; explicit script termination;
module loading from another working directory; Unicode/control escaping;
list serialization; canonical hashing. The pinned native JSON writer cannot
serialize lists, so `rts/wire.kc3` supplies a small integer-only encoder with
a native fast check for strings needing escapes. Native `.kc3c` parse caches
are ignored by Git. The pin emits a diagnostic to stderr for long strings;
stdout is reserved for replies.
