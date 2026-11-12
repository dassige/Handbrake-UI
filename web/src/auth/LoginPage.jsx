import { useState } from 'react';
import { LogIn } from 'lucide-react';
import { api } from '../api.js';
import { t } from '../i18n/index.js';
import { errorText } from '../i18n/serverText.js';

/** Shown instead of the app while login is on and this browser is not signed in. */
export function LoginPage({ onSignedIn }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(password));
    } catch (err) {
      setError(errorText(err));
      setPassword('');
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <img src="/icon-192.png" alt="" width={40} height={40} />
          <h1>EncForge</h1>
        </div>
        <p className="muted">{t('auth.login.prompt')}</p>
        {/* For password managers: the app has a single password, no user names. */}
        <input type="text" name="username" autoComplete="username" value="EncForge" readOnly hidden />
        <label className="set-field">
          <span className="set-label">{t('auth.login.password')}</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <p className="text-bad small" role="alert">{error}</p>}
        <button type="submit" className="btn primary" disabled={busy || !password}>
          <LogIn size={15} /> {busy ? t('auth.login.signingIn') : t('auth.login.signIn')}
        </button>
        <p className="muted small">{t('auth.login.forgot')}</p>
      </form>
    </main>
  );
}
