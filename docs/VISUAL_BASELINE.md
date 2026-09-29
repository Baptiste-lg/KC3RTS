# Browser visual baseline (2026-09-29)

Seed 12345, static Pages preview, DPR 1, headless Chromium with SwiftShader,
`quality=low`. Each pair captures the opening and the working state after a
villager is recruited, ordered to gather wood, and stopped. The image names
record viewport and state. Repeat with `KC3RTS_VIEWPORT_WIDTH`,
`KC3RTS_VIEWPORT_HEIGHT`, `KC3RTS_OPENING_SCREENSHOT`, and
`KC3RTS_SMOKE_SCREENSHOT` on `node web/scripts/smoke.mjs --pages` after
`npm run build:pages`.

| Viewport | Opening | Working |
| --- | --- | --- |
| 1366×768 | [PNG](screenshots/opening-seed-12345-1366x768.png) | [JPEG](screenshots/working-seed-12345-1366x768.jpg) |
| 1100×550 | [PNG](screenshots/opening-seed-12345-1100x550.png) | [JPEG](screenshots/working-seed-12345-1100x550.jpg) |
| 390×844 | [PNG](screenshots/opening-seed-12345-390x844.png) | [JPEG](screenshots/working-seed-12345-390x844.jpg) |

Review: at 1366×768 the tree and ore silhouettes are distinct, while workers
are tiny beside the large center. At 1100×550 the resource, command and
minimap panels cover a substantial part of the map. At 390×844 the minimap
overlaps the resource panel, obscuring labels and counts. The current camera
still shows a diagonal isometric world with no coastline or terrain regions.
These are baseline defects for Phases 2–4, not accepted final visuals.

The normal-quality headless Pages opening did not finish loading within 90
seconds on this machine's SwiftShader path; it remained at “Preparing the
map…”. Low-quality captures and interactions passed. This does not establish
normal-quality behavior on a hardware-accelerated browser. Recheck with a
real GPU and capture normal-quality frames before accepting visual changes.
