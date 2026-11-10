// Notifications by webhook (n8n, Home Assistant…) and e-mail (SMTP).
// notify() never throws: a delivery problem is logged and kept in recent().
import path from 'node:path';
import nodemailer from 'nodemailer';
import { badRequest } from './errors.js';

export const NOTIFY_EVENTS = ['queueFinished', 'jobFailed', 'checkFailed', 'jobDone', 'watchAdded'];
export const SMTP_SECURITY = ['starttls', 'tls', 'none'];

export const DEFAULT_NOTIFICATIONS = {
  events: { queueFinished: true, jobFailed: true, checkFailed: true, jobDone: false, watchAdded: false },
  // Shown as a link in messages, e.g. http://10.1.1.115:8095
  appUrl: '',
  webhook: { enabled: false, url: '', headers: '' },
  email: { enabled: false, host: '', port: 587, security: 'starttls', user: '', password: '', from: '', to: '' },
};

const RECENT = 30;
const TIMEOUT = 15_000;

/** Fills missing keys with defaults (settings saved by older versions). */
export function mergeNotifications(n) {
  const d = DEFAULT_NOTIFICATIONS;
  return {
    ...d,
    ...n,
    events: { ...d.events, ...n?.events },
    webhook: { ...d.webhook, ...n?.webhook },
    email: { ...d.email, ...n?.email },
  };
}

/**
 * Validates notification settings from the UI. The e-mail password is never sent
 * to the browser: a missing (or null) password keeps the saved one.
 */
export function normalizeNotifications(n, previous) {
  const v = mergeNotifications(n);
  const prev = mergeNotifications(previous);
  const events = {};
  for (const k of NOTIFY_EVENTS) events[k] = v.events[k] === true;

  const appUrl = String(v.appUrl ?? '').trim();
  if (appUrl && !/^https?:\/\/\S+$/i.test(appUrl)) throw badRequest('The app address must start with http:// or https://');

  const webhook = {
    enabled: v.webhook.enabled === true,
    url: String(v.webhook.url ?? '').trim(),
    headers: String(v.webhook.headers ?? '').trim(),
  };
  if (webhook.url && !/^https?:\/\/\S+$/i.test(webhook.url)) throw badRequest('The webhook URL must start with http:// or https://');
  if (webhook.enabled && !webhook.url) throw badRequest('Enter the webhook URL, or turn the webhook off');
  parseHeaders(webhook.headers);

  const e = v.email;
  const email = {
    enabled: e.enabled === true,
    host: String(e.host ?? '').trim(),
    port: Number(e.port),
    security: e.security,
    user: String(e.user ?? '').trim(),
    // Look at what was sent, not at the merged defaults: no password sent = keep the saved one.
    password: typeof n?.email?.password === 'string' ? n.email.password : prev.email.password,
    from: String(e.from ?? '').trim(),
    to: String(e.to ?? '').trim(),
  };
  if (!Number.isInteger(email.port) || email.port < 1 || email.port > 65535) throw badRequest('The SMTP port must be 1–65535');
  if (!SMTP_SECURITY.includes(email.security)) throw badRequest(`SMTP security must be one of ${SMTP_SECURITY.join(', ')}`);
  if (email.enabled) {
    if (!email.host) throw badRequest('Enter the SMTP server, or turn e-mail off');
    if (!recipients(email.to).length) throw badRequest('Enter at least one e-mail address to send to');
    if (!email.from && !email.user.includes('@')) throw badRequest('Enter the sender address ("From")');
  }
  return { events, appUrl, webhook, email };
}

/** The settings as the browser sees them: no password, only whether one is saved. */
export function publicNotifications(n) {
  const { password, ...email } = n.email;
  return { ...n, email: { ...email, hasPassword: !!password } };
}

/** "Name: value" lines → headers object. */
export function parseHeaders(text) {
  const out = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    const name = i > 0 ? line.slice(0, i).trim() : '';
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw badRequest(`Webhook header lines must look like "Name: value": ${line.trim()}`);
    out[name] = line.slice(i + 1).trim();
  }
  return out;
}

const recipients = (to) => String(to ?? '').split(/[,;\s]+/).filter((x) => x.includes('@'));

const fmtBytes = (n) => {
  if (n == null) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
};
const fmtTime = (s) => {
  if (s == null || !isFinite(s)) return '?';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`;
};
const name = (p) => (p ? path.basename(p) : '');
const encodeTime = (j) => (j.startedAt && j.finishedAt ? (j.finishedAt - j.startedAt - (j.pausedMs ?? 0)) / 1000 : null);

/** Title, text and data for an event. `data` is a job, a run summary or a watch result. */
export function buildMessage(event, data = {}) {
  const lines = [];
  let title;
  const job = (j) => ({
    id: j.id, source: j.sourcePath, output: j.outputPath, preset: j.presetName, status: j.status,
    sourceSize: j.sourceSize, outputSize: j.outputSize, encodeSeconds: encodeTime(j), verifyStatus: j.verifyStatus,
    error: j.error ?? null,
  });
  switch (event) {
    case 'jobDone': {
      title = `Converted: ${name(data.sourcePath)}`;
      const saved = data.sourceSize && data.outputSize ? ` (${Math.round((1 - data.outputSize / data.sourceSize) * 100)}% smaller)` : '';
      lines.push(`${data.sourcePath}`, `→ ${data.outputPath}`, `${fmtBytes(data.sourceSize)} → ${fmtBytes(data.outputSize)}${saved}, in ${fmtTime(encodeTime(data))}`);
      if (data.verifyStatus) lines.push(`Check: ${data.verifyStatus}`);
      return { event, title, text: lines.join('\n'), data: job(data) };
    }
    case 'jobFailed':
      title = `Conversion failed: ${name(data.sourcePath)}`;
      lines.push(data.sourcePath, data.error ?? 'Unknown error');
      return { event, title, text: lines.join('\n'), data: job(data) };
    case 'checkFailed': {
      title = `Check failed: ${name(data.outputPath)}`;
      lines.push(`${data.outputPath} was converted, but the check after conversion found problems:`);
      for (const c of data.verify?.checks ?? []) if (c.status === 'error') lines.push(`- ${c.label}: ${c.detail ?? ''}`.trim());
      return { event, title, text: lines.join('\n'), data: { ...job(data), checks: data.verify?.checks ?? [] } };
    }
    case 'queueFinished': {
      const { jobs = [], startedAt, finishedAt } = data;
      const done = jobs.filter((j) => j.status === 'done');
      const failed = jobs.filter((j) => j.status === 'failed');
      const warned = done.filter((j) => j.verifyStatus === 'error');
      title = `Queue finished: ${done.length} converted${failed.length ? `, ${failed.length} failed` : ''}`;
      const saved = done.reduce((s, j) => s + (j.sourceSize && j.outputSize ? j.sourceSize - j.outputSize : 0), 0);
      lines.push(`Ran for ${fmtTime((finishedAt - startedAt) / 1000)}; ${fmtBytes(saved)} saved.`);
      if (warned.length) lines.push(`${warned.length} converted file(s) failed the check after conversion.`);
      for (const j of jobs.slice(0, 30)) {
        const mark = j.status === 'done' ? (j.verifyStatus === 'error' ? '!' : '✓') : j.status === 'failed' ? '✗' : '-';
        lines.push(`${mark} ${name(j.sourcePath)}${j.status === 'failed' && j.error ? ` (${j.error.slice(0, 120)})` : ''}`);
      }
      if (jobs.length > 30) lines.push(`… and ${jobs.length - 30} more`);
      return {
        event, title, text: lines.join('\n'),
        data: { startedAt, finishedAt, converted: done.length, failed: failed.length, checkFailed: warned.length, savedBytes: saved, jobs: jobs.map(job) },
      };
    }
    case 'watchAdded': {
      const { added = [], folder } = data;
      title = `Watch folder: ${added.length} file${added.length === 1 ? '' : 's'} added to the queue`;
      if (folder) lines.push(`From ${folder}:`);
      for (const p of added.slice(0, 30)) lines.push(`+ ${name(p)}`);
      if (added.length > 30) lines.push(`… and ${added.length - 30} more`);
      if (data.queueState) lines.push(data.queueState);
      return { event, title, text: lines.join('\n'), data: { folder, added } };
    }
    case 'test':
    default:
      return {
        event: 'test',
        title: 'Test notification',
        text: 'This is a test from HandBrake Queue. If you can read it, notifications work.',
        data: {},
      };
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class Notifier {
  constructor({ settings, log, createTransport = nodemailer.createTransport.bind(nodemailer), fetch = globalThis.fetch }) {
    this.settings = settings;
    this.log = log;
    this.createTransport = createTransport;
    this.fetch = fetch;
    this.history = [];
  }

  recent() {
    return this.history;
  }

  /** Sends an event to every enabled channel, if that event is switched on. Never throws. */
  notify(event, data) {
    const cfg = mergeNotifications(this.settings.get('notifications'));
    if (!cfg.events[event]) return Promise.resolve([]);
    const channels = ['webhook', 'email'].filter((c) => cfg[c].enabled);
    if (!channels.length) return Promise.resolve([]);
    let message;
    try {
      message = buildMessage(event, data);
    } catch (err) {
      this.log?.error(err, `Could not build the ${event} notification`);
      return Promise.resolve([]);
    }
    return Promise.all(channels.map((c) => this.deliver(c, message, cfg)));
  }

  /** Sends a test message through one channel with the given (unsaved) settings; throws on failure. */
  async test(channel, notifications) {
    if (!['webhook', 'email'].includes(channel)) throw badRequest('channel must be webhook or email');
    const cfg = normalizeNotifications(notifications, this.settings.get('notifications'));
    const r = await this.deliver(channel, buildMessage('test'), cfg, { force: true });
    if (!r.ok) throw badRequest(r.error);
    return r;
  }

  async deliver(channel, message, cfg, { force = false } = {}) {
    const entry = { at: Date.now(), channel, event: message.event, title: message.title, ok: false, error: null };
    try {
      if (channel === 'webhook') await this.sendWebhook(cfg, message, force);
      else await this.sendEmail(cfg, message, force);
      entry.ok = true;
    } catch (err) {
      entry.error = err.message || String(err);
      this.log?.warn(`Notification (${channel}, ${message.event}) failed: ${entry.error}`);
    }
    this.history.unshift(entry);
    this.history.length = Math.min(this.history.length, RECENT);
    return entry;
  }

  async sendWebhook(cfg, message, force) {
    const w = cfg.webhook;
    if (!w.url) throw new Error('No webhook URL');
    if (!w.enabled && !force) return;
    const body = {
      app: 'HandBrake Queue',
      event: message.event,
      title: message.title,
      message: message.text,
      url: cfg.appUrl || null,
      at: new Date().toISOString(),
      data: message.data,
    };
    const res = await this.fetch(w.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...parseHeaders(w.headers) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`The webhook answered ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
    }
  }

  async sendEmail(cfg, message, force) {
    const e = cfg.email;
    if (!e.enabled && !force) return;
    if (!e.host) throw new Error('No SMTP server');
    const to = recipients(e.to);
    if (!to.length) throw new Error('No address to send to');
    const transport = this.createTransport({
      host: e.host,
      port: e.port,
      secure: e.security === 'tls',
      requireTLS: e.security === 'starttls',
      ignoreTLS: e.security === 'none',
      auth: e.user ? { user: e.user, pass: e.password } : undefined,
      connectionTimeout: TIMEOUT,
      greetingTimeout: TIMEOUT,
      socketTimeout: TIMEOUT * 2,
    });
    const link = cfg.appUrl ? `\n\nOpen HandBrake Queue: ${cfg.appUrl}` : '';
    const html = `<div style="font-family:system-ui,sans-serif;font-size:14px">
<h2 style="font-size:16px;margin:0 0 12px">${escapeHtml(message.title)}</h2>
<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${escapeHtml(message.text)}</pre>
${cfg.appUrl ? `<p style="margin-top:16px"><a href="${escapeHtml(cfg.appUrl)}">Open HandBrake Queue</a></p>` : ''}
</div>`;
    try {
      await transport.sendMail({
        from: e.from ? (e.from.includes('<') ? e.from : `"HandBrake Queue" <${e.from}>`) : `"HandBrake Queue" <${e.user}>`,
        to,
        subject: `[HandBrake Queue] ${message.title}`,
        text: message.text + link,
        html,
      });
    } finally {
      transport.close?.();
    }
  }
}
