# KC3 boundary spike (ruleset 1, protocol 1)

The playable local Phoenix match still runs in Elixir. The Pages preview runs
in TypeScript. `kc3/worker.kc3` is a separately tested gameplay spike and is
not yet wired to `WorldServer`. Do not describe the current playable match as
KC3 backed.

## Proven interface

`scripts/setup-kc3.sh` pins `kc3-lang/kc3` to commit
`4bdffa88b35a496ca0a856a9eb58486cf6e2029c`, checks out its pinned
submodules, and builds `kc3s` and JSON into ignored `.toolchain/kc3`. CI runs
the same setup. KC3 upstream is a prototype; its commit and native ABI are
locked together. Packaging must include upstream license notices.

Phoenix starts one `kc3s --load kc3/worker.kc3` process for one match through
`KC3Worker` and sends UTF-8 JSON lines. The script opens `/dev/stdin` using
KC3's `buf_fd_open_r` and writes one JSON reply per line to stdout. This
explicit descriptor is necessary because `kc3s --load` temporarily binds its
normal input buffer to the script file. A `cat` pipe prototype was rejected:
the interpreter and `cat` could compete for stdin and hang a persistent port.
KC3's JSON writer formats maps across lines, so the script removes its raw
presentation newlines after JSON serialization. Escaped newlines inside JSON
strings remain escaped.

Every request contains `protocol_version: 1`, `ruleset_version: 1`, a positive
`request_id`, `match_id`, `expected_revision`, and `operation`. `new_match`
also includes `seed`; `command` includes `actor_slot` and `command`. The
worker replies with the same versions and request ID, `accepted`, `reason`,
`revision`, and `state`. `snapshot` reads state without changing revision.
Accepted recruit, build and tick requests each increase revision by one. Rejected
requests leave it unchanged. A command with a stale expected revision is
rejected. Elixir bounds request size to 4096 bytes and output lines to 64000
bytes. Only one call may be pending per worker.

KC3 currently owns a bounded economy rule: opening wood/stone/gold and worker
count, the 5 wood + 5 gold recruitment cost, the 25 wood + 15 stone center
reservation, a center site and builder check, construction progress over 100
ticks, actor slot check, and tick/revision advance. A finished center can
recruit. The integration tests exercise create, valid and rejected commands,
construction, 100 ticks, snapshot, timeout, failure, and restart.
Stopping or replacing the KC3 process makes that test fail; there is no
fallback to Elixir for this spike. `WorldServer` must not use this incomplete
rule worker for normal gameplay yet. The KC3 construction test does not model
worker travel, resources near the site, unit hitboxes or map generation; these
remain necessary before connecting it to the playable game.

From the repository root after `sh scripts/setup-kc3.sh`, this trace shows KC3
change wood/gold from 30/20 to 25/15 and workers from 3 to 4:

```sh
printf '%s\n' \
  '{"protocol_version":1,"ruleset_version":1,"request_id":1,"match_id":"demo","expected_revision":0,"operation":"new_match","seed":12345}' \
  '{"protocol_version":1,"ruleset_version":1,"request_id":2,"match_id":"demo","expected_revision":1,"operation":"command","actor_slot":1,"command":{"type":"spawn_villager","building_id":1}}' \
  | .toolchain/kc3/kc3s/kc3s --load kc3/worker.kc3
```

The process contract is **fail closed**: timeout, malformed reply, oversized
reply, or worker exit stops the adapter. The match cannot silently switch
rules. The present spike does not restore state after a crash. Before routing
Phoenix gameplay through KC3, add replay/checkpoints, recovery tests, one
writer scheduling, command acknowledgments, and player-specific views.

## Migration boundary

```text
Browser intent → Phoenix session / match routing → KC3 rules and state
                                             ↘ Phoenix authorized view → browser
```

The long-term state needs deterministic IDs, integer ticks, explicit seeded
RNG, terrain, resources, ownership, queues, combat and outcome. Use KC3 facts
for a game relationship only after the query and cost are demonstrated. The
current worker does not yet use facts or reproduce the legacy world. Five
full-state Elixir/TypeScript fixtures in `fixtures/parity_v3.json` protect the
old simulation while rules migrate.
