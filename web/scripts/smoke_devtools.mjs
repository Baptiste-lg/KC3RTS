// Small bounded CDP transport shared by the smoke and its failure-path tests.
export class DevTools {
  constructor(url, { Socket = WebSocket, timeout = 30_000 } = {}) {
    this.socket = new Socket(url);
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    this.waiting = new Set();
    this.listeners = new Set();
    this.failure = null;
    this.handlers = {
      open: () => { for (const waiter of this.waiting) waiter.finish(); },
      error: () => this.fail(new Error("Chrome DevTools connection failed")),
      close: () => this.fail(new Error("Chrome DevTools connection closed")),
      message: (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
          if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error();
        } catch {
          this.fail(new Error("Invalid Chrome DevTools message"));
          return;
        }
        const pending = this.pending.get(message.id);
        if (pending) {
          pending.finish(message.error ? new Error(`Chrome rejected ${pending.method}`) : null, message.result);
        } else if (message.method === "Inspector.targetCrashed") {
          this.fail(new Error("Chrome DevTools target crashed"));
        } else if (typeof message.method === "string") {
          for (const listener of this.listeners) listener(message.method, message.params ?? {});
        }
      },
    };
    for (const [event, handler] of Object.entries(this.handlers)) this.socket.addEventListener(event, handler);
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.waiting) waiter.finish(error);
    for (const pending of this.pending.values()) pending.finish(error);
    for (const [event, handler] of Object.entries(this.handlers)) this.socket.removeEventListener(event, handler);
    this.listeners.clear();
  }

  ready() {
    if (this.failure) return Promise.reject(this.failure);
    if (this.socket.readyState === 1) return Promise.resolve();
    if (this.socket.readyState !== 0) {
      this.fail(new Error("Chrome DevTools connection closed"));
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      const waiter = { finish: (error) => {
        clearTimeout(timer);
        this.waiting.delete(waiter);
        if (error) reject(error); else resolve();
      } };
      const timer = setTimeout(() => this.fail(new Error("Timed out opening Chrome DevTools connection")), this.timeout);
      this.waiting.add(waiter);
    });
  }

  send(method, params = {}, timeout = this.timeout) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.socket.readyState !== 1) return Promise.reject(new Error("Chrome DevTools connection is not open"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error(`Chrome did not respond to ${method}`)), Math.min(timeout, this.timeout));
      this.pending.set(id, { method, finish });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch { this.fail(new Error("Chrome DevTools send failed")); }
    });
  }

  async click(x, y, button = "left") {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
  }

  async evaluate(expression, timeout = this.timeout) {
    const reply = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
    // The expression and remote error may contain private URLs or page data.
    if (reply.exceptionDetails) throw new Error("Browser evaluation failed");
    return reply.result.value;
  }

  close() {
    this.fail(new Error("Chrome DevTools connection closed"));
    this.socket.close();
  }
}
