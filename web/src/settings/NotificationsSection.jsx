import { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Mail, Plus, Send, Trash2, TriangleAlert, Webhook } from 'lucide-react';
import { api } from '../api.js';
import { ago } from '../format.js';
import { BROWSER_EVENTS, browserNotifySupported, useBrowserNotifyPrefs } from '../attention.js';
import { rich, t } from '../i18n/index.js';
import { Card, Check, Field, NumberInput, Switch } from './fields.jsx';

const EVENTS = [
  { id: 'queueFinished', labelKey: 'settings.notifications.events.queueFinished', hintKey: 'settings.notifications.events.queueFinishedHint' },
  { id: 'jobFailed', labelKey: 'settings.notifications.events.jobFailed' },
  { id: 'checkFailed', labelKey: 'settings.notifications.events.checkFailed' },
  { id: 'jobDone', labelKey: 'settings.notifications.events.jobDone', hintKey: 'settings.notifications.events.jobDoneHint' },
  { id: 'watchAdded', labelKey: 'settings.notifications.events.watchAdded' },
  { id: 'backupFailed', labelKey: 'settings.notifications.events.backupFailed' },
];
// Browser events (attention.js) use the same ids, so they share these labels.
const eventLabel = (id) => t(`settings.notifications.events.${id}`);

const SECURITY = [
  { value: 'starttls', labelKey: 'settings.notifications.securityOption.starttls', port: 587 },
  { value: 'tls', labelKey: 'settings.notifications.securityOption.tls', port: 465 },
  { value: 'none', labelKey: 'settings.notifications.securityOption.none', port: 25 },
];

// What the server sends (always in English).
const EXAMPLE = `{
  "app": "EncForge",
  "event": "jobFailed",
  "title": "Conversion failed: Show S01E02.mkv",
  "message": "…",
  "url": "http://…:8095",
  "at": "2026-11-10T21:04:11.000Z",
  "data": { "id": 42, "tag": null, "source": "…", "output": "…", "error": "…" }
}`;

/** For a test: the unsaved settings, with the password only when one was typed. */
function forTest(n) {
  const { hasPassword, ...email } = n.email;
  return { ...n, email };
}

export function NotificationsSection({ draft, set, run }) {
  const n = draft.notifications;
  const setN = (k, v) => set('notifications', { ...n, [k]: v });
  const hooks = n.webhooks ?? [];
  const setHook = (i, patch) => setN('webhooks', hooks.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const addHook = () =>
    setN('webhooks', [
      ...hooks,
      {
        id: `webhook-${Date.now().toString(36)}`,
        name: t('settings.notifications.webhookName', { number: hooks.length + 1 }),
        enabled: true,
        url: '',
        headers: '',
        events: null,
      },
    ]);
  const setMail = (k, v) => setN('email', { ...n.email, [k]: v });
  const [recent, setRecent] = useState([]);
  const [testing, setTesting] = useState(null);

  const loadRecent = useCallback(() => api.recentNotifications().then(setRecent, () => {}), []);
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  /** channel 'email', or a webhook's index. */
  async function test(target) {
    setTesting(target);
    if (target === 'email') await run(() => api.testNotification('email', forTest(n)), t('settings.notifications.testEmailSent'));
    else {
      const h = hooks[target];
      // By position: the row may not be saved yet.
      await run(
        () => api.testNotification('webhook', forTest(n), `#${target}`),
        h.name ? t('settings.notifications.testSentTo', { name: h.name }) : t('settings.notifications.testSentWebhook'),
      );
    }
    setTesting(null);
    loadRecent();
  }

  const anyChannel = hooks.some((h) => h.enabled) || n.email.enabled;
  const passwordTyped = typeof n.email.password === 'string';
  const onOff = (on) => (on ? t('common.on') : t('common.off'));

  return (
    <>
      <Card title={t('settings.notifications.eventsTitle')} help="settings.notifications">
        <p className="set-hint">{t('settings.notifications.eventsHint')}</p>
        <div className="set-grid-2">
          {EVENTS.map((e) => (
            <Check key={e.id} checked={n.events[e.id]} onChange={(v) => setN('events', { ...n.events, [e.id]: v })} hint={e.hintKey && t(e.hintKey)}>
              {t(e.labelKey)}
            </Check>
          ))}
        </div>
        {!anyChannel && <p className="set-hint">{t('settings.notifications.noChannel')}</p>}
        <Field label={t('settings.notifications.appUrl')}>
          <div className="inline-form">
            <input value={n.appUrl} onChange={(e) => setN('appUrl', e.target.value)} placeholder="http://my-server:8095" spellCheck={false} />
            <button type="button" className="btn small" onClick={() => setN('appUrl', location.origin)}>{t('settings.notifications.useThisPage')}</button>
          </div>
        </Field>
      </Card>

      <Card
        title={<><Webhook size={15} /> {t('settings.notifications.webhooks')}</>}
        aside={
          <button type="button" className="btn small" onClick={addHook} disabled={hooks.length >= 10}>
            <Plus size={14} /> {t('settings.notifications.addWebhook')}
          </button>
        }
      >
        <p className="set-hint">{t('settings.notifications.webhooksHint')}</p>
        {hooks.length === 0 && <p className="set-hint">{t('settings.notifications.noWebhooks')}</p>}
        <div className="hook-list">
          {hooks.map((h, i) => (
            <div key={h.id ?? i} className={`hook ${h.enabled ? '' : 'off'}`}>
              <div className="hook-head">
                <input
                  className="hook-name"
                  value={h.name}
                  maxLength={40}
                  onChange={(e) => setHook(i, { name: e.target.value })}
                  aria-label={t('settings.notifications.webhookNameLabel', { number: i + 1 })}
                  placeholder={t('settings.notifications.webhookName', { number: i + 1 })}
                />
                <Switch checked={h.enabled} onChange={(v) => setHook(i, { enabled: v })} label={onOff(h.enabled)} />
                <button
                  type="button"
                  className="icon-btn danger"
                  title={t('settings.notifications.removeWebhook')}
                  aria-label={h.name ? t('settings.notifications.removeNamed', { name: h.name }) : t('settings.notifications.removeNumbered', { number: i + 1 })}
                  onClick={() => setN('webhooks', hooks.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <Field label={t('settings.notifications.url')}>
                <input value={h.url} onChange={(e) => setHook(i, { url: e.target.value })} placeholder="https://n8n.local/webhook/handbrake" spellCheck={false} />
              </Field>
              <Field label={t('settings.notifications.headers')} hint={t('settings.notifications.headersHint')}>
                <textarea rows={2} value={h.headers} onChange={(e) => setHook(i, { headers: e.target.value })} spellCheck={false} className="mono" />
              </Field>
              <Field
                label={t('settings.notifications.secret')}
                hint={
                  h.hasSecret && typeof h.secret !== 'string'
                    ? rich('settings.notifications.secretSaved', {
                      remove: (
                        <button type="button" className="link" onClick={() => setHook(i, { secret: '', hasSecret: false })}>
                          {t('settings.notifications.passwordRemove')}
                        </button>
                      ),
                    })
                    : rich('settings.notifications.secretHint')
                }
              >
                <input
                  type="password"
                  value={h.secret ?? ''}
                  placeholder={h.hasSecret ? '••••••••' : ''}
                  autoComplete="new-password"
                  maxLength={200}
                  onChange={(e) => setHook(i, { secret: e.target.value })}
                />
              </Field>
              <div className="set-radios hook-events">
                <label className="radio">
                  <input type="radio" name={`hook-ev-${i}`} checked={!h.events} onChange={() => setHook(i, { events: null })} />
                  <span>{t('settings.notifications.eventsAll')}</span>
                </label>
                <label className="radio">
                  <input type="radio" name={`hook-ev-${i}`} checked={!!h.events} onChange={() => setHook(i, { events: { ...n.events } })} />
                  <span>{t('settings.notifications.eventsOnly')}</span>
                </label>
                {h.events && (
                  <div className="set-grid-2 hook-event-list">
                    {EVENTS.map((e) => (
                      <Check key={e.id} checked={h.events[e.id]} onChange={(v) => setHook(i, { events: { ...h.events, [e.id]: v } })}>
                        {t(e.labelKey)}
                      </Check>
                    ))}
                  </div>
                )}
              </div>
              <div className="set-actions">
                <button type="button" className="btn small" onClick={() => test(i)} disabled={!h.url || testing != null}>
                  <Send size={14} /> {testing === i ? t('settings.notifications.sending') : t('settings.notifications.sendTest')}
                </button>
              </div>
            </div>
          ))}
        </div>
        <details className="set-details">
          <summary>{t('settings.notifications.whatIsSent')}</summary>
          <pre className="code-block">{EXAMPLE}</pre>
        </details>
      </Card>

      <Card
        title={<><Mail size={15} /> {t('settings.notifications.email')}</>}
        aside={<Switch checked={n.email.enabled} onChange={(v) => setMail('enabled', v)} label={onOff(n.email.enabled)} />}
      >
        <div className="set-row">
          <Field label={t('settings.notifications.smtpServer')} className="grow">
            <input value={n.email.host} onChange={(e) => setMail('host', e.target.value)} placeholder="smtp.gmail.com" spellCheck={false} />
          </Field>
          <Field label={t('settings.notifications.port')}>
            <NumberInput min="1" max="65535" value={n.email.port} onChange={(v) => setMail('port', v)} className="narrow" />
          </Field>
        </div>
        <Field label={t('settings.notifications.security')}>
          <select
            value={n.email.security}
            onChange={(e) => {
              const s = SECURITY.find((x) => x.value === e.target.value);
              const usual = SECURITY.some((x) => x.port === Number(n.email.port));
              set('notifications', { ...n, email: { ...n.email, security: s.value, port: usual ? s.port : n.email.port } });
            }}
          >
            {SECURITY.map((s) => <option key={s.value} value={s.value}>{t(s.labelKey)}</option>)}
          </select>
        </Field>
        <div className="set-row">
          <Field label={t('settings.notifications.user')} className="grow">
            <input value={n.email.user} onChange={(e) => setMail('user', e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field
            label={t('settings.notifications.password')}
            className="grow"
            hint={
              n.email.hasPassword && !passwordTyped ? (
                rich('settings.notifications.passwordSaved', {
                  remove: (
                    <button type="button" className="link" onClick={() => setN('email', { ...n.email, password: '', hasPassword: false })}>
                      {t('settings.notifications.passwordRemove')}
                    </button>
                  ),
                })
              ) : t('settings.notifications.passwordHint')
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
          <Field label={t('settings.notifications.from')} className="grow" hint={t('settings.notifications.fromHint')}>
            <input value={n.email.from} onChange={(e) => setMail('from', e.target.value)} placeholder="handbrake@example.com" spellCheck={false} />
          </Field>
          <Field label={t('settings.notifications.to')} className="grow" hint={t('settings.notifications.toHint')}>
            <input value={n.email.to} onChange={(e) => setMail('to', e.target.value)} placeholder="me@example.com" spellCheck={false} />
          </Field>
        </div>
        <p className="set-hint">{t('settings.notifications.passwordStored')}</p>
        <div className="set-actions">
          <button type="button" className="btn small" onClick={() => test('email')} disabled={!n.email.host || !n.email.to || testing != null}>
            <Send size={14} /> {testing === 'email' ? t('settings.notifications.sending') : t('settings.notifications.sendTestEmail')}
          </button>
        </div>
      </Card>

      <BrowserCard />

      <Card title={t('settings.notifications.recentTitle')}>
        {recent.length ? (
          <ul className="activity-list">
            {recent.map((r, i) => (
              <li key={i} title={r.error ?? r.title}>
                {r.ok ? <CheckCircle2 size={14} className="text-good" /> : <TriangleAlert size={14} className="text-bad" />}
                <span className="file-name">{r.title}</span>
                <span className={`small ${r.ok ? 'muted' : 'text-bad'}`}>
                  {r.channel === 'email' ? t('settings.notifications.channelEmail') : r.target ?? t('settings.notifications.channelWebhook')} · {r.ok ? ago(r.at) : r.error}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="set-hint">{t('settings.notifications.nothingSent')}</p>
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
      title={<><BellRing size={15} /> {t('settings.notifications.browser')}</>}
      aside={
        supported && permission !== 'denied' ? (
          <Switch
            checked={prefs.enabled && permission === 'granted'}
            onChange={(v) => (v ? enable() : setPrefs((p) => ({ ...p, enabled: false })))}
            label={prefs.enabled && permission === 'granted' ? t('common.on') : t('common.off')}
          />
        ) : null
      }
    >
      <p className="set-hint">{t('settings.notifications.browserHint')}</p>
      {!supported ? (
        <p className="warn-text">
          <TriangleAlert size={13} /> {t('settings.notifications.browserUnsupported')}
        </p>
      ) : permission === 'denied' ? (
        <p className="warn-text"><TriangleAlert size={13} /> {t('settings.notifications.browserBlocked')}</p>
      ) : (
        <div className="set-grid-2">
          {BROWSER_EVENTS.map((e) => (
            <Check
              key={e.id}
              disabled={!prefs.enabled}
              checked={prefs.events[e.id]}
              onChange={(v) => setPrefs((p) => ({ ...p, events: { ...p.events, [e.id]: v } }))}
            >
              {eventLabel(e.id)}
            </Check>
          ))}
        </div>
      )}
    </Card>
  );
}
