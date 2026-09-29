# KC3RTS implementation plan

**Current handoff: read the 2026-09-29 audit and roadmap below.** The 2026-09-28
slice and priorities immediately below are preserved as historical context; the
new roadmap supersedes their order, especially the proposed storage-only KC3
adapter. All proposed edits are confined to this repository.
Hosting, remote repository settings, DNS, secrets and publishing are future
steps only if the user later expands the stated scope; prepare and test their
repository artifacts first.

**Implementation update:** [the 2026-09-29 execution record](#i-execution-record-2026-09-29-working-tree)
documents the completed baseline and KC3 transport spike. The playable match
still runs on Elixir or the offline TypeScript preview; Phase 1 migration and
Phases 2–5 remain open.

**Reading path for the next implementer:** start at [audited gaps](#a-audited-inventory-and-gaps),
then [KC3 architecture](#d-architecture-and-kc3-proof),
[ordered phases](#f-ordered-implementation-packages-and-reviewable-commits)
and [verification](#g-quality-and-performance-gates). The first work is a
selection validation regression, cross-runtime fixtures, and a small proven
KC3 game rule. An isolated KC3-backed public solo match comes **before** 1v1.

## Current playable slice (2026-09-28)

KC3RTS is a browser RTS prototype with one building type: the town center.
Each match starts with one center, three villagers, procedurally placed wood,
stone and gold, and an enemy base at a random seeded position. The resource
layout has a starter grove, three large forests and five smaller groves, with
104 trees, 8 stone deposits and 6 gold deposits. Each tree holds 160 wood,
each stone deposit 480 stone and each gold deposit 520 gold. The enemy has
250 HP but no AI. The player selects villagers, orders movement, gathering,
construction and attacks, recruits at completed centers and wins by destroying
the enemy base. Villagers have 30 HP; centers have 350 HP. There is no opposing
army yet.

The browser uses Three.js for the isometric map and generated geometry. The
Phoenix server owns authoritative matches in development and can receive the
same command set as the static solo simulation used on GitHub Pages. The
snapshot protocol is version 3 and contains resources, buildings, villagers,
orders, hit points, attack intervals, stockpiles and outcome. Villagers hop
while moving and lunge in time with gathering or attacking; the target
remains outside their standing footprint.

## Next work (historical, superseded)

Historical priorities from 2026-09-28; superseded by the roadmap below.

1. Add pathfinding and unit collision around buildings and resource nodes.
2. Add a combat unit and an opponent simulation, with balancing and defeat
   conditions. Keep the current passive enemy as a useful test scenario.
3. Add save and restore through a versioned KC3 adapter. The live simulation
   should remain in the supervised Elixir process.
4. Profile growing maps and unit counts before adding Rust or a spatial index.
5. Add multiplayer match ownership and authentication before exposing shared
   matches beyond the local prototype.

## Quality gate (historical baseline)

Run `mix format --check-formatted`, `mix credo --strict`, `mix test`,
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
`npm run smoke`, and `npm run smoke:pages`. The browser checks exercise WebGL,
initial RTS state, recruitment and player ordered resource delivery in both
Phoenix and solo modes.

---

# Audit and roadmap for the next Codex (2026-09-29)

This is a handoff based on commit `a8626fb`. Inspect the code and `git status`
before editing: paths, measurements and test counts are a baseline, not a
permanent API. The goal is an open source browser RTS whose **authoritative
gameplay rules execute in KC3**. The first complete product is a replayable
**1vAI** match; the next is a secure **online 1v1**. Later modes may add more
players. The visual direction is an **original overhead pixel world** inspired
by WorldBox's map scale and living detail, combined with an RTS economy and
command loop. Never copy WorldBox sprites, UI, palette, maps, name or branding.

The live demo, README and architecture claims must agree. Demonstrate KC3
with working code, reproducible setup and clear tests. Make focused commits
that each add or fix a behavior; do not create commits just to raise the count.

## A. Audited inventory and gaps

| Priority | Finding | Code/evidence |
| --- | --- | --- |
| Working | Two solo paths exist: a Pages browser simulation and an Elixir/Phoenix development server. Select, group, move, gather wood/stone/gold, build a second town center, recruit, stop and attack a passive base work. | `web/src/game/{local_world,local_connection}.ts`, `server/lib/kc3_rts/game/{world,world_server}.ex`, `web/src/main.ts` |
| Working | Camera pan/zoom, drag selection, control groups, minimap, health, generated sprites, seeded maps and browser smoke checks exist. | `web/src/scene/`, `web/scripts/smoke.mjs` |
| **P0** | There is **no KC3 code in this repo or live game path**. The old plan's future checkpoint adapter would be too small a KC3 contribution for this project's stated purpose. | `README.md`, old plan, all `server/lib` and `web/src/game` files |
| **P0** | Online 1v1 does **not** exist. Everyone joins `game:lobby`; `UserSocket.connect/3` accepts all clients; channel join checks only an ID pattern; no unit owner or player slot exists. All clients can command the same army. Never present this server as multiplayer. | `server/lib/kc3_rts_web/{user_socket,game_channel}.ex`, `web/src/game/connection.ts` |
| **P0** | Enemy cannot move, fight or win. Only workers exist; their only attack target is a passive 250 HP base. There is no defeat path in simulation despite `defeat` being in the browser type. No food, production queue, population cap, military roster, AI or fog. | `server/lib/kc3_rts/game/world.ex`, `web/src/game/{protocol,local_world}.ts` |
| **P1** | Movement is straight line through buildings/resources; placement has proximity checks but no walkability grid, pathfinding, unit spacing or stuck behavior. | `World.move/2`, `local_world.ts:move` |
| **P1** | Mixed selections are accepted if **any** ID exists. `[1, 999]` was accepted by server `stop` during audit. Browser local mode also uses `some`. Fix before ownership is introduced. | `World.valid_selection?/3`, `local_world.ts:34–36` |
| **P1** | Elixir and TypeScript duplicate the simulation and map generator. Tests compare selected seed coordinates and scenarios, not full state across many seeds and orders. Drift risk will increase with features. | `server/lib/kc3_rts/game/`, `web/src/game/` |
| **P1** | Isometric diagonal camera and one green square ground texture diverge from the requested overhead WorldBox map feel. No water, coasts, biomes or meaningful geography. Round trees dominate, while workers have only 4×6 source pixels and left/right facing. | `web/src/scene/{camera,world_objects,villager_pixels}.ts` |
| **P1** | HUD uses rounded translucent cards, gradient, blur, Inter fallback and 10–12 px labels; this clashes with hard pixel artwork. At 1100×550, its 385 px command panel, 330 px resource panel and 220 px minimap obscure much of the game. | `web/index.html`, `web/src/style.css`, audited Chrome screenshots |
| **P1** | There is no separate portfolio website yet: `web/index.html` is a single full-screen game shell. The “AI-looking website” request therefore applies first to this game's HUD and states, then to any later landing page. Do not build generic marketing around an unfinished game. | `web/index.html`, `web/src/style.css` |
| **P1** | Full world snapshot is broadcast at 10 Hz and after every accepted command. A fresh seed 12345 JSON snapshot measured **9,726 bytes** (118 resources, 2 buildings, 3 workers), roughly **97 KB/s/client** before transport overhead at idle. Minimap redraws per snapshot. | `WorldServer.handle_info/2`, `web/src/main.ts:onSnapshot` |
| **P1** | Each resource gets a separate sprite/texture/material; facing/cargo changes recreate worker textures. Draw calls and allocations need measurement before choosing an atlas or instances. | `web/src/scene/{scene_model,world_objects}.ts` |
| **P1** | `WorldServer.ensure_started/2` accepts arbitrary valid match IDs and starts supervised processes with no count, idle timeout or join entitlement. Concurrent creation can also race between registry lookup and `start_child`. This needs isolation and bounded lifecycle before any public KC3-backed solo server. | `world_server.ex:38–50`, `game_channel.ex:8–19` |
| **P1** | The server schedules its next 100 ms tick after processing the previous one, so elapsed match time can drift under load. Snapshot replies and broadcasts have no command sequence or monotonic state revision for client reconciliation. | `world_server.ex:88–102`, `web/src/game/connection.ts:35–49` |
| **P1** | A successful-looking order marker appears before the server accepts the command. Late rejection has only a text notice; selection and build placement have no pending/accepted feedback contract. | `world_view.ts:148–155`, `web/src/main.ts:onCommand` |
| **P2** | In-memory matches have no save, replay, reconnect contract, expiry or cleanup. Supervised restart creates a fresh world. | `world_server.ex`, `application.ex` |
| **P2** | Current tick work scales with repeated list scans/copies: Elixir maps the resource list on each gathering action; local TypeScript clones all resources/buildings each tick and sorts completed centers for each returning worker. This is an optimization candidate to profile, not a reason to rewrite blindly. | `world.ex:208–229`, `local_world.ts:65–74` |
| **P2** | Snapshot parsing checks field shapes but not unique IDs, valid cross references or monotonic revisions. This is adequate for the current prototype, but the multiplayer protocol needs stronger invariants and rejection of stale/incompatible state. | `web/src/game/protocol.ts:31–53` |
| **P2** | Vite warns about its >500 KB chunk. Server build measured 580.32 KB JS / 148.97 KB gzip; Pages 561.16 KB / 143.74 KB gzip. This is a baseline, not evidence that runtime is slow. | `npm run build`, `npm run smoke:pages` |

On 2026-09-29, `mix format --check-formatted`, `mix credo --strict`,
`mix test` (**16 passed**), `npm run lint`, `npm run typecheck`, `npm test`
(**31 passed**), `npm run build`, `npm run smoke` and `npm run smoke:pages`
all passed. Smokes cover WebGL, minimap, recruiting, ordered wood delivery and
stop in Phoenix and Pages modes. They do not test KC3, enemy AI or 1v1.
Chrome screenshots were inspected in normal and low quality at 1100×550; they
are audit artifacts in `/tmp`, not committed.

The machine has a built KC3 checkout at `/home/baptiste/Documents/kc3`, with
`kc3s`, `ikc3` and `kc3_httpd` binaries. Its README says `v0.2.0-git` on a
development branch, and the checkout has unrelated dirty files. It is useful
for a spike, **not** a reproducible project dependency. Its KC3 source exposes
`JSON.from_str` and `JSON.to_str` in `lib/kc3/0.1/json.kc3`; persistent
request handling and deployment must still be proven. Pin a clean KC3 release
or commit in this repo and CI.

## B. Research and decisions drawn from it

- [WorldBox official site](https://www.superworldbox.com/) and its
  [developer Steam page](https://store.steampowered.com/app/1206560/WorldBox__God_Simulator/)
  show a living world with varied terrain and tiny settlements. Official game
  imagery shows overhead terrain, water/coasts, biome regions, tree clusters
  and compact inhabitants. **Our inference:** a readable overhead map and
  varied silhouettes are more central to the requested feel than a specific
  sprite. Make original art; do not extract or trace theirs.
- The [official Age of Empires IV quickstart](https://www.ageofempires.com/news/quickstart-guide-age-of-empires-iv/)
  describes explore → gather → train/build → fight. Its
  [official tips](https://www.ageofempires.com/news/age-of-empires-iv-tips-to-help-you-get-started/)
  discuss scouting, rally points and allocating resources. **Our inference:**
  every new unit/building needs an economic or tactical job, not just an icon.
- [Aseprite sprite basics](https://www.aseprite.org/docs/basics/), its
  [pixel perfect setting](https://www.aseprite.org/docs/context-bar/) and
  [Three.js texture guidance](https://threejs.org/manual/pages/textures.html)
  support a consistent source pixel grid, deliberate frame animation and
  nearest texture sampling. Test silhouettes at normal and distant zoom.
- [InterfaceKit's design critique](https://blog.interfacekit.io/what-makes-a-website-look-ai-generated)
  identifies generic repeated structures, interchangeable copy, decorative
  choices without a job, missing product states and inconsistent rules as
  reasons a site *feels* AI generated. This is an opinion about design, **not
  a detector**. Build specific game states and honest content, then review
  rendered screens with people. A gradient or font alone proves nothing.
- [Phoenix channel docs](https://hexdocs.pm/phoenix/channels.html) explain
  topic authorization in `join/3` and token based socket identity. Use both
  before network play.
- [KC3 official docs](https://kc3-lang.org/en/doc/),
  [usage/structure guide](https://kc3-lang.org/doc/3_Guides/3.4_Structure)
  and [HTTPd guide](https://kc3-lang.org/doc/2_HTTPd) describe `kc3s`, facts
  and its web server; the project calls KC3 a prototype. Prove a small
  process/HTTP boundary before migrating the full simulation.
- [W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
  sets a 24×24 CSS px target minimum or spacing exception. Pixel styling must
  still allow legible text, focus states and usable controls.
- [Red Blob Games' original A* guide](https://www.redblobgames.com/pathfinding/a-star/introduction.html)
  explicitly distinguishes global path search from moving agents, formations,
  dynamic obstacles and smoothing. **Our inference:** a correct A* route alone
  will not make an RTS army move well; test many units around shared goals and
  chokepoints before declaring pathfinding complete.
- [Three.js renderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html)
  exposes frame draw-call and GPU memory counters; use these and browser traces
  to justify atlas/culling work. [Three.js disposal guidance](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)
  explains GPU resource cleanup when scenes/assets are replaced.
- [Phoenix endpoint documentation](https://phoenix.hexdocs.pm/Phoenix.Endpoint.html)
  documents configurable WebSocket frame size, and the
  [OWASP WebSocket guidance](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/WebSocket_Security_Cheat_Sheet.md)
  calls for authentication, origin checks, message bounds, rate limits and
  logging. These are concrete gates for any publicly reachable game service.
- [W3C non-text contrast guidance](https://www.w3.org/WAI/WCAG21/understanding/non-text-contrast.html)
  applies to important control outlines and states. Faction identity and
  attack/selection feedback should use silhouette, icons or patterns in
  addition to hue.

No aesthetic treatment can guarantee that a site will never be labelled “AI
made.” The concrete goal is original, coherent art and UI, real screenshots,
specific copy, complete product states, and manual visual review.

## C. Target playable loop and boundaries

The first complete match starts with two fair start locations, a town center,
workers and a scout. A player explores, gathers **food, wood, stone and gold**,
expands population, builds resource and military structures, trains workers
and military units, fights over map control, and wins by a clearly stated
objective. Food supports growth, wood supports basic construction, stone
supports defense/advanced structures, and gold supports military/technology;
exact costs and timings are initial balance data to revise by playtesting.
Workers deposit resources, construction takes time, training has queues and
rally points, and units/buildings take damage and die. The AI uses the same
rules and can win. A normal match must have an opening, strategic choices,
and an end, without debug commands.

Keep the first roster small: workers, one scout, two distinct military roles,
town center, house/population provider, drop-off if needed, barracks, and one
defensive or advanced structure. Add mechanics for a reason demonstrated in
playtests. Define cancellation/refund, unreachable orders, simultaneous hits,
unit death and victory/defeat timing. Later add technologies, factions, more
biomes and modes only after this loop works.

### First match rules to specify before coding each system

Put one versioned `docs/BALANCE_V0.md` (or a small KC3-readable data table)
under review before implementing Phase 3. It must give the exact initial
stockpile, unit/building costs, build/train times, hit points, movement speed,
attack range/damage/cooldown, gather rates/carry capacity, population effects,
AI interval and victory rule. Keep the server as the source of truth and let
the UI read/present the same values. Avoid duplicating unexplained constants
across KC3, Elixir, TypeScript and CSS. Initial numbers are deliberately
provisional: balance them with scripted matches and human playtests.

| Match question | Initial rule to implement and test |
| --- | --- |
| Opening | Each side starts with one completed command center, three workers, one scout and enough starting resources to train at least two workers and start a house. Both starts get reachable food and wood, plus a fair route to gold/stone. |
| Map fairness | Use mirrored or explicitly fairness-checked seeded starts for the first competitive map. Validate path connectivity, nearby resource travel time, buildable space, both starts' defensive terrain and at least one alternate attack route. Save failing seeds. |
| Orders | Left click/drag/shift select and control groups; contextual right click for move, gather, repair/build and attack; explicit stop, attack-move and rally commands; visible destination and rejection feedback. Decide and document queued orders before adding Shift order behavior. |
| Economy | Workers carry a visible resource kind/amount, deposit at eligible structures, switch tasks without losing carried goods silently, and react when a deposit depletes or a drop-off is destroyed. A queue reserves cost exactly once; cancel/refund is deterministic. |
| Combat | No friendly fire in the initial rules. Units have attack target search, wind-up/cooldown and damage; target death clears/retargets orders. Attack-move seeks valid enemies along the route. Building destruction clears occupancy and any queues by a documented refund rule. |
| Victory | A side loses when it has no surviving completed **or under-construction command center**; simultaneous loss has an explicit draw rule. The match records outcome tick and stops accepting game commands. Revise only with a ruleset version change. |
| Fog | A player sees own units/buildings, explored terrain and current sight from units/buildings. A last-seen marker is visibly different from a live enemy. The AI may use only its own allowed view unless an explicitly labelled difficulty rule says otherwise. |
| Match duration | Playtest toward an approximately 8–15 minute median first match and keep a shorter scripted demonstration scenario. Treat this as a feel target, not a timer that forces an artificial win. Detect and log stalemates in autoplay batches. |

Definition of a **complete solo vertical slice**: a player can start from the
menu, understand the objective without README instructions, gather food, train
and build, scout, fight an active AI, win or lose, restart a seeded map, and
see accurate match status throughout. Confirm with at least one person who did
not implement it. Record confusing steps and fix them before calling it done.

## D. Architecture and KC3 proof

Target flow: **TypeScript renders and sends intent → Phoenix authenticates and
routes commands → KC3 owns game rules and simulation → Phoenix publishes a
player-specific view**. Phoenix already supplies WebSocket and supervision;
retain it unless a measured KC3 native server spike can handle the same
requirements more simply. The KC3 contribution must own meaningful gameplay:
economy, rule validation, tick progression, combat and victory in stages. Use
KC3 facts for a justified relationship/query (for example entity ownership,
tech prerequisites or versioned checkpoints), document it and measure it.
Do not describe a game with only KC3 save storage as “built in KC3.”

Canonical state should at minimum hold `seed`, `ruleset_version`, `tick`,
`revision`, terrain/walkability, resource nodes, player stockpiles and fog,
entities with stable ID/type/owner/position/HP/order, production queues and
outcome. Canonical events need tick, revision, actor and entity IDs so replay,
UI feedback and networking agree. This is a schema contract, not a mandate to
use a particular KC3 container internally. KC3 facts should answer a real
game query (for example ownership or technology prerequisite relationships)
with a documented example and benchmark; do not put every moving position
into the facts store merely to advertise the feature.

Suggested ownership map for the migration (names may change if a cleaner
layout emerges):

| Area | Owns | Must not own |
| --- | --- | --- |
| `kc3/` | Match state, deterministic map/RNG, rules and costs, economy, movement/path requests, combat, AI decisions, victory and replay serialization. Split into small modules by rule domain. | Browser-only visuals, Phoenix socket identity or client trust decisions. |
| `server/lib/kc3_rts/` | Supervision of KC3 worker(s), guest/match lifecycle, command sequencing, checkpoint storage and metrics. | A second copy of KC3's gameplay costs or combat rules. |
| `server/lib/kc3_rts_web/` | Authentication, topic authorization, message limits, connection/resync endpoints and per-player publication. | Arbitrary client-supplied ownership or full hidden enemy state. |
| `web/src/game/` | Versioned client protocol, network state/reconciliation and an explicitly labelled offline prototype if kept. | Competitive authority for costs, damage, resources or match outcome. |
| `web/src/scene/` and a small `web/src/ui/` | Pixel rendering, camera, input hit testing, HUD and local presentation settings. | Decisions that change the canonical match state without a server command. |

Keep public interfaces small and named for game concepts. Prefer one ruleset
table over repeated constants, one clear data flow over helper indirection,
and comments for invariants or tricky behavior rather than line-by-line
narration. Avoid dense one-line functions where they hide ordering, errors or
ownership. Review each abstraction against a concrete second use. Profile
before replacing simple code with caches, native code or special indexes;
write the measurement and cleanup behavior next to that decision.

**Mandatory first KC3 spike:** add a pinned `kc3/` program accepting versioned
JSON `new_match`, `command`, `tick` and `snapshot` requests and returning
versioned results/errors. Prove `kc3s` can remain alive across requests with
protocol-clean stdout and can be started, timed out, monitored and stopped by
Elixir. If this is not reliable, test a KC3 HTTPd JSON endpoint; if that is
unsuitable, document a native `libkc3` port option and its crash isolation.
Do not design months of KC3 code around an unproven transport. Keep version,
ABI, memory/process cost and failure behavior in `docs/KC3_ARCHITECTURE.md`.

Choose deterministic integer ticks and fixed point coordinates or another
explicit deterministic representation. Specify RNG seed, entity IDs, command
ordering, simultaneous actions, cooldowns, schema version and acknowledgments.
Renderer interpolation never changes server state. Build a golden corpus of
`seed + commands + ticks → canonical world hash/snapshot`; run it across KC3,
Elixir prototype and browser preview while migration is underway. Remove the
Elixir **network** rules once KC3 covers all existing commands. A static Pages
solo preview may remain, clearly labelled, but the advertised “play the KC3
game” link must point to a KC3 backed deployment.

### KC3 boundary, replay and failure contract

- Define one schema for the adapter request/reply envelope: `protocol_version`,
  `ruleset_version`, `request_id`, `match_id`, `actor_slot`, `expected_revision`,
  `command` or `tick`, then `accepted/rejected`, `reason`, `revision` and
  authoritative events/state. Phoenix assigns actor and match from the
  authenticated session; it never trusts the browser's claimed slot. Bound
  string lengths, collection sizes, coordinates and total message bytes.
  Canonical match outcome should be `playing` or a final result containing
  `winner_slot` (or `null` for draw), `reason` and `ended_tick`; map it to the
  local player's victory/defeat UI. Version the existing protocol v3 when
  changing ownership, terrain or outcome schema.
- One writer advances each match. Serialize commands with ticks in a defined
  order and acknowledge accepted commands with the revision they changed.
  Schedule against monotonic time rather than chaining relative 100 ms delays;
  measure tick lateness and backlog. Define whether late commands apply on
  the next tick or are rejected. Avoid silent skipped or duplicate ticks.
- Make state invariants executable tests: unique entity IDs; nonnegative,
  finite stockpiles/health/timers; valid owner and entity references; unit
  count within limits; valid map positions; no resources created by a
  rejected/cancelled command; and identical state hash after replay.
- Record a seed, ruleset version and accepted command log with tick/order.
  Store a versioned checkpoint periodically and at match end; replay commands
  after the last checkpoint on restart. Write checkpoints atomically. Test
  process crash/restart, invalid checkpoint and version mismatch, and show a
  recoverable error instead of switching silently to Elixir rules. Choose a
  retention period and cap disk/memory use for guest matches.
- Keep browser presentation separate: client accepts only newer revisions,
  reconciles command acknowledgments with snapshots/events, removes a pending
  order marker if rejected, and requests full resync after a gap. Distinguish
  connection lost, reconnecting, incompatible ruleset and match ended. Never
  infer the authoritative result from a local animation.

### Public solo demo is a separate milestone before 1v1

The existing shared `game:lobby` is not suitable for a public KC3-backed solo
demo. Before deploying one, create an isolated match per guest session with an
unguessable ID, signed short-lived join capability, owner check on every
command, match cap, idle expiry and cleanup. Keep this simpler than 1v1:
there is one human slot plus one server AI slot, and no invite or matchmaking
UI. Host the built web client and WebSocket on the same HTTPS origin if
practical; verify reverse proxy, origin check and reconnect behavior. Point
the public “KC3-backed solo” link to this mode as soon as it is working.
Keep Pages labelled as an offline prototype or remove it once the deployed
mode is reliable. This order gives recruiters an actual playable KC3 artifact
before online PvP exists.
Under the current repository-only scope, finish a deployment-ready build,
configuration example and local two-session smoke test. Hosting and changing
the public link wait for an explicit future scope change after those artifacts
are concrete and reviewable.

### Network match contract

Server creates an opaque match ID and two player slots, with phases `waiting`,
`running`, `finished`, `expired`. Short lived signed guest tokens are adequate
for initial 1v1; accounts are optional. `UserSocket.connect/3` authenticates,
`GameChannel.join/3` authorizes membership, and KC3 validates **every**
selected unit's owner, target, costs and current phase. Commands carry an ID
or sequence number for duplicate/late input handling and are rate limited.
Player-specific snapshots hide fogged information. Reconnect resyncs the
same slot; disconnect, surrender, timeout and abandoned match cleanup have
explicit rules. Test two isolated clients; neither may control the other.
Start with one authoritative server; add more players and matchmaking after
1v1 is reliable.

Define the 1v1 rules for simultaneous join, duplicate joins from one token,
reconnect to an already occupied slot, ready cancellation, server restart,
client version mismatch, player leave/surrender and postgame rematch. Limit
incoming WebSocket frame size, commands per second, selected ID count and
matches per guest/IP with reasonable privacy-conscious logging. Give
ownership/visibility tests priority over broad end-to-end smoke tests.
Broadcast only data the receiving player may know; a client-side dark fog
overlay is **not** hidden information if the full enemy snapshot was sent.
Keep the protocol's match revision distinct from simulation tick so multiple
commands inside one tick can be ordered and acknowledged.

## E. Visual direction: world, units, UI, site

1. Make `docs/ART_DIRECTION.md` with **links** to official WorldBox reference
   screens and 2–3 other legal overhead pixel references. Annotate camera
   angle, tile scale, terrain transitions, water/coast, tree/unit/building
   relative size, palette ramps, outline/shadow treatment and HUD footprint.
   Do not commit copyrighted reference images.
2. Make two small **original** prototypes: pure top down orthographic and a
   slightly tilted overhead option. Compare screenshots at 1366×768,
   1100×550 and a narrow screen, at three zoom levels. Prefer pure top down
   unless tilt preserves geography and selection. Document the chosen camera.
3. Prototype a consistent source grid (for example 16×16 terrain tiles and
   8–12 px wide workers; adjust after screenshot review). Define shared color
   ramps for deep/shallow water, shore, grass, forest, stone, warm earth and
   two distinct faction accents. Team color must dominate worker identification;
   the current seeded random outfits cannot do that in 1v1. Inspect at native
   and reduced scale, and test against every biome.
4. Generate purposeful geography: coast/water, beach, grass, forest, hills or
   cliffs as blockers, resource clusters and routes, with enough open space
   for formations and placement. Minimap must show the same terrain and fog.
   Use a few coherent original tree/ore variants, not a wall of identical
   circular trees. Guarantee fair nearby starting resources across seeds.
5. Use coherent original sprite sheets with idle, walk, work and attack frames
   in at least four directions. Buildings need construction/damage states.
   Match the chosen overhead camera with overhead or three-quarter unit poses;
   the current camera-facing side sprites cannot simply be reused at a new
   angle.
   Keep nearest sampling; test camera snapping and integer scaling for pixel
   shimmer. Use hit targets larger than tiny painted sprites, but ensure
   sprites remain readable at normal zoom. Use short crisp effects and shadows
   to clarify action, not ambient glow.
6. Permit authored assets with recorded creator/source/license. Current
   `CONTRIBUTING.md` requires all visuals to be procedural; revise it when
   introducing sprite sheets. Never extract or trace WorldBox assets.

Replace generic glass cards with one HUD language: solid dark earth/ink
surfaces, restrained stepped or squared borders, original pixel icons,
compact resource strip, contextual command grid, small minimap, clear
affordability/progress/hotkeys and unobtrusive alerts. Use a readable body
font and pixel display type sparingly. Build title/menu, loading, lobby,
pause, victory/defeat and error states in the same system. At 1100×550 the
map must remain playable; use responsive placement, not three large opaque
panels. Keep focus outlines, reduced motion, readable labels and practical
pointer targets.

Before polishing this HUD, write a one-page **creative brief**: world theme,
faction cues, shape language for terrain/buildings/icons, typography roles,
tone of in-game writing, and two reference screenshots from our own build.
Sketch at least two distinct original HUD directions on the same gameplay
frame. Choose one by unit/map legibility and command clarity, then record its
palette, spacing, borders, icon grid and motion rules as reusable tokens.
Avoid making the game look like a SaaS dashboard with fantasy colors. Provide
UI scale, volume/mute and quality controls; solo pause freezes authoritative
ticks, while an online menu leaves the live match running and says so clearly.

If making a project/portfolio page, show **real gameplay captures**, a short
verified diagram of KC3's role, run instructions, source link and changelog.
Use specific facts, not stock art, placeholder stats, repeated feature cards
or claims of online play before online play exists. Ask humans to review
screens and copy; do not optimize for an unverifiable “AI detector.”

### Art/UI acceptance review

For every major visual change, capture the same seeded opening and a crowded
midgame at 1366×768, 1100×550 and a narrow viewport, with normal and low
quality and at minimum/default/maximum zoom. Review these questions in the
rendered browser, not from CSS alone: Can a person identify their units and
the opponent at a glance? Are food/wood/stone/gold nodes distinct? Are unit
roles and selected health/order legible? Does a pending building show its
footprint and invalid site? Can the player find the next useful action within
seconds? Does any HUD block essential map interaction? Are water, obstacles,
fog and valid routes understandable on both main view and minimap? Save
screenshots with seed, viewport, DPR and commit so visual regressions can be
compared fairly.

The website/game “not generic” review should inspect real copy and actual
states: title, menu, lobby, solo, combat, result, disconnection and empty or
invalid selections. Reject placeholder claims, repeated decorative cards,
unexplained gradients/blur, mismatched icons, inconsistent spacing and visual
motifs that could be transplanted unchanged to another product. Ask at least
two external viewers what the game is, what KC3 actually does and what they
would click next; revise confused screens. No automated “AI appearance”
score is an acceptance criterion.

Sound is missing from the current prototype. Add a small original/licensed
sound set for selection, order accepted/rejected, work, construction, attack,
unit death and result, plus optional music only if it supports play. Keep
volume controls and mute available, and do not start audio before a user
gesture. Record source/license like visual assets. Performance and clarity
matter more than adding many effects.

Test browser WebGL context loss/restore, page background/resume and resize;
make recovery or a clear reload action part of the UI. Treat low quality mode
as reduced workload with still-readable pixel art, not simply blurry output.

## F. Ordered implementation packages and reviewable commits

Each numbered item can be a focused commit or a few focused commits. Keep a
working game at phase boundaries. Follow current `[ADD]` / `[FIX]` convention.

### Phase 0 — honest baseline and safety

1. Update README “works today” versus “planned” and record this audit. Keep
   the Pages build labelled solo. Do not claim KC3 is already in gameplay.
2. Add regression tests for mixed ID selection on server and browser; reject
   any nonexistent ID and validate command lengths/finite points. Add the
   unowned-unit case when the owner field arrives in Phase 1.
3. Add cross-runtime golden fixtures for several seeds and order sequences,
   including depletion, simultaneous gathering, invalid placement, dead
   targets and boundaries. Compare full canonical state/hashes, not a few
   coordinates.
4. Add repeatable baseline scripts for tick p50/p95, snapshot bytes, GPU draw
   calls/frame time and browser memory; record hardware, browser, viewport
   and seed in `docs/PERFORMANCE.md`.
5. Capture one fixed-seed opening and midgame screenshot at the target
   viewports. Write a short risk ledger linking each P0/P1 finding to its
   phase and acceptance test, so a future refactor cannot quietly drop it.

**Exit:** baseline and known bugs reproducible, all existing gates pass.

### Phase 1 — actual KC3 vertical slice (highest priority)

1. Add `kc3/` and a pinned runtime setup/build in CI; make clean checkout
   setup work without the dirty local KC3 tree. Add KC3 hello/rule tests.
2. Prove the persistent JSON/HTTP boundary with an Elixir integration test:
   create, valid command, rejected command, two ticks, snapshot, timeout and
   process failure/restart. Choose one interface and document it.
3. Move starting stockpile, costs and build/recruit validation to KC3; then
   gather/delivery, map generation, movement, combat and victory in small
   parity checked steps. Document any changed semantics in fixtures.
4. Decide one KC3 worker per match versus a multiplexed worker after
   benchmarking startup, resident memory, tick time and failure isolation.
5. Route Phoenix matches through KC3, retire the Elixir network simulation,
   and update README with exact KC3/Elixir/TypeScript responsibilities and a
   runnable command that demonstrates KC3-owned state.
6. Add revisioned acknowledgments, replay/checkpoint fixtures and a
   monotonic-time tick schedule. Prove crash recovery or document the exact
   failure behavior before the game is publicly reachable.
7. Add per-guest solo match isolation, signed join capability, bounded
   process count and idle cleanup. Retire `game:lobby` as a public entry point;
   test unauthorized joins and cross-match commands before hosting the server.

**Exit:** local network gameplay fails its integration tests when KC3 is
unavailable; CI runs the pinned KC3 build and boundary tests; two guest solo
sessions cannot see or command one another.

### Phase 2 — map, camera, navigation and art

1. Add tile/biome/obstacle data to the versioned protocol and KC3 map
   generator. Generate two fair start areas with guaranteed basic resources,
   separation and viable routes. Run seeded property tests across many maps.
2. Add occupancy/walkability grid and pathfinding (A* on order, lighter local
   steering for groups if useful). Repath on order/blocker changes, not every
   frame. Define footprints, unreachable target response and stuck recovery.
   Keep gameplay path decisions in KC3 unless profiling justifies a documented
   native helper. Test units routing around buildings, water, trees and ore.
3. Switch to the selected overhead camera; verify raycasts, drag selection,
   placement, edge pan, zoom bounds, minimap click and keyboard controls.
   Preserve readable pixels at multiple DPR values.
4. Add original terrain transitions and an atlas for first tree, ore, unit
   and building variants. Capture fixed-seed screenshots at target viewports
   as CI artifacts, with manual comparison before merge.
5. Test a crowded 50–100 unit scene and a narrow chokepoint. A* route quality
   must be paired with spacing, goal distribution and blocker updates so
   armies do not pile onto one tile or cross through occupied buildings.

**Exit:** the screenshot reads as a varied, navigable overhead world at normal
zoom and units route around blockers in game and tests.

### Phase 3 — full 1vAI loop

1. Write the versioned first balance table and victory/draw rule described
   above. Add food and gathering; ensure map/start stocks permit worker growth.
2. Add houses/pop cap, barracks, two military roles, construction stages,
   training queues, rally points, cancel/refund and disabled-command feedback.
   Make all costs/timings data that KC3 validates.
3. Add combat against units and structures, attack-move, cooldowns,
   damage/armor/range, deaths, target acquisition, victory and defeat. Test
   simultaneous events and rejected/duplicate training and orders.
4. Add a deterministic KC3 opponent policy through the **same commands and
   rules** as a human. AI gathers, expands, scouts, defends and attacks using its own
   allowed fogged view; no hidden resources unless a visibly labelled
   difficulty mode explicitly grants them.
5. Run autoplay batches across seeds; record win/loss, match duration, stalls,
   resource starvation and common openings. Playtest and tune costs/counters
   in small commits with rationale. Add first-match guidance after the loop
   is real.
6. Finish start/restart/end flow, sound feedback and match history needed to
   demonstrate a full game without reading the README. Make the solo browser
   client use the KC3-backed server when presenting this mode as a KC3 demo.

**Exit:** a new player can finish a 1vAI match with either result, and seeded
AI games finish rather than stall.

### Phase 4 — UI and public presentation

1. Build HUD components with one visual system. Split `main.ts` and
   `style.css` only where the split reduces complexity; remove stale CSS
   overrides and unused classes. Test real selection, queues, errors and end
   states at three viewports.
2. Finish title, pause, loading, connection/error and victory/defeat screens;
   check focus, reduced motion, pointer targets and readability.
3. Publish honest docs, asset licenses, screenshot/footage and a concise KC3
   architecture demonstration. Keep project page and game in visual agreement.
4. Prepare the isolated **KC3-backed 1vAI** service for HTTPS/WSS hosting:
   repo-owned deployment config, origin policy, process caps, health checks,
   browser error handling and a local two-session smoke. Verify a clean guest
   can finish a match and another guest cannot interfere. When the user
   expands scope, publish it and update the public link; label Pages as an
   offline prototype if retained. This is the first recruiter-facing KC3
   game milestone after publication.

**Exit:** manual screenshot review shows one original system and a clean
checkout can run an isolated KC3-backed game; hosting artifacts and claims
are reviewable. After scope expands, the public link reaches that build.

### Phase 5 — secure online 1v1

1. Build match create/join, guest token, slot assignment, ready/start/end,
   expiry and cleanup for a second human; verify the unrestricted
   `game:lobby` path remains disabled outside local legacy tests.
2. Validate membership and every command in KC3, including ownership,
   resources, targets, phase and rate. Add sequence/duplicate handling and
   adversarial tests for cross-player and cross-match commands.
3. Add fog-filtered player views, initial snapshot plus delta/events or
   another measured efficient format, and reconnect resync. Profile idle and
   battle bandwidth with two players and 100+ units.
4. Automate two independent browsers: both see consistent combat; neither
   controls the other; match completes; disconnect/reconnect works.
5. Extend the isolated solo service to invite/join 1v1 only after
   authorization, fog filtering, load tests and both-browser smoke pass.
   Add operational monitoring for match count, tick lag, KC3 crashes,
   resyncs and abnormal command rejection rates. Publishing this mode is a
   separate future step if the user expands scope beyond this repository.

**Exit:** two local browsers complete a fair match and the README accurately
describes what can be run from the repository. If the user later expands
scope, verify the same behavior on the public service and update live links.
Only then consider 2v2, ranked matchmaking, spectating, map editor and more
factions.

## G. Quality and performance gates

Continue `mix format --check-formatted`, `mix credo --strict`, `mix test`,
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke`
and `npm run smoke:pages`. Add pinned KC3 build/tests, process integration
tests, server authorization tests, seeded map and autoplay batches, and
two-browser 1v1 smoke tests. Fixed-seed screenshots are **review artifacts**;
behavioral tests still cover resources, ownership, pathing, combat and
reconnection. Preserve failing seeds and command logs as replay fixtures.

Provisional performance budgets, to revise against measured reference
hardware: maintain 10 authoritative ticks/s without drift; p95 tick below
10 ms for 100 units/two players on a stated machine; 60 fps at 1366×768
for 100 units on a stated midrange device; no multi-second command latency.
Measure KC3 tick time, Phoenix serialization, pathfinding, Three.js frame
time/draw calls, memory and bytes/client separately. Optimize the measured
bottleneck. Candidates include delta snapshots, atlas/shared material,
culling and avoiding repeated list scans; do not add Rust by default.

### Verification matrix

| Risk | Required evidence before marking complete |
| --- | --- |
| KC3 is only a decorative dependency | Kill or disable the KC3 worker: the KC3-backed match stops with a visible error and its integration test fails. A documented trace shows KC3 applied an economy and combat command. |
| Simulation divergence | Golden replay fixtures across multiple seeds and command streams compare canonical hashes at checkpoints; property tests cover invalid commands and invariants. All versioned protocol changes state how old clients/saves fail or migrate. |
| Map is unfair or impassable | A seeded batch checks both start regions, path connectivity, resource reachability and placement space; store any failing seed with a visible map capture. |
| RTS loop stalls or is trivial | Automated AI games record completion/stalemate rates and human playtests record first useful action, resource starvation, match length, unclear commands and whether both sides can win. |
| Online player can cheat or leak information | Two authenticated sockets attempt cross-match joins, enemy unit commands, oversized/replayed commands and fogged state reads; all are rejected without mutating state. |
| Pixel art looks good only when zoomed in | Fixed-seed normal/low quality captures at normal and distant zoom show unit role, team, resource and terrain distinction; verify click targets and camera motion live. |
| Optimizations add complexity without value | Keep before/after traces for tick p95, render calls/frame time, memory and bytes/client at fixed unit counts, seed, viewport and hardware. Revert an optimization that does not improve the measured bottleneck. |

### Release and open source evidence

- Keep a clean-checkout one-command or short documented local setup that pins
  Elixir, Node and KC3 versions and verifies prerequisites. No dependency on
  untracked files, a developer's neighboring KC3 checkout or secrets in Git.
  Keep a minimal example environment file with variable names only.
- README should distinguish **play now**, **implemented**, **planned** and
  **how KC3 participates**. Include controls, one representative gameplay
  capture, architecture diagram, reproducible tests, performance results and
  known limitations. A 60–90 second unedited or clearly cut demo should show
  KC3-backed gathering, construction, combat and outcome; later add 1v1.
- Maintain MIT license for project code and an asset/dependency attribution
  manifest for graphics, fonts and audio. Review the pinned KC3 distribution's
  notices before packaging it. Keep `CONTRIBUTING.md`, `SECURITY.md` and CI
  aligned with the actual architecture and report build/test failures plainly.
- Tag meaningful playable milestones such as `solo-kc3`, `rts-1vai` and
  `online-1v1`; record a short change log and screenshots at each. A phase is
  complete when the tagged build runs from a clean checkout, not merely when
  its code is merged. Keep commits reviewable and descriptive, with tests or
  captures appropriate to the change; never split a change only to produce a
  larger commit count.

## H. Instructions for the next Codex

1. Read `README.md`, `CONTRIBUTING.md`, this plan, `server/lib/kc3_rts/game/`,
   `server/lib/kc3_rts_web/`, `web/src/game/`, `web/src/scene/`,
   `web/src/{main.ts,style.css}` and `.github/workflows/`. Inspect the Git
   status before editing; preserve user changes.
2. Run baseline quality gates. Verify a pinned KC3 from clean setup; the
   neighboring `/home/baptiste/Documents/kc3` checkout is not a dependency.
3. Start with mixed-selection fix and parity fixtures, then the KC3 boundary
   spike. Do not start with a portfolio site while KC3 remains absent.
4. Keep all changes inside `Perso/KC3RTS` unless the user changes scope.
   Commit in reviewable slices when the session authorizes commits; do not
   rewrite history just to increase the count.
5. Update this roadmap after each phase with actual architecture decisions,
   measurements, test results and remaining blockers.

Open decisions to resolve through prototypes and evidence: KC3 process versus
HTTP/native boundary and version pin; pure overhead versus slight tilt; exact
palette/sprite scale; first-match balance; hosting budget and platform;
fog rules and performance target machine. Do not guess these into permanent
constraints before testing them.

## I. Execution record (2026-09-29, working tree)

The Phase 0 baseline and first Phase 1 transport spike have been implemented
without changing the playable authority. `PLAN.md` had pre-existing local
edits; this record appends to them.

- **Phase 0:** Mixed, dead, duplicate, empty and overlength villager selections
  now fail in Elixir and TypeScript. Out-of-bounds move rejection is aligned
  across runtimes. Four version-3 fixtures compare complete canonical states
  after seeded movement, gathering/depletion, invalid placement/selection,
  construction, recruitment and a dead target. `server/scripts/benchmark.exs`
  and a browser `?profile=1` capture record the first tick, snapshot, render
  and heap baselines in `docs/PERFORMANCE.md`. Seeded low-quality opening and
  working captures at 1366×768, 1100×550 and 390×844 are in
  `docs/screenshots/`; `docs/VISUAL_BASELINE.md` records the inspected HUD
  overlap and tiny-worker issues. The risk ledger links high-priority gaps to
  later acceptance tests.
- **Phase 1 spike:** `scripts/setup-kc3.sh` pins commit
  `4bdffa88b35a496ca0a856a9eb58486cf6e2029c` and its submodules. A
  fresh commit checkout was built locally and passed the port integration
  test. `kc3/worker.kc3` stays alive across JSON requests and owns opening
  wood/gold, recruitment cost, actor check, revision and tick. Elixir's
  `KC3Worker` bounds input/output, serializes calls and fails closed on
  timeout or process exit. A CI job is configured to build and test it, but
  remote CI has not been observed yet. `docs/KC3_ARCHITECTURE.md` records the
  stdin discovery, protocol and failure contract.
- **Verification:** after these edits, `mix format --check-formatted`,
  `mix credo --strict`, `mix test` with the clean pinned KC3 binary (20 tests),
  `npm run lint`, `npm run typecheck`, `npm test` (34 tests) and
  `npm run build`, `npm run smoke` and `npm run smoke:pages` passed. The Pages
  smoke also passed at all three captured viewports. Normal-quality Chrome/SwiftShader stayed on
  “Preparing the map…” for 90 seconds; hardware-accelerated normal quality
  has not been checked. No GPU timer measurement was available.

**Next dependency:** migrate the *live* `WorldServer` simulation into KC3
through parity-checked economy, map, movement, combat and outcome rules. The
current KC3 worker is a proven transport and one rule slice, not the playable
game authority. Then add replay/checkpoints, monotonic scheduling and isolated
guest solo lifecycle before any public KC3-backed claim. Continue with
Phases 2–5 in the order above. No deployment, remote settings or publishing
work has been done.

### 2026-09-29 continuation: spacing, coverage and KC3 economy

- **Unit hitboxes:** The playable Elixir and offline TypeScript simulations now
  give villagers a 0.45-unit circular hitbox. Recruitment searches free ring
  positions and rejects a full spawn area without charging resources. Ordered
  units steer around occupied positions during movement, gathering, returning,
  construction and attack. The Elixir simulation uses a local collision grid;
  the browser uses the same deterministic movement rule. Tests cover spawn
  spacing, crossing paths, 24-unit convergence on every tick and a 100-unit
  crowd. A fifth full-state replay compares crowded commands and delivery
  across Elixir and TypeScript. Dense traffic can still stall and movement
  still passes through static buildings and resources; Phase 2 pathfinding is
  open.
- **KC3 economy slice:** The persistent KC3 worker now owns opening stone,
  center placement bounds, builder validation, 25 wood / 15 stone reservation,
  100-tick construction progress, completed-center recruitment, and rejection
  without revision or stockpile changes. The KC3 integration test covers the
  full build/tick/recruit sequence and invalid requests. This is a bounded
  KC3-owned ruleset, not yet the complete playable world. KC3 map generation,
  gather/delivery, unit movement, combat and victory, then Phoenix routing,
  remain the next Phase 1 work.
- **Coverage and performance:** The KC3-enabled Elixir suite has 28 tests and
  92.45% overall cover points; the browser suite has 41 tests and 95.23%
  statements, 88.30% branches, 95.52% functions and 99.07% lines. CI now
  runs coverage gates at 90% server overall and 90/85/90/95% browser
  statements/branches/functions/lines. The 100-unit crowded Elixir p95 was
  18,676 µs with a full-list collision scan and 4,654 µs after a spatial
  grid, below the provisional 10 ms tick budget on the recorded machine.
  `docs/PERFORMANCE.md` records the fixed workload and limits. Remote CI has
  not yet been observed.
- **Server lifecycle:** The Phoenix endpoint and PubSub now start before match
  workers and stop after them. A coverage run had exposed a match tick trying
  to broadcast after the endpoint table disappeared during shutdown. The
  Phoenix browser smoke passed again after the supervisor order changed.
