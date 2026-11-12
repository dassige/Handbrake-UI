import { useCallback, useEffect, useState } from 'react';
import App from '../App.jsx';
import { api, AUTH_EVENT } from '../api.js';
import { LoginPage } from './LoginPage.jsx';

/**
 * Shows the login page while login is on and this browser is not signed in, else the app.
 * Checks again whenever api.js signals that the sign-in state may have changed.
 */
export function AuthGate() {
  const [status, setStatus] = useState(null); // null while loading
  // Bumped on signing in, so the app starts afresh (data and event stream).
  const [generation, setGeneration] = useState(0);

  const check = useCallback(
    () =>
      api.authStatus().then(setStatus, () =>
        // Unreachable, or a server from before login existed: show the app (it shows "offline").
        setStatus((s) => s ?? { enabled: false, via: 'open', unknown: true }),
      ),
    [],
  );
  useEffect(() => {
    check();
    window.addEventListener(AUTH_EVENT, check);
    return () => window.removeEventListener(AUTH_EVENT, check);
  }, [check]);

  if (!status) return null;
  if (status.enabled && !status.via) {
    return (
      <LoginPage
        onSignedIn={(s) => {
          setStatus(s);
          setGeneration((g) => g + 1);
        }}
      />
    );
  }
  return <App key={generation} auth={status} onAuthChange={setStatus} />;
}
