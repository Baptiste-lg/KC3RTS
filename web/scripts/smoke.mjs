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
const pageUrl = `http://127.0.0.1:5173${pagesMode ? "/KC3RTS/" : "/"}?${new URLSearchParams({
  ...(process.env.KC3RTS_SMOKE_QUALITY === "normal" ? {} : { quality: "low" }),
  ...(pagesMode ? { seed: "12345" } : {}),
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
function project(point, rect, y = 0) {
  const height = Math.max(42, 64 / (rect.width / rect.height));
  const scale = rect.height / height;
  return { x: rect.left + rect.width / 2 + (point.x - point.z) / Math.sqrt(2) * scale,
    y: rect.top + rect.height / 2 + ((point.x + point.z) / Math.sqrt(6) - y * Math.sqrt(2 / 3)) * scale };
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

  const initial = await until(async () => {
    const state = await devtools.evaluate(STATE);
    return state.mode === (pagesMode ? "local" : "connected") && state.canvas &&
      state.loadingHidden && state.fallbackHidden && state.recruitEnabled &&
      state.wood === 30 && state.stone === 15 && state.gold === 20 &&
      state.villagers === 3 && state.enemyHp === 250 ? state : false;
  }, 30_000, "live RTS map");

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
