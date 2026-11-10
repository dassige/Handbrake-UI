import { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Mail, Send, TriangleAlert, Webhook } from 'lucide-react';
import { api } from '../api.js';
import { ago } from '../format.js';
import { BROWSER_EVENTS, browserNotifySupported, useBrowserNotifyPrefs } from '../attention.js';
import { Card, Check, Field, NumberInput, Switch } from './fields.jsx';

const EVENTS = [
  { id: 'queueFinished', label: 'The queue finished', hint: 'One message per run, listing every file.' },
  { id: 'jobFailed', label: 'A conversion failed' },
  { id: 'checkFailed', label: 'A check after conversion failed' },
  { id: 'jobDone', label: 'Each converted file', hint: 'Can be a lot of messages for a long queue.' },
  { id: 'watchAdded', label: 'A watch folder added files' },
];

const SECURITY = [
  { value: 'starttls', label: 'STARTTLS (usually port 587)', port: 587 },
  { value: 'tls', label: 'TLS (usually port 465)', port: 465 },
  { value: 'none', label: 'None (port 25, local relays only)', port: 25 },
];

const EXAMPLE = `{
  "app": "HandBrake Queue",
  "event": "jobFailed",
  "title": "Conversion failed: Show S01E02.mkv",
  "message": "…",
  "url": "http://…:8095",
  "at": "2026-11-10T21:04:11.000Z",
  "data": { "source": "…", "output": "…", "error": "…" }
}`;

/** For a test: the unsaved settings, with the password only when one was typed. */
function forTest(n) {
  const { hasPassword, ...email } = n.email;
  return { ...n, email };
}

export function NotificationsSection({ draft, set, run }) {
  const n = draft.notifications;
  const setN = (k, v) => set('notifications', { ...n, [k]: v });
  const setHook = (k, v) => setN('webhook', { ...n.webhook, [k]: v });
  const setMail = (k, v) => setN('email', { ...n.email, [k]: v });
  const [recent, setRecent] = useState([]);
  const [testing, setTesting] = useState(null);

  const loadRecent = useCallback(() => api.recentNotifications().then(setRecent, () => {}), []);
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  async function test(channel) {
    setTesting(channel);
    await run(() => api.testNotification(channel, forTest(n)), channel === 'email' ? 'Test e-mail sent' : 'Test sent to the webhook');
    setTesting(null);
    loadRecent();
  }

  const anyChannel = n.webhook.enabled || n.email.enabled;
  const passwordTyped = typeof n.email.password === 'string';

  return (
    <>
      <Card title="Send a message when…" help="settings.notifications">
        <div className="set-grid-2">
          {EVENTS.map((e) => (
            <Check key={e.id} checked={n.events[e.id]} onChange={(v) => setN('events', { ...n.events, [e.id]: v })} hint={e.hint}>
              {e.label}
            </Check>
          ))}
        </div>
        {!anyChannel && <p className="set-hint">Turn on a webhook or e-mail below for these to go anywhere.</p>}
        <Field label="Address of this app, for links in messages (optional)">
          <div className="inline-form">
            <input value={n.appUrl} onChange={(e) => setN('appUrl', e.target.value)} placeholder="http://10.1.1.115:8095" spellCheck={false} />
            <button type="button" className="btn small" onClick={() => setN('appUrl', location.origin)}>Use this page’s address</button>
          </div>
        </Field>
      </Card>

      <Card
        title={<><Webhook size={15} /> Webhook</>}
        aside={<Switch checked={n.webhook.enabled} onChange={(v) => setHook('enabled', v)} label={n.webhook.enabled ? 'On' : 'Off'} />}
      >
        <p className="set-hint">A JSON POST for each message: an n8n Webhook node, a Home Assistant webhook trigger, ntfy, Gotify…</p>
        <Field label="URL">
          <input value={n.webhook.url} onChange={(e) => setHook('url', e.target.value)} placeholder="https://n8n.local/webhook/handbrake" spellCheck={false} />
        </Field>
        <Field label="Extra headers (optional, one per line)" hint="e.g. Authorization: Bearer abc123">
          <textarea rows={2} value={n.webhook.headers} onChange={(e) => setHook('headers', e.target.value)} spellCheck={false} className="mono" />
        </Field>
        <details className="set-details">
          <summary>What is sent</summary>
          <pre className="code-block">{EXAMPLE}</pre>
        </details>
        <div className="set-actions">
          <button type="button" className="btn small" onClick={() => test('webhook')} disabled={!n.webhook.url || !!testing}>
            <Send size={14} /> {testing === 'webhook' ? 'Sending…' : 'Send a test'}
          </button>
        </div>
      </Card>

      <Card
        title={<><Mail size={15} /> E-mail</>}
        aside={<Switch checked={n.email.enabled} onChange={(v) => setMail('enabled', v)} label={n.email.enabled ? 'On' : 'Off'} />}
      >
        <div className="set-row">
          <Field label="SMTP server" className="grow">
            <input value={n.email.host} onChange={(e) => setMail('host', e.target.value)} placeholder="smtp.gmail.com" spellCheck={false} />
          </Field>
          <Field label="Port">
            <NumberInput min="1" max="65535" value={n.email.port} onChange={(v) => setMail('port', v)} className="narrow" />
          </Field>
        </div>
        <Field label="Security">
          <select
            value={n.email.security}
            onChange={(e) => {
              const s = SECURITY.find((x) => x.value === e.target.value);
              const usual = SECURITY.some((x) => x.port === Number(n.email.port));
              set('notifications', { ...n, email: { ...n.email, security: s.value, port: usual ? s.port : n.email.port } });
            }}
          >
            {SECURITY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <div className="set-row">
          <Field label="User name" className="grow">
            <input value={n.email.user} onChange={(e) => setMail('user', e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field
            label="Password"
            className="grow"
            hint={
              n.email.hasPassword && !passwordTyped ? (
                <>Saved. Leave empty to keep it, or <button type="button" className="link" onClick={() => setN('email', { ...n.email, password: '', hasPassword: false })}>remove it</button>.</>
              ) : 'For Gmail and Outlook use an app password.'
            }
          >
            <input
              type="password"
              value={n.email.password ?? ''}
              placeholder={n.email.hasPassword ? '••••••••' : ''}
              autoComplete="new-password"
              onChange={(e) => setMail('password', e.target.value)}
            />
          </Field>
        </div>
        <div className="set-row">
          <Field label="From" className="grow" hint="Empty = the user name.">
            <input value={n.email.from} onChange={(e) => setMail('from', e.target.value)} placeholder="handbrake@example.com" spellCheck={false} />
          </Field>
          <Field label="To" className="grow" hint="Several addresses: separate with commas.">
            <input value={n.email.to} onChange={(e) => setMail('to', e.target.value)} placeholder="me@example.com" spellCheck={false} />
          </Field>
        </div>
        <p className="set-hint">The password is stored on the server and included in backups; it is never sent back to the browser.</p>
        <div className="set-actions">
          <button type="button" className="btn small" onClick={() => test('email')} disabled={!n.email.host || !n.email.to || !!testing}>
            <Send size={14} /> {testing === 'email' ? 'Sending…' : 'Send a test e-mail'}
          </button>
        </div>
      </Card>

      <BrowserCard />

      <Card title="Recently sent">
        {recent.length ? (
          <ul className="activity-list">
            {recent.map((r, i) => (
              <li key={i} title={r.error ?? r.title}>
                {r.ok ? <CheckCircle2 size={14} className="text-good" /> : <TriangleAlert size={14} className="text-bad" />}
                <span className="file-name">{r.title}</span>
                <span className={`small ${r.ok ? 'muted' : 'text-bad'}`}>
                  {r.channel === 'email' ? 'e-mail' : 'webhook'} · {r.ok ? ago(r.at) : r.error}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="set-hint">Nothing sent since the server started.</p>
        )}
      </Card>
    </>
  );
}

/** Desktop notifications from this browser: stored in the browser, not on the server. */
function BrowserCard() {
  const { prefs, setPrefs, permission, enable } = useBrowserNotifyPrefs();
  const supported = browserNotifySupported();
  return (
    <Card
      title={<><BellRing size={15} /> This browser</>}
      aside={
        supported && permission !== 'denied' ? (
          <Switch
            checked={prefs.enabled && permission === 'granted'}
            onChange={(v) => (v ? enable() : setPrefs((p) => ({ ...p, enabled: false })))}
            label={prefs.enabled && permission === 'granted' ? 'On' : 'Off'}
          />
        ) : null
      }
    >
      <p className="set-hint">
        The tab title always shows the progress (“42% · Show S01e02.mkv”). Desktop notifications appear when this tab is in the
        background. These choices are kept in this browser only.
      </p>
      {!supported ? (
        <p className="warn-text">
          <TriangleAlert size={13} /> Browsers allow desktop notifications only on https:// pages or localhost. Open the app through
          an https reverse proxy to use them, or use e-mail or a webhook.
        </p>
      ) : permission === 'denied' ? (
        <p className="warn-text"><TriangleAlert size={13} /> Notifications are blocked for this site in the browser’s settings.</p>
      ) : (
        <div className="set-grid-2">
          {BROWSER_EVENTS.map((e) => (
            <Check
              key={e.id}
              disabled={!prefs.enabled}
              checked={prefs.events[e.id]}
              onChange={(v) => setPrefs((p) => ({ ...p, events: { ...p.events, [e.id]: v } }))}
            >
              {e.label}
            </Check>
          ))}
        </div>
      )}
    </Card>
  );
}
