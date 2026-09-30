import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDirectory = resolve(webDirectory, "../server");
const pagesMode = process.argv.includes("--pages");
const kc3Mode = process.argv.includes("--kc3");
const pageUrl = `http://127.0.0.1:5173${pagesMode ? "/KC3RTS/" : "/"}?${new URLSearchParams({
  ...(process.env.KC3RTS_SMOKE_QUALITY === "normal" ? {} : { quality: "low" }),
  ...(pagesMode ? { seed: "12345" } : {}),
  ...(kc3Mode ? { mode: "kc3" } : {}),
  ...(process.env.KC3RTS_ANGLE ? { angle: process.env.KC3RTS_ANGLE } : {}),
  ...(process.env.KC3RTS_ZOOM ? { zoom: process.env.KC3RTS_ZOOM } : {}),
  ...((process.env.KC3RTS_METRICS_PATH || kc3Mode) ? { profile: "1" } : {}),
})}`;
const sleep = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const processes = [];

function start(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const record = (chunk) => { output = (output + chunk.toString()).slice(-8_000); };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  processes.push({ name, child, logs: () => output });
  return child;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((done) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      done();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      done();
    });
    child.kill("SIGTERM");
  });
}

async function until(action, timeout, label) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

function browserExecutable() {
  const candidates = [
    process.env.KC3RTS_CHROME,
    "/usr/local/bin/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) throw new Error("Chromium/Chrome not found. Set KC3RTS_CHROME to its executable.");
  return found;
}

class DevTools {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener("open", resolveOpen, { once: true });
      this.socket.addEventListener("error", rejectOpen, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveResult, rejectResult) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectResult(new Error(`Chrome did not respond to ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async click(x, y, button = "left") {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
  }

  async evaluate(expression) {
    const reply = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (reply.exceptionDetails) throw new Error(`Browser evaluation failed: ${expression}`);
    return reply.result.value;
  }

  close() { this.socket.close(); }
}

const STATE = `(() => ({
  mode: document.getElementById("connection")?.dataset.state,
  canvas: !!document.querySelector("#scene canvas"),
  loadingHidden: document.getElementById("loading")?.hidden,
  fallbackHidden: document.getElementById("fallback")?.hidden,
  wood: Number(document.getElementById("wood")?.textContent),
  stone: Number(document.getElementById("stone")?.textContent),
  gold: Number(document.getElementById("gold")?.textContent),
  villagers: Number(document.getElementById("villagers")?.textContent),
  enemyHp: Number(document.getElementById("enemy-hp")?.textContent),
  tick: document.getElementById("tick")?.textContent,
  notice: document.getElementById("notice")?.textContent,
  mapSeed: Number(document.getElementById("map-seed")?.textContent),
  recruitEnabled: !document.getElementById("recruit")?.disabled
}))()`;

const mapSource = await readFile(join(webDirectory, "src/game/map_generation.ts"), "utf8");
const mapModule = ts.transpileModule(mapSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { generateMap } = await import(`data:text/javascript;base64,${Buffer.from(mapModule).toString("base64")}`);
function woodNodes(seed) {
  return generateMap(seed).resources.filter((r) => r.kind === "wood")
    .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
}
function project(point, rect, y = 0, radius = 52) {
  const height = Math.max(Math.min(radius * 1.2, 42), Math.min(radius * 1.8, 64) / (rect.width / rect.height));
  const scale = rect.height / height * (process.env.KC3RTS_ZOOM === "tactical" ? .7 : 1);
  const angle = (process.env.KC3RTS_ANGLE === "steep" ? 40 : 30) * Math.PI / 180;
  return { x: rect.left + rect.width / 2 + (point.x - point.z) / Math.sqrt(2) * scale,
    y: rect.top + rect.height / 2 + ((point.x + point.z) * Math.sin(angle) / Math.sqrt(2) - y * Math.cos(angle)) * scale };
}

let profile;
let devtools;

try {
  if (!pagesMode) start("Phoenix", "mix", ["run", "--no-halt"], serverDirectory);
  start("Vite", process.execPath, pagesMode
    ? ["node_modules/vite/bin/vite.js", "preview", "--base", "/KC3RTS/", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]
    : ["node_modules/vite/bin/vite.js"], webDirectory);

  if (!pagesMode) {
    await until(async () => {
      const response = await fetch("http://127.0.0.1:4000/health", { signal: AbortSignal.timeout(1_000) });
      return response.ok && (await response.json()).status === "ok";
    }, 90_000, "Phoenix health endpoint");
  }
  await until(async () => {
    const response = await fetch(pageUrl, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  }, 15_000, pagesMode ? "Pages preview" : "Vite page");

  profile = await mkdtemp(join(tmpdir(), "kc3rts-browser-"));
  start("Chromium", browserExecutable(), [
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--headless",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--remote-allow-origins=*",
    "--remote-debugging-port=0",
    "--window-size=1100,700",
    pageUrl,
  ], webDirectory);

  const port = await until(async () => {
    const contents = await readFile(join(profile, "DevToolsActivePort"), "utf8");
    return Number(contents.split("\n")[0]);
  }, 15_000, "Chromium DevTools port");
  const pages = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const entries = await response.json();
    return entries.find((entry) => entry.type === "page" && entry.url.startsWith(pageUrl));
  }, 15_000, "game browser tab");
  devtools = new DevTools(pages.webSocketDebuggerUrl);
  await devtools.ready();

  if (process.env.KC3RTS_VIEWPORT_WIDTH && process.env.KC3RTS_VIEWPORT_HEIGHT) {
    await devtools.send("Emulation.setDeviceMetricsOverride", {
      width: Number(process.env.KC3RTS_VIEWPORT_WIDTH),
      height: Number(process.env.KC3RTS_VIEWPORT_HEIGHT),
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  const initial = await until(async () => {
    const state = await devtools.evaluate(STATE);
    return state.mode === (pagesMode ? "local" : "connected") && state.canvas &&
      state.loadingHidden && state.fallbackHidden && (kc3Mode ? state.villagers === 6 && state.enemyHp === 1500 : state.recruitEnabled &&
      state.wood === 30 && state.stone === 15 && state.gold === 20 &&
      state.villagers === 3 && state.enemyHp === 250) ? state : false;
  }, kc3Mode ? 120_000 : process.env.KC3RTS_SMOKE_QUALITY === "normal" ? 90_000 : 60_000, "live RTS map");

  if (process.env.KC3RTS_OPENING_SCREENSHOT) {
    const jpeg = /\.jpe?g$/i.test(process.env.KC3RTS_OPENING_SCREENSHOT);
    const screenshot = await devtools.send("Page.captureScreenshot", jpeg ? { format: "jpeg", quality: 80 } : { format: "png" });
    await writeFile(process.env.KC3RTS_OPENING_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  if (process.env.KC3RTS_METRICS_PATH) {
    await devtools.send("Performance.enable");
    const frameIntervals = await devtools.evaluate(`new Promise((resolve) => {
      const samples = []; let previous = 0;
      const sample = (time) => {
        if (previous) samples.push(time - previous);
        previous = time;
        if (samples.length < 60) requestAnimationFrame(sample);
        else resolve(samples);
      };
      requestAnimationFrame(sample);
    })`);
    const render = await devtools.evaluate("window.__kc3rtsStats?.()");
    const performanceMetrics = await devtools.send("Performance.getMetrics");
    const values = Object.fromEntries(performanceMetrics.metrics.map((metric) => [metric.name, metric.value]));
    frameIntervals.sort((a, b) => a - b);
    await writeFile(process.env.KC3RTS_METRICS_PATH, `${JSON.stringify({
      seed: initial.mapSeed,
      quality: process.env.KC3RTS_SMOKE_QUALITY === "normal" ? "normal" : "low",
      viewport: { width: Number(process.env.KC3RTS_VIEWPORT_WIDTH) || 1100, height: Number(process.env.KC3RTS_VIEWPORT_HEIGHT) || 700, dpr: 1 },
      render,
      frameIntervalP50Ms: frameIntervals[29],
      frameIntervalP95Ms: frameIntervals[56],
      jsHeapUsedBytes: values.JSHeapUsedSize,
      jsHeapTotalBytes: values.JSHeapTotalSize,
      domNodes: values.Nodes,
    }, null, 2)}\n`);
  }

  if (process.argv.includes("--capture")) {
    console.log("Opening captured.");
  } else if (kc3Mode) {
    const state = () => devtools.evaluate("window.__kc3rtsState()");
    const before = await state();
    const unit = before.entities.find((e) => e.id === 2);
    const rect = await devtools.evaluate('(() => { const r = document.querySelector("#scene canvas").getBoundingClientRect(); return { left:r.left, top:r.top, width:r.width, height:r.height }; })()');
    const from = project({ x: unit.x / 256, z: unit.z / 256 }, rect, 1.2, 24);
    await devtools.click(from.x, from.y);
    const selected = await devtools.evaluate('document.getElementById("selection").textContent');
    if (!selected.includes("selected")) throw new Error(`KC3 selection failed: ${selected}`);
    // Save and recall a control group through real keyboard input.
    await devtools.send("Input.dispatchKeyEvent", { type: "keyDown", code: "Digit1", key: "1", modifiers: 2 });
    await devtools.send("Input.dispatchKeyEvent", { type: "keyUp", code: "Digit1", key: "1" });
    await devtools.send("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape" });
    await devtools.send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape" });
    await devtools.send("Input.dispatchKeyEvent", { type: "keyDown", code: "Digit1", key: "1" });
    await devtools.send("Input.dispatchKeyEvent", { type: "keyUp", code: "Digit1", key: "1" });
    const target = project({ x: 6, z: 2 }, rect, 0, 24);
    await devtools.click(target.x, target.y, "right");
    const moved = await until(async () => {
      const next = await state();
      return next.entities.some((e) => e.owner === 1 && e.order && (e.x !== before.entities.find((old) => old.id === e.id).x || e.z !== before.entities.find((old) => old.id === e.id).z)) ? next : false;
    }, 20_000, "authoritative KC3 movement");
    await devtools.evaluate('document.getElementById("stop").click()');
    const stopped = await until(async () => { const next = await state(); return next.entities.every((e) => e.order === null) ? next : false; }, 10_000, "KC3 stop order");
    const later = await until(async () => { const next = await state(); return next.tick >= stopped.tick + 3 ? next : false; }, 10_000, "ticks after stop");
    if (later.tick <= stopped.tick || JSON.stringify(later.entities) !== JSON.stringify(stopped.entities)) throw new Error("Stopped KC3 entities drifted or ticks stopped");
    if (before.content_hash !== later.content_hash || later.revision <= moved.revision) throw new Error("KC3 identity/revision changed incorrectly");
    if (process.env.KC3RTS_SMOKE_SCREENSHOT) {
      const screenshot = await devtools.send("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.KC3RTS_SMOKE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
    }
    // Exercise paid queues and the economy through visible controls.
    const selectEntity = async (id, height = 1.2) => {
      const current = await state(); const entity = current.entities.find((e) => e.id === id);
      const at = project({ x: entity.x / 256, z: entity.z / 256 }, rect, height, 24);
      await devtools.click(at.x, at.y);
    };
    const button = async (id) => devtools.evaluate(`(() => { const b = document.querySelector('[data-action="${id}"]'); if (!b || b.disabled) throw new Error("Command unavailable: ${id}"); b.click(); })()`);
    await selectEntity(1, 2);
    await button("core.train_worker");
    await until(async () => (await state()).entities.find((e) => e.id === 1).queue.length === 1, 10_000, "first paid worker queue");
    await button("core.train_worker");
    const paid = await until(async () => { const v = await state(); return v.entities.find((e) => e.id === 1).queue.length === 2 ? v : false; }, 10_000, "second paid worker queue");
    if (paid.players[0].stocks["core.food"] !== 100 || paid.players[0].population.reserved !== 2) throw new Error("Queue payment or reservation incorrect");
    const waiting = paid.entities.find((e) => e.id === 1).queue[1];
    await button(`cancel-${waiting.id}`);
    await until(async () => { const v = await state(); return v.players[0].stocks["core.food"] === 150 && v.players[0].population.reserved === 1; }, 10_000, "exact unstarted cancellation refund");
    await selectEntity(2);
    const berries = paid.nodes.find((n) => n.id === 39);
    const foodPoint = project({ x: berries.x / 256, z: berries.z / 256 }, rect, 1, 24);
    await devtools.click(foodPoint.x, foodPoint.y, "right");
    await until(async () => (await state()).entities.some((e) => e.owner === 1 && e.task?.kind === "gather"), 10_000, "visible berry gathering order");
    const delivered = await until(async () => { const v = await state(); return v.players[0].stocks["core.food"] > 150 && v.players[0].population.used === 7 ? v : false; }, 100_000, "food delivery and queued worker spawn");
    if (delivered.entities.find((e) => e.id === 1).queue.length !== 0) throw new Error("Completed queue did not clear");
    await button("core.build_house");
    const site = project({ x: -6, z: 2 }, rect, 0, 24);
    await devtools.click(site.x, site.y);
    const built = await until(async () => { const v = await state(); return v.entities.some((e) => e.type_id === "core.house" && e.construction) ? v : false; }, 15_000, "worker-built foundation");
    if (built.players[0].stocks["core.wood"] !== 160 || built.players[0].population.cap !== 10) throw new Error("Foundation charged or supplied population incorrectly");
    await until(async () => (await state()).players[0].population.cap === 15, 100_000, "worker completion and house capacity");
    if (process.env.KC3RTS_SMOKE_SCREENSHOT) {
      const screenshot = await devtools.send("Page.captureScreenshot", { format: "png" });
      await writeFile(process.env.KC3RTS_SMOKE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
    }
    console.log("KC3 browser smoke passed: generic entities, faction art, selection/group recall, authoritative move/stop, paid queues, cancellation, food delivery, worker spawn and house completion.");
  } else {
    await devtools.evaluate('document.getElementById("recruit").click()');
    const recruited = await until(async () => {
      const state = await devtools.evaluate(STATE);
      return state.villagers === initial.villagers + 1 &&
        state.wood === initial.wood - 5 && state.gold === initial.gold - 5 ? state : false;
    }, 35_000, "villager recruitment");

    const rect = await devtools.evaluate('(() => { const r = document.querySelector("#scene canvas").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()');
    const villager = project({ x: 0, z: 3.4 }, rect, 1);
    let wood;
    for (const node of woodNodes(initial.mapSeed)) {
      const candidate = project(node, rect, 3.2);
      if (candidate.x < rect.left + 15 || candidate.x > rect.left + rect.width - 15 ||
          candidate.y < rect.top + 15 || candidate.y > rect.top + rect.height - 15) continue;
      const visible = await devtools.evaluate(`document.elementFromPoint(${candidate.x}, ${candidate.y})?.matches("#scene canvas")`);
      if (!visible) continue;
      await devtools.click(candidate.x, candidate.y);
      const label = await devtools.evaluate('document.getElementById("selection")?.textContent');
      if (label?.startsWith("Wood")) { wood = candidate; break; }
    }
    if (!wood) throw new Error("No visible wood node for browser order test");
    await devtools.click(villager.x, villager.y);
    const selected = await devtools.evaluate('document.getElementById("selection").textContent');
    if (!selected.includes("villager selected")) throw new Error(`Click selection failed: ${selected}`);
    await devtools.send("Input.dispatchMouseEvent", { type: "mousePressed", x: wood.x, y: wood.y, button: "right", buttons: 2, clickCount: 1 });
    const orderDetail = await until(async () => { const detail = await devtools.evaluate('document.getElementById("selection-detail")?.textContent'); return detail?.includes("Gathering") ? detail : false; }, 30_000, "resource gather order");
    await devtools.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: wood.x, y: wood.y, button: "right", buttons: 0, clickCount: 1 });
    if (!orderDetail) throw new Error("Gather order missing");
    const delivered = await until(async () => {
      const state = await devtools.evaluate(STATE);
      return state.wood > recruited.wood ? state : false;
    }, 90_000, "ordered wood gathering and delivery");
    await devtools.evaluate('document.getElementById("stop").click()');
    await until(async () => {
      const detail = await devtools.evaluate('document.getElementById("selection-detail")?.textContent');
      return detail?.includes("Idle") ? detail : false;
    }, 30_000, "villager stop order");
    const minimapVisible = await devtools.evaluate('(() => { const c = document.getElementById("minimap"); const r = c.getBoundingClientRect(); return r.width > 100 && r.height > 100 && !!c.getContext("2d"); })()');
    if (!minimapVisible) throw new Error("Minimap missing");

    if (process.env.KC3RTS_SMOKE_SCREENSHOT) {
      const screenshot = await devtools.send("Page.captureScreenshot", { format: "jpeg", quality: 65 });
      await writeFile(process.env.KC3RTS_SMOKE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
    }

    console.log(`Browser smoke passed: WebGL RTS map and minimap, ${pagesMode ? "static solo mode" : "Phoenix socket"}, recruitment (${initial.villagers} → ${recruited.villagers}), ordered wood delivery (${recruited.wood} → ${delivered.wood}) and stop order.`);
  }
} catch (error) {
  console.error(error);
  if (devtools) {
    try { console.error("Browser state:", await devtools.evaluate(STATE)); } catch { /* tab closed */ }
  }
  for (const process of processes) console.error(`${process.name} log:\n${process.logs()}`);
  process.exitCode = 1;
} finally {
  devtools?.close();
  for (const running of processes.reverse()) await stop(running.child);
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
}

// Node's WebSocket implementation can keep a closed DevTools connection alive.
// All child processes and temporary files have been cleaned up at this point.
process.exit(process.exitCode ?? 0);
