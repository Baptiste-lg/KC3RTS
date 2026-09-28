import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDirectory = resolve(webDirectory, "../server");
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
      }, 10_000);
      this.pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
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
  connected: document.getElementById("connection")?.dataset.state === "connected",
  canvas: !!document.querySelector("#scene canvas"),
  loadingHidden: document.getElementById("loading")?.hidden,
  fallbackHidden: document.getElementById("fallback")?.hidden,
  stockpile: Number(document.getElementById("stockpile")?.textContent),
  villagers: Number(document.getElementById("villagers")?.textContent),
  remaining: Number(document.getElementById("remaining")?.textContent),
  recruitEnabled: !document.getElementById("recruit")?.disabled
}))()`;

let profile;
let devtools;

try {
  start("Phoenix", "mix", ["run", "--no-halt"], serverDirectory);
  start("Vite", process.execPath, ["node_modules/vite/bin/vite.js"], webDirectory);

  await until(async () => {
    const response = await fetch("http://127.0.0.1:4000/health", { signal: AbortSignal.timeout(1_000) });
    return response.ok && (await response.json()).status === "ok";
  }, 90_000, "Phoenix health endpoint");
  await until(async () => {
    const response = await fetch("http://127.0.0.1:5173/", { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  }, 15_000, "Vite page");

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
    "--window-size=1440,900",
    "http://127.0.0.1:5173/",
  ], webDirectory);

  const port = await until(async () => {
    const contents = await readFile(join(profile, "DevToolsActivePort"), "utf8");
    return Number(contents.split("\n")[0]);
  }, 15_000, "Chromium DevTools port");
  const pages = await until(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const entries = await response.json();
    return entries.find((entry) => entry.type === "page" && entry.url.includes("127.0.0.1:5173"));
  }, 15_000, "game browser tab");
  devtools = new DevTools(pages.webSocketDebuggerUrl);
  await devtools.ready();

  const initial = await until(async () => {
    const state = await devtools.evaluate(STATE);
    return state.connected && state.canvas && state.loadingHidden && state.fallbackHidden &&
      state.recruitEnabled && state.stockpile === 20 && state.remaining > 0 ? state : false;
  }, 30_000, "live 3D village");

  await devtools.evaluate('document.getElementById("recruit").click()');
  const recruited = await until(async () => {
    const state = await devtools.evaluate(STATE);
    return state.villagers === initial.villagers + 1 &&
      state.stockpile === initial.stockpile - 5 ? state : false;
  }, 10_000, "villager recruitment");

  const delivered = await until(async () => {
    const state = await devtools.evaluate(STATE);
    return state.stockpile > recruited.stockpile && state.remaining < initial.remaining ? state : false;
  }, 70_000, "harvest and resource delivery");

  if (process.env.KC3RTS_SMOKE_SCREENSHOT) {
    const screenshot = await devtools.send("Page.captureScreenshot", { format: "jpeg", quality: 65 });
    await writeFile(process.env.KC3RTS_SMOKE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }

  console.log(`Browser smoke passed: WebGL scene, Phoenix socket, recruitment, delivery (${initial.stockpile} → ${recruited.stockpile} → ${delivered.stockpile}).`);
} catch (error) {
  console.error(error);
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
