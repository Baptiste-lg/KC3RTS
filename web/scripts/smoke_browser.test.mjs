import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForBrowserPort } from "./smoke_browser.mjs";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

const ready = "45678\n/devtools/browser/test-id\n";
let child;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(readFile).mockReset().mockRejectedValue({ code: "ENOENT" });
  child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
});
afterEach(() => {
  expect(child.listenerCount("exit")).toBe(0);
  expect(child.listenerCount("error")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe("browser startup readiness", () => {
  it("reads a complete port file immediately and cleans up listeners", async () => {
    vi.mocked(readFile).mockResolvedValue(ready);
    await expect(waitForBrowserPort(child, "/unused-profile")).resolves.toBe(45678);
    expect(readFile).toHaveBeenCalledWith("/unused-profile/DevToolsActivePort", "utf8");
  });

  it("allows a live cold browser to become ready after the old 15-second limit", async () => {
    const result = waitForBrowserPort(child, "/unused-profile");
    await vi.advanceTimersByTimeAsync(20_000);
    vi.mocked(readFile).mockResolvedValue(ready);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe(45678);
  });

  it("still rejects a live browser at the 60-second deadline", async () => {
    const result = expect(waitForBrowserPort(child, "/unused-profile"))
      .rejects.toThrow("after 60000 ms (process still running)");
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
  });

  it.each(["", "456", "45678\n", "0\n/devtools/browser/id", "65536\n/devtools/browser/id",
    "NaN\n/devtools/browser/id", "-1\n/devtools/browser/id"])("waits for incomplete or invalid port data: %j", async (contents) => {
    vi.mocked(readFile).mockResolvedValueOnce(contents).mockResolvedValue(ready);
    const result = waitForBrowserPort(child, "/unused-profile");
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe(45678);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("rejects immediately on exit, even a zero exit code", async () => {
    const result = waitForBrowserPort(child, "/unused-profile");
    child.emit("exit", 0, null);
    await expect(result).rejects.toThrow("code 0, signal none");
  });

  it("detects an already terminated process", async () => {
    child.signalCode = "SIGKILL";
    await expect(waitForBrowserPort(child, "/unused-profile")).rejects.toThrow("signal SIGKILL");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reports launch failure without publishing error paths or environment", async () => {
    const result = waitForBrowserPort(child, "/unused-profile");
    child.emit("error", new Error("private launch detail"));
    await expect(result).rejects.toThrow(/^Chromium could not be launched$/);
  });

  it("does not retry permanent file errors or publish their contents", async () => {
    vi.mocked(readFile).mockRejectedValue({ code: "EACCES", message: "private path" });
    await expect(waitForBrowserPort(child, "/unused-profile"))
      .rejects.toThrow(/^Cannot read Chromium DevTools port file$/);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it.each(["", ready])("ignores a read completing after exit: %j", async (contents) => {
    let completeRead;
    vi.mocked(readFile).mockImplementation(() => new Promise((resolve) => { completeRead = resolve; }));
    const result = waitForBrowserPort(child, "/unused-profile");
    child.emit("exit", 1, null);
    await expect(result).rejects.toThrow("code 1");
    completeRead(contents);
    await vi.advanceTimersByTimeAsync(200);
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline effective even while a file read is pending", async () => {
    let completeRead;
    vi.mocked(readFile).mockImplementation(() => new Promise((resolve) => { completeRead = resolve; }));
    const result = expect(waitForBrowserPort(child, "/unused-profile"))
      .rejects.toThrow("after 60000 ms");
    await vi.advanceTimersByTimeAsync(60_000);
    await result;
    completeRead(ready);
    await vi.advanceTimersByTimeAsync(200);
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});
