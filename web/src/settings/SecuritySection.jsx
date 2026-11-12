import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, LogOut, Monitor, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { ago, dateTime } from '../format.js';
import { rich, t } from '../i18n/index.js';
import { useDialogs } from '../components/Dialogs.jsx';
import { Card, Field, Switch } from './fields.jsx';

// What each API key scope allows; labels: settings.security.scope.<id>, settings.security.scopeHint.<id>.
const SCOPES = ['read', 'queue', 'admin'];
const MIN_PASSWORD = 8;

/**
 * Enter in a text box would submit the settings form around this section (and "save" nothing):
 * run this section's own action instead.
 */
const onEnter = (fn) => (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    fn();
  }
};

/** "Firefox on Windows" from a user agent, roughly; the whole string is in the tooltip. */
function browserName(ua) {
  if (!ua) return t('settings.security.unknownBrowser');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  if (browser && os) return t('settings.security.browserOn', { browser, os });
  return browser ?? os ?? ua.slice(0, 40);
}

/**
 * Settings → Security: login for the web app and API keys for other programs. Nothing here is
 * part of the settings form: every change is saved at once (server/src/auth.js).
 */
export function SecuritySection({ auth, onAuthChange, run, onError }) {
  const dialogs = useDialogs();
  const [keys, setKeys] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [newKey, setNewKey] = useState({ name: '', scope: 'queue' });
  const [created, setCreated] = useState(null); // { key, token } just made: the only time the token is shown
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.apiKeys().then(setKeys, onError);
    api.authSessions().then(setSessions, () => setSessions([]));
  }, [onError]);
  // Reloads whenever the status changes (AuthGate checks it again when another browser changes something).
  useEffect(() => {
    load();
  }, [load, auth]);

  /** Runs an auth call; returns its result, or undefined after showing the error. */
  async function call(fn, success) {
    setBusy(true);
    try {
      return await run(fn, success);
    } finally {
      setBusy(false);
    }
  }

  const passwordSet = !!auth?.passwordSet;
  const needCurrent = passwordSet && !auth?.forcedOff;
  const pwProblem = pw.next.length < MIN_PASSWORD ? t('settings.security.tooShort', { count: MIN_PASSWORD })
    : pw.next !== pw.repeat ? t('settings.security.noMatch') : null;

  async function savePassword() {
    if (pwProblem || (needCurrent && !pw.current) || busy) return;
    const r = await call(() => api.setPassword(needCurrent ? pw.current : undefined, pw.next), passwordSet ? t('settings.security.passwordChanged') : t('settings.security.passwordSet'));
    if (r) {
      setPw({ current: '', next: '', repeat: '' });
      onAuthChange(r);
    }
  }

  async function setRequired(enabled) {
    const ok = await dialogs.confirm(
      enabled
        ? { title: t('settings.security.turnOnTitle'), message: t('settings.security.turnOnMessage'), confirmLabel: t('settings.security.turnOn') }
        : { title: t('settings.security.turnOffTitle'), message: t('settings.security.turnOffMessage'), confirmLabel: t('settings.security.turnOff'), danger: true },
    );
    if (!ok) return;
    const r = await call(() => api.setLoginRequired(enabled), enabled ? t('settings.security.isOn') : t('settings.security.isOff'));
    if (r) onAuthChange(r);
  }

  async function signOutOthers() {
    const r = await call(() => api.signOutOthers(), (x) => t('settings.security.signedOutOthers', { count: x.removed }));
    if (r) setSessions((list) => list.filter((s) => s.current));
  }

  async function createKey() {
    if (!newKey.name.trim() || busy) return;
    const r = await call(() => api.createApiKey(newKey.name.trim(), newKey.scope));
    if (r) {
      setCreated(r);
      setNewKey({ name: '', scope: newKey.scope });
      load();
    }
  }

  async function deleteKey(k) {
    const ok = await dialogs.confirm({
      title: t('settings.security.revokeTitle'),
      message: t('settings.security.revokeMessage', { name: k.name }),
      confirmLabel: t('settings.security.revoke'),
      danger: true,
    });
    if (!ok) return;
    if (await call(() => api.deleteApiKey(k.id), t('settings.security.revoked', { name: k.name }))) {
      if (created?.key.id === k.id) setCreated(null);
      load();
    }
  }

  const others = sessions.filter((s) => !s.current).length;

  return (
    <>
      <Card
        title={t('settings.security.loginTitle')}
        help="settings.security"
        aside={
          <Switch
            checked={auth?.forcedOff ? auth.savedEnabled : auth?.enabled}
            disabled={busy || auth?.forcedOff || (!passwordSet && !auth?.enabled)}
            onChange={setRequired}
            label={auth?.enabled ? t('common.on') : t('common.off')}
          />
        }
      >
        {auth?.forcedOff ? (
          <p className="warn-box"><ShieldAlert size={15} /> <span>{rich('settings.security.forcedOff')}</span></p>
        ) : auth?.enabled ? (
          <p className="set-hint">{t('settings.security.onHint')}</p>
        ) : (
          <p className="warn-box"><ShieldAlert size={15} /> <span>{passwordSet ? t('settings.security.offHint') : t('settings.security.offNoPassword')}</span></p>
        )}

        <div className="set-subhead">{passwordSet ? t('settings.security.changePassword') : t('settings.security.setPassword')}</div>
        {/* For password managers: the app has a single password, no user names. */}
        <input type="text" name="username" autoComplete="username" value="EncForge" readOnly hidden />
        <div className="set-row">
          {needCurrent && (
            <Field label={t('settings.security.current')}>
              <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} onKeyDown={onEnter(savePassword)} />
            </Field>
          )}
          <Field label={t('settings.security.new')}>
            <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} onKeyDown={onEnter(savePassword)} />
          </Field>
          <Field label={t('settings.security.repeat')}>
            <input type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} onKeyDown={onEnter(savePassword)} />
          </Field>
        </div>
        <p className="set-hint">
          {pw.next && pwProblem ? <span className="text-bad">{pwProblem}</span> : t('settings.security.passwordHint', { count: MIN_PASSWORD })}
        </p>
        <div className="set-actions">
          <button type="button" className="btn small" onClick={savePassword} disabled={busy || !!pwProblem || (needCurrent && !pw.current)}>
            <KeyRound size={14} /> {passwordSet ? t('settings.security.changePassword') : t('settings.security.setPassword')}
          </button>
        </div>

        {auth?.enabled && sessions.length > 0 && (
          <>
            <div className="set-subhead">{t('settings.security.browsers')}</div>
            <ul className="backup-list">
              {sessions.map((s, i) => (
                <li key={i}>
                  <Monitor size={15} className="muted" />
                  <span className="file-name" title={s.userAgent ?? ''}>
                    {browserName(s.userAgent)}
                    {s.current && <span className="nav-on">{t('settings.security.thisBrowser')}</span>}
                  </span>
                  <span className="muted small" title={dateTime(s.lastSeenAt)}>
                    {s.ip ? `${s.ip} · ` : ''}{t('settings.security.lastSeen', { ago: ago(s.lastSeenAt) })}
                  </span>
                </li>
              ))}
            </ul>
            <div className="set-actions">
              <button type="button" className="btn small" onClick={signOutOthers} disabled={busy || others === 0}>
                <LogOut size={14} /> {t('settings.security.signOutOthers')}
              </button>
            </div>
          </>
        )}
      </Card>

      <Card title={t('settings.security.keysTitle')} help="settings.apiKeys">
        <p className="set-hint">{rich('settings.security.keysHint')}</p>
        {!auth?.enabled && <p className="set-hint">{t('settings.security.keysOptional')}</p>}

        {created && (
          <div className="key-created" role="status">
            <p><strong>{t('settings.security.createdTitle', { name: created.key.name })}</strong></p>
            <p className="set-hint">{t('settings.security.createdHint')}</p>
            <div className="inline-form">
              <input className="mono" value={created.token} readOnly onFocus={(e) => e.target.select()} aria-label={t('settings.security.keyLabel')} />
              {navigator.clipboard && (
                <button type="button" className="btn small" onClick={() => run(() => navigator.clipboard.writeText(created.token), t('settings.security.copied'))}>
                  <Copy size={14} /> {t('common.copy')}
                </button>
              )}
              <button type="button" className="btn small" onClick={() => setCreated(null)}>{t('common.done')}</button>
            </div>
          </div>
        )}

        {keys?.length === 0 && <p className="set-hint">{t('settings.security.noKeys')}</p>}
        {keys?.length > 0 && (
          <ul className="backup-list">
            {keys.map((k) => (
              <li key={k.id}>
                <KeyRound size={15} className="muted" />
                <span className="file-name">
                  {k.name} <span className="muted small mono">{k.prefix}…</span>
                </span>
                <span className={`scope-tag scope-${k.scope}`}>{t(`settings.security.scope.${k.scope}`)}</span>
                <span className="muted small" title={k.lastUsedAt ? `${dateTime(k.lastUsedAt)}${k.lastUsedIp ? ` · ${k.lastUsedIp}` : ''}` : undefined}>
                  {k.lastUsedAt ? t('settings.security.used', { ago: ago(k.lastUsedAt) }) : t('settings.security.neverUsed')}
                </span>
                <button type="button" className="icon-btn danger" title={t('settings.security.revoke')} aria-label={t('settings.security.revokeNamed', { name: k.name })} onClick={() => deleteKey(k)}>
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="set-subhead">{t('settings.security.newKey')}</div>
        <div className="set-row">
          <Field label={t('common.name')}>
            <input
              value={newKey.name}
              maxLength={40}
              placeholder={t('settings.security.namePlaceholder')}
              onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
              onKeyDown={onEnter(createKey)}
            />
          </Field>
          <Field label={t('settings.security.access')}>
            <select value={newKey.scope} onChange={(e) => setNewKey({ ...newKey, scope: e.target.value })}>
              {SCOPES.map((s) => <option key={s} value={s}>{t(`settings.security.scope.${s}`)}</option>)}
            </select>
          </Field>
        </div>
        <p className="set-hint">{t(`settings.security.scopeHint.${newKey.scope}`)}</p>
        <div className="set-actions">
          <button type="button" className="btn small" onClick={createKey} disabled={busy || !newKey.name.trim()}>
            <Plus size={14} /> {t('settings.security.create')}
          </button>
        </div>
      </Card>
    </>
  );
}
