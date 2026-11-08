/** Minimal Server-Sent Events hub. */
export class Events {
  constructor() {
    this.clients = new Set();
    // Keeps proxies and browsers from closing idle connections.
    this.heartbeat = setInterval(() => this.write(': ping\n\n'), 25_000);
    this.heartbeat.unref();
  }

  /** Attaches a raw Node response as an SSE stream. */
  attach(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  emit(type, data = {}) {
    this.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  write(chunk) {
    for (const res of this.clients) res.write(chunk);
  }

  close() {
    clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
