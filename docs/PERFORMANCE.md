# Performance baseline (2026-09-29)

Run `cd server && mix run --no-start scripts/benchmark.exs` to repeat the
server numbers. The script uses seed 12345, 1000 ticks, and measures one
`World.step/1` at a time with a monotonic microsecond clock. It starts 3 or
100 idle workers, and also runs a 100-worker shared-destination movement case.
The 100-worker cases recruit from a test-only large stockpile. Snapshot size
is compact Jason JSON at the final tick. The first table below preserves the
pre-hitbox baseline.

| Workers | Tick p50 | Tick p95 | Snapshot bytes | 10 Hz payload/client |
| ---: | ---: | ---: | ---: | ---: |
| 3 | 1 µs | 1 µs | 9,735 | 97,350 B/s |
| 100 | 6 µs | 20 µs | 20,721 | 207,210 B/s |

Machine: Intel Core i5-10310U 1.70 GHz, 8 logical CPUs, 16.9 GB RAM,
OpenBSD, Elixir 1.20.4 and OTP 28. The BEAM reported 4 online schedulers.
These measurements cover an idle legacy Elixir world only. They do not
measure KC3, active gathering/combat, Phoenix serialization or transport,
browser frame time, GPU draw calls, or memory. A 10 Hz full snapshot is already
costly even when idle. Use fixed active scenarios and browser traces before
choosing an optimization.

After adding 0.45-radius unit hitboxes, free recruitment positions and
collision steering, the same seed and 1,000-tick benchmark measured:

| Workers | Workload | Tick p50 | Tick p95 | Snapshot bytes |
| ---: | --- | ---: | ---: | ---: |
| 3 | idle | 2 µs | 4 µs | 9,764 |
| 100 | idle | 139 µs | 160 µs | 22,455 |
| 100 | move to one point | 1,725 µs | 4,654 µs | 26,191 |

The crowded case initially measured 18,676 µs p95 with full-list collision
checks. A local 1.8-unit spatial grid reduced it to 4,654 µs p95 on the
same machine, below the provisional 10 ms server tick budget. These figures
are local runs, not a CI performance guarantee, and exclude KC3 and browser
rendering. The crowded command is intentionally severe: all 100 units target
the same point, and some can remain waiting in dense traffic.

Current Vite build warning: server bundle 580.75 KB JS / 149.10 KB gzip;
Pages bundle 561.82 KB JS / 143.93 KB gzip. Bundle size alone does not show
runtime speed.

For the browser baseline, run `npm run build:pages` in `web/`, then run:

```sh
KC3RTS_VIEWPORT_WIDTH=1100 KC3RTS_VIEWPORT_HEIGHT=550 \
KC3RTS_METRICS_PATH=../docs/browser-baseline-low-1100x550.json \
node scripts/smoke.mjs --pages
```

The [captured JSON](browser-baseline-low-1100x550.json) records seed 12345,
low quality, DPR 1, Chromium 153.0.8010.52 on SwiftShader, 134 draw calls,
122 textures, 4 geometries, 322 triangles, a 2.9 ms CPU `renderer.render`
call, 4.26 MB reported JS heap, and 1336 DOM nodes. Over 60 animation
callbacks, p50/p95 frame intervals were 283/700 ms. This headless software
renderer is much slower than the target GPU and its rAF intervals are only a
proxy for user-visible frame time. `renderer.render` wall time is not GPU
execution time; no GPU timer query has been measured. Repeat on stated
reference graphics hardware before optimizing or judging 60 fps readiness.
