import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGate } from './auth/AuthGate.jsx';
import { DialogProvider } from './components/Dialogs.jsx';
import { initLanguage, useLanguage } from './i18n/index.js';
import './styles.css';

/** Re-renders the whole app when the language changes (no component is memoised, so all of them follow). */
function Root() {
  useLanguage();
  return (
    <DialogProvider>
      <AuthGate />
    </DialogProvider>
  );
}

// Load the language used last time first, so the app doesn't flash in English.
initLanguage().finally(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
});
