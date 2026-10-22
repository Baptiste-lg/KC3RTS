// Diagnostics are deliberately allowlisted: never retain headers, cookies,
// bodies, postData, console arguments, URL paths, userinfo, queries or fragments.
export function publicOrigin(value) {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol)) return url.origin.slice(0, 160);
    return value === "about:blank" ? value : `${url.protocol}[redacted]`;
  } catch { return "[invalid URL]"; }
}

const networkCode = (text) => /\bnet::ERR_[A-Z0-9_]+\b/.exec(text)?.[0].slice(0, 80) ?? "network failure";
const bounded = (map, key, value) => {
  map.set(key, value);
  if (map.size > 8) map.delete(map.keys().next().value);
};

export class BrowserNavigation {
  constructor(devtools, url) {
    this.devtools = devtools;
    this.url = new URL(url).href;
    this.documents = new Map();
    this.requests = new Map();
    this.events = [];
    this.active = null;
    this.document = null;
    this.unsubscribe = devtools.onEvent((method, params) => this.observe(method, params));
  }

  record(event) {
    this.events.push(event);
    if (this.events.length > 20) this.events.shift();
  }

  update(frameId, loaderId, fields) {
    if (!frameId || !loaderId) return;
    const key = `${frameId}:${loaderId}`;
    if (this.active && key !== this.active) return;
    bounded(this.documents, key, { ...this.documents.get(key), ...fields });
  }

  observe(method, params) {
    if (method === "Network.requestWillBeSent" && params.type === "Document") {
      bounded(this.requests, params.requestId, { frameId: params.frameId, loaderId: params.loaderId });
    } else if (method === "Page.frameNavigated" && !params.frame.parentId) {
      const { id, loaderId, url, unreachableUrl } = params.frame;
      this.update(id, loaderId, { matchesUrl: url === this.url, unreachable: !!unreachableUrl, origin: publicOrigin(url) });
    } else if (method === "Network.responseReceived") {
      const { response, type, frameId, loaderId } = params;
      if (type === "Document") this.update(frameId, loaderId, {
        status: response.status, html: response.mimeType === "text/html",
      });
      if (response.status >= 400) this.record({ event: "http_error", status: response.status, origin: publicOrigin(response.url) });
    } else if (method === "Network.loadingFailed") {
      const code = networkCode(params.errorText);
      const request = this.requests.get(params.requestId);
      if (request) this.update(request.frameId, request.loaderId, { failure: code });
      this.record({ event: "loading_failed", document: params.type === "Document", code });
    } else if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails;
      this.record({ event: "script_exception", origin: publicOrigin(details.url), line: details.lineNumber });
    } else if (method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(params.type)) {
      this.record({ event: "console_error" });
    } else if (method === "Log.entryAdded" && params.entry.level === "error") {
      this.record({ event: "browser_error", origin: publicOrigin(params.entry.url) });
    }
  }

  snapshot() {
    return { expectedOrigin: publicOrigin(this.url), navigation: this.documents.get(this.active) ?? null,
      document: this.document, events: [...this.events] };
  }

  async open(timeout = 15_000) {
    const deadline = Date.now() + timeout;
    const remaining = () => {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("Timed out waiting for game document");
      return left;
    };
    // Listeners precede enable/navigate, including events preceding the reply.
    await Promise.all(["Page.enable", "Runtime.enable", "Network.enable", "Log.enable", "Inspector.enable"]
      .map((method) => this.devtools.send(method, {}, remaining())));
    const navigation = await this.devtools.send("Page.navigate", { url: this.url }, remaining());
    if (navigation.errorText) throw new Error(`Game document navigation failed: ${networkCode(navigation.errorText)}`);
    if (navigation.isDownload || !navigation.frameId || !navigation.loaderId) throw new Error("Game document navigation did not create an HTML document");
    this.active = `${navigation.frameId}:${navigation.loaderId}`;
    while (true) {
      const frame = this.documents.get(this.active);
      if (frame?.failure) throw new Error(`Game document loading failed: ${frame.failure}`);
      if (frame?.unreachable || frame?.matchesUrl === false) throw new Error("Game document navigated to an unexpected or unreachable URL");
      if (frame?.status !== undefined && (frame.status < 200 || frame.status >= 300 || !frame.html)) {
        throw new Error(`Game document response is not successful HTML (HTTP ${frame.status})`);
      }
      if (frame?.matchesUrl && frame.status !== undefined) {
        // Only booleans/fixed metadata leave the page: no HTML/body or raw URL.
        const identity = await this.devtools.evaluate(`(() => ({
          matchesUrl: location.href === ${JSON.stringify(this.url)},
          ready: document.readyState,
          html: document.contentType === "text/html",
          titleMatches: document.title === "KC3RTS — Real-time strategy",
          shell: ["scene", "connection", "loading", "fallback", "recruit"].every((id) => !!document.getElementById(id))
        }))()`, remaining());
        this.document = identity;
        if (!identity.matchesUrl) throw new Error("Game document identity changed during navigation");
        if (identity.ready === "interactive" || identity.ready === "complete") {
          if (!identity.html || !identity.shell) throw new Error("Game document is missing the static RTS interface");
          return;
        }
      }
      await new Promise((done) => setTimeout(done, Math.min(100, remaining())));
      if (this.devtools.failure) throw this.devtools.failure;
    }
  }

  dispose() { this.unsubscribe(); }
}
