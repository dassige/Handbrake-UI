import { Card } from './fields.jsx';
import { browserLanguage, LANGUAGES, t } from '../i18n/index.js';

const nativeName = (code) => LANGUAGES.find((l) => l.code === code)?.name ?? code;

/** The web app's language: one for everyone, or 'auto' so that each browser uses its own. */
export function LanguageSection({ draft, set }) {
  const value = draft.language ?? 'auto';
  return (
    <Card title={t('settings.language.title')} help="settings.language">
      <div className="set-radios">
        <label className="radio">
          <input type="radio" name="language" checked={value === 'auto'} onChange={() => set('language', 'auto')} />
          <span>
            {t('settings.language.auto')}
            <span className="muted small">{t('settings.language.autoHint', { language: nativeName(browserLanguage()) })}</span>
          </span>
        </label>
        {LANGUAGES.map((l) => (
          // Each language is listed in its own name, so it can be found whatever the app is showing now.
          <label key={l.code} className="radio" lang={l.code}>
            <input type="radio" name="language" checked={value === l.code} onChange={() => set('language', l.code)} />
            <span>{l.name}</span>
          </label>
        ))}
      </div>
      <p className="set-hint">{t('settings.language.hint')}</p>
    </Card>
  );
}
