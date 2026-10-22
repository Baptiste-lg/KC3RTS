import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserNavigation, publicOrigin } from "./smoke_navigation.mjs";

const url = "http://127.0.0.1:5173/?mode=kc3&token=PRIVATE#PRIVATE";
const good = { matchesUrl: true, ready: "complete", html: true, titleMatches: true, shell: true };
let transport, observer, emit, unsubscribe, events;
function documentEvents(frameId = "main", loaderId = "new", overrides = {}) {
  emit("Network.requestWillBeSent", { requestId: `${frameId}:${loaderId}`, frameId, loaderId, type: "Document" });
  emit("Page.frameNavigated", { frame: { id: frameId, loaderId, url, ...overrides } });
  emit("Network.responseReceived", { frameId, loaderId, type: "Document", response: { status: 200, mimeType: "text/html", url } });
}
beforeEach(() => {
  vi.useFakeTimers(); events = () => documentEvents(); unsubscribe = vi.fn();
  transport = {
    failure: null,
    onEvent: vi.fn((listener) => { emit = listener; return unsubscribe; }),
    send: vi.fn(async (method) => {
      if (method === "Page.navigate") { events(); return { frameId: "main", loaderId: "new" }; }
      return {};
    }),
    evaluate: vi.fn(async () => good),
  };
  observer = new BrowserNavigation(transport, url);
});
afterEach(() => {
  observer.dispose(); expect(unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
});

describe("observed single game navigation", () => {
  it("enables observation before navigating and accepts events before the command reply", async () => {
    await observer.open();
    expect(transport.send.mock.calls.map(([method]) => method)).toEqual(["Page.enable", "Runtime.enable", "Network.enable", "Log.enable", "Inspector.enable", "Page.navigate"]);
    expect(observer.snapshot().document).toEqual(good);
    expect(observer.snapshot().navigation.status).toBe(200);
  });

  it("waits for parsing, not just a matching target URL", async () => {
    transport.evaluate.mockResolvedValueOnce({ ...good, ready: "loading", shell: false });
    const opened = observer.open();
    await vi.advanceTimersByTimeAsync(100); await opened;
    expect(transport.evaluate).toHaveBeenCalledTimes(2);
  });

  it("rejects a wrong HTTP200 HTML document immediately", async () => {
    transport.evaluate.mockResolvedValue({ ...good, shell: false });
    await expect(observer.open()).rejects.toThrow("missing the static RTS interface");
    expect(transport.evaluate).toHaveBeenCalledOnce();
  });

  it("rejects a document that changes URL during evaluation", async () => {
    transport.evaluate.mockResolvedValue({ ...good, matchesUrl: false });
    await expect(observer.open()).rejects.toThrow("identity changed");
  });

  it.each([{ url: "chrome-error://chromewebdata/" }, { unreachableUrl: url }])("rejects an error document: %j", async (overrides) => {
    events = () => documentEvents("main", "new", overrides);
    await expect(observer.open()).rejects.toThrow("unexpected or unreachable");
  });

  it.each([[503, "text/html"], [200, "text/plain"]])("rejects response status/type %s %s", async (status, mimeType) => {
    events = () => {
      documentEvents();
      emit("Network.responseReceived", { frameId: "main", loaderId: "new", type: "Document", response: { status, mimeType, url } });
    };
    await expect(observer.open()).rejects.toThrow("not successful HTML");
  });

  it("reports a matching Document loadingFailed without leaking request data", async () => {
    events = () => {
      documentEvents();
      emit("Network.loadingFailed", { requestId: "main:new", type: "Document", errorText: `net::ERR_CONNECTION_RESET at ${url}` });
    };
    await expect(observer.open()).rejects.toThrow("Game document loading failed: net::ERR_CONNECTION_RESET");
    expect(JSON.stringify(observer.snapshot())).not.toContain("PRIVATE");
  });

  it("ignores stale loaders, unrelated frames and iframe navigation", async () => {
    events = () => {
      documentEvents("main", "old", { url: "http://wrong.example/" });
      emit("Network.loadingFailed", { requestId: "main:old", type: "Document", errorText: "net::ERR_FAILED" });
      documentEvents("other", "new", { unreachableUrl: url });
      emit("Page.frameNavigated", { frame: { parentId: "main", id: "main", loaderId: "new", url: "http://wrong.example/" } });
      documentEvents();
    };
    await observer.open();
    documentEvents("main", "old", { unreachableUrl: url });
    expect(observer.snapshot().navigation.unreachable).toBe(false);
  });

  it("rejects navigation errors and downloads without trying navigation again", async () => {
    transport.send.mockImplementation(async (method) => method === "Page.navigate" ? { errorText: `net::ERR_FAILED ${url}` } : {});
    await expect(observer.open()).rejects.toThrow(/^Game document navigation failed: net::ERR_FAILED$/);
    transport.send.mockImplementation(async (method) => method === "Page.navigate" ? { isDownload: true } : {});
    await expect(observer.open()).rejects.toThrow("did not create an HTML document");
    expect(transport.send.mock.calls.filter(([method]) => method === "Page.navigate")).toHaveLength(2);
  });

  it("bounds missing events and reacts to a closed transport", async () => {
    events = () => {};
    const timed = expect(observer.open(200)).rejects.toThrow("Timed out waiting for game document");
    await vi.advanceTimersByTimeAsync(200); await timed;
    transport.failure = new Error("connection closed");
    const closed = expect(observer.open()).rejects.toThrow("connection closed");
    await vi.advanceTimersByTimeAsync(100); await closed;
  });

  it("retains bounded allowlisted diagnostics, never console arguments or network contents", () => {
    for (let i = 0; i < 30; i++) {
      emit("Network.requestWillBeSent", { requestId: `${i}`, frameId: "main", loaderId: `${i}`, type: "Document", request: { headers: { Cookie: "PRIVATE" }, postData: "PRIVATE" } });
      emit("Page.frameNavigated", { frame: { id: "main", loaderId: `${i}`, url } });
      emit("Runtime.exceptionThrown", { exceptionDetails: { url, lineNumber: i, exception: { description: "PRIVATE" } } });
      emit("Runtime.consoleAPICalled", { type: "error", args: [{ value: "PRIVATE" }] });
      emit("Log.entryAdded", { entry: { level: "error", url, text: "PRIVATE" } });
      emit("Network.loadingFailed", { requestId: "absent", type: "Script", errorText: "PRIVATE" });
      emit("Network.responseReceived", { type: "Script", response: { status: 404, url, headers: { Cookie: "PRIVATE" }, body: "PRIVATE" } });
    }
    emit("Page.frameNavigated", { frame: { url } });
    emit("Ignored.event", {});
    expect(observer.documents.size).toBe(8); expect(observer.requests.size).toBe(8);
    expect(observer.snapshot().events).toHaveLength(20);
    expect(JSON.stringify(observer.snapshot())).not.toMatch(/PRIVATE|token|headers|Cookie|postData|body/);
    expect(JSON.stringify(observer.snapshot()).length).toBeLessThan(4_000);
  });
});

describe("public origins", () => {
  it.each([
    ["https://user:PRIVATE@example.test/PRIVATE?token=PRIVATE#PRIVATE", "https://example.test"],
    ["about:blank", "about:blank"], ["data:text/html,PRIVATE", "data:[redacted]"],
    ["not a URL PRIVATE", "[invalid URL]"],
  ])("redacts %s", (input, expected) => { expect(publicOrigin(input)).toBe(expected); });
});
