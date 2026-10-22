import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevTools } from "./smoke_devtools.mjs";

class Socket extends EventTarget {
  readyState = 0;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  message(data) { this.dispatchEvent(Object.assign(new Event("message"), { data: typeof data === "string" ? data : JSON.stringify(data) })); }
  reply(result = {}) { this.message({ id: this.sent.at(-1).id, result }); }
}
let client;
beforeEach(() => { vi.useFakeTimers(); client = new DevTools("unused", { Socket }); });
afterEach(() => {
  client.close();
  expect(client.pending.size).toBe(0);
  expect(client.waiting.size).toBe(0);
  expect(client.listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe("bounded Chrome DevTools transport", () => {
  it("handles open, events and out-of-order replies with listener cleanup", async () => {
    const ready = client.ready(); client.socket.open(); await ready; await client.ready();
    const listener = vi.fn(), off = client.onEvent(listener);
    client.socket.message({ method: "Page.event", params: { value: 1 } });
    client.socket.message({ method: "Page.empty" });
    expect(listener).toHaveBeenCalledWith("Page.event", { value: 1 });
    expect(listener).toHaveBeenCalledWith("Page.empty", {});
    off();
    const first = client.send("Page.first"), second = client.send("Page.second");
    client.socket.reply({ value: 2 });
    client.socket.message({ id: 1, result: { value: 1 } });
    await expect(first).resolves.toEqual({ value: 1 });
    await expect(second).resolves.toEqual({ value: 2 });
    client.socket.message({ id: 999, result: {} });
  });

  it("bounds a connection which never opens", async () => {
    const result = expect(client.ready()).rejects.toThrow("Timed out opening");
    await vi.advanceTimersByTimeAsync(30_000); await result;
    await expect(client.ready()).rejects.toThrow("Timed out opening");
  });

  it.each(["close", "error"])("rejects ready and pending commands on %s", async (event) => {
    const waiting = expect(client.ready()).rejects.toThrow("connection");
    client.socket.dispatchEvent(new Event(event)); await waiting;
    await expect(client.send("Page.enable")).rejects.toThrow("connection");
    client.close();
    client = new DevTools("unused", { Socket }); client.socket.open();
    const first = expect(client.send("Page.first")).rejects.toThrow("connection");
    const second = expect(client.send("Page.second")).rejects.toThrow("connection");
    client.socket.dispatchEvent(new Event(event)); await first; await second;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an already closed socket and an early send", async () => {
    await expect(client.send("Page.enable")).rejects.toThrow("not open");
    client.socket.readyState = 3;
    await expect(client.ready()).rejects.toThrow("closed");
  });

  it("rejects pending work when the target crashes without closing its socket", async () => {
    client.socket.open();
    const first = expect(client.send("Runtime.evaluate")).rejects.toThrow("target crashed");
    const second = expect(client.send("Page.enable")).rejects.toThrow("target crashed");
    client.socket.message({ method: "Inspector.targetCrashed" });
    await first; await second;
    expect(client.socket.readyState).toBe(1);
    await expect(client.ready()).rejects.toThrow("target crashed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds sends and ignores a late reply", async () => {
    client.socket.open();
    const result = expect(client.send("Page.enable", {}, 200)).rejects.toThrow("did not respond");
    await vi.advanceTimersByTimeAsync(200); await result;
    client.socket.reply();
  });

  it("does not publish remote errors or thrown send details", async () => {
    client.socket.open();
    const result = client.send("Page.enable");
    client.socket.message({ id: 1, error: { message: "private token" } });
    await expect(result).rejects.toThrow(/^Chrome rejected Page.enable$/);
    client.socket.send = () => { throw new Error("private token"); };
    await expect(client.send("Page.enable")).rejects.toThrow(/^Chrome DevTools send failed$/);
  });

  it.each(["bad json", "null", "[]"])("rejects malformed messages: %s", async (value) => {
    client.socket.open();
    const result = expect(client.send("Page.enable")).rejects.toThrow("Invalid Chrome");
    client.socket.message(value); await result;
  });

  it("evaluates and clicks without leaking failed expressions", async () => {
    client.socket.open();
    const evaluated = client.evaluate("private expression");
    expect(client.socket.sent.at(-1).params.awaitPromise).toBe(true);
    client.socket.reply({ result: { value: 42 } }); await expect(evaluated).resolves.toBe(42);
    const failed = client.evaluate("private expression");
    client.socket.reply({ exceptionDetails: { text: "private token" } });
    await expect(failed).rejects.toThrow(/^Browser evaluation failed$/);
    const clicked = client.click(1, 2); client.socket.reply();
    await Promise.resolve(); client.socket.reply(); await clicked;
    expect(client.socket.sent.at(-1).params).toEqual({ type: "mouseReleased", x: 1, y: 2, button: "left", clickCount: 1 });
  });
});
