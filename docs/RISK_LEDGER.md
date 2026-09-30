# Roadmap risk ledger

The detailed inventory and phases are in `PLAN.md`. This ledger keeps the
acceptance test tied to each high-priority gap.

| Risk | Phase | Evidence required |
| --- | --- | --- |
| KC3 absent from playable rules | 1 | Network match test fails when KC3 worker is unavailable; KC3 applies economy, movement, combat and outcome. |
| Shared `game:lobby` has no owner | 1 before public solo, 5 before 1v1 | **Guest isolation covered:** signed per-match capability, channel authorization, cap and idle expiry tests. 1v1 ownership remains future work. |
| Passive enemy and no defeat | 3 | Seeded AI match ends in both win and loss paths under the same rules. |
| Mixed selections accepted | 0 | Server and browser reject every invalid, dead or duplicate ID before state changes. **Covered.** |
| Elixir and browser drift | 0–1 | Full canonical state fixtures across seeds and order streams. **Legacy fixture covered; KC3 migration remains.** |
| Units cross obstacles | 2 | Seeded path tests around water, resources and buildings, plus crowded chokepoint smoke. |
| Isometric single-terrain art and obstructive HUD | 2–4 | Original overhead screenshots and playtest at target viewports/zoom and normal/low quality. |
| Unbounded matches and snapshots | 1, 4–5 | **Guest cap and expiry covered;** changed-entity patches replace per-tick full snapshots. Measure bytes/client under moving-unit load before public hosting. |
| Tick drift and no revisions | 1 | **Monotonic catch-up, revisioned commands, retry deduplication and gap resync covered.** Browser snapshots reject duplicate IDs and broken order targets. Add sustained load and restart/replay tests before KC3 migration. |
| No save or recovery | 1 before public solo | Crash/restart replay, invalid checkpoint and version mismatch tests. |
