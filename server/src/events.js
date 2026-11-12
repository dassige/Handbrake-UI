/** Minimal Server-Sent Events hub. */
export class Events {
  constructor() {
    // response → transform(type, data) (or null): changes what this client gets, e.g. hides secrets.
    this.clients = new Map();
    // Keeps proxies and browsers from closing idle connections.
    this.heartbeat = setInterval(() => this.write(': ping\n\n'), 25_000);
    this.heartbeat.unref();
  }

  /** Attaches a raw Node response as an SSE stream. */
  attach(req, res, { transform = null } = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.set(res, transform);
    req.on('close', () => this.clients.delete(res));
  }

  emit(type, data = {}) {
    const chunk = (d) => `event: ${type}\ndata: ${JSON.stringify(d)}\n\n`;
    const plain = chunk(data);
    for (const [res, transform] of this.clients) {
      const out = transform ? transform(type, data) : data;
      res.write(out === data ? plain : chunk(out));
    }
  }

  write(chunk) {
    for (const res of this.clients.keys()) res.write(chunk);
  }

  /**
   * Ends every stream; browsers reconnect after a few seconds, and are let in again
   * only if they still may (after login was turned on, a password change, a key revoked…).
   */
  disconnectAll() {
    for (const res of this.clients.keys()) res.end();
    this.clients.clear();
  }

  close() {
    clearInterval(this.heartbeat);
    this.disconnectAll();
  }
}
