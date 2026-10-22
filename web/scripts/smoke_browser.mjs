import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Cold browser startup on a shared runner is not a gameplay timing budget.
// Keep it bounded, but distinguish a live browser from a failed launch.
export function waitForBrowserPort(child, profile, timeout = 60_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer;
    const finish = (error, port) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      clearTimeout(pollTimer);
      child.off("exit", onExit);
      child.off("error", onError);
      if (error) reject(error);
      else resolve(port);
    };
    // Only lifecycle status is reported, never environment values or logs.
    const onExit = (code, signal) => finish(new Error(
      `Chromium exited before DevTools was ready (code ${code}, signal ${signal ?? "none"})`,
    ));
    const onError = () => finish(new Error("Chromium could not be launched"));
    const deadlineTimer = setTimeout(() => finish(new Error(
      `Timed out waiting for Chromium DevTools port after ${timeout} ms (process still running)`,
    )), timeout);
    child.once("exit", onExit);
    child.once("error", onError);
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit(child.exitCode, child.signalCode);
      return;
    }

    const poll = async () => {
      try {
        const contents = await readFile(join(profile, "DevToolsActivePort"), "utf8");
        // Chrome writes a port and a browser endpoint. Do not accept an
        // empty/partially written port, zero, or an out-of-range value.
        const match = /^(\d+)\r?\n\/devtools\/browser\/[^\r\n]+/.exec(contents);
        const port = match ? Number(match[1]) : 0;
        if (port > 0 && port <= 65535) {
          finish(null, port);
          return;
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          finish(new Error("Cannot read Chromium DevTools port file"));
          return;
        }
      }
      if (!settled) pollTimer = setTimeout(poll, 200);
    };
    void poll();
  });
}

// Attach to an inert page first. The game navigation happens only after CDP
// observation is enabled; an advertised target URL is not proof of a load.
export async function findBlankPage(port, timeout = 15_000, fetchPage = fetch) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    let timer;
    try {
      const entries = await Promise.race([
        (async () => {
          const response = await fetchPage(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
          if (!response.ok) throw new Error("Chrome target endpoint failed");
          return response.json();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Chrome target endpoint timed out"));
          }, Math.min(1_000, deadline - Date.now()));
        }),
      ]);
      const page = entries.find((entry) => entry.type === "page" && entry.url === "about:blank" && typeof entry.webSocketDebuggerUrl === "string");
      if (page) return page;
    } catch { /* The next bounded poll may observe a newly created target. */ }
    finally { clearTimeout(timer); }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((done) => setTimeout(done, Math.min(200, remaining)));
  }
  throw new Error("Timed out waiting for blank browser tab");
}
