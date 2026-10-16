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
