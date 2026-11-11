import { Card, Field, ListInput } from './fields.jsx';
import { t } from '../i18n/index.js';
import { CODESETS, COPY_MODES, EMBED_MODES } from '../subtitles/modes.js';

function Radios({ name, modes, value, onChange }) {
  return (
    <div className="set-radios">
      {modes.map((m) => (
        <label key={m.value} className="radio">
          <input type="radio" name={name} checked={value === m.value} onChange={() => onChange(m.value)} />
          <span>
            {t(m.labelKey)}
            <span className="muted small">{t(m.hintKey)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Sidecar subtitle files: what happens to them by default (the queue and each job can change it). */
export function SubtitlesSection({ draft, set }) {
  return (
    <>
      <Card title={t('settings.subtitles.embedTitle')} help="settings.subtitles">
        <p className="set-hint">{t('settings.subtitles.intro')}</p>
        <Radios name="subEmbed" modes={EMBED_MODES} value={draft.subtitleEmbed} onChange={(v) => set('subtitleEmbed', v)} />
      </Card>
      <Card title={t('settings.subtitles.copyTitle')}>
        <Radios name="subCopy" modes={COPY_MODES} value={draft.subtitleCopy} onChange={(v) => set('subtitleCopy', v)} />
        <p className="set-hint">{t('settings.subtitles.copyNames')}</p>
      </Card>
      <Card title={t('settings.subtitles.findTitle')}>
        <Field label={t('settings.subtitles.extensions')} hint={t('settings.subtitles.extensionsHint')}>
          <ListInput value={draft.subtitleExtensions} onChange={(v) => set('subtitleExtensions', v)} placeholder="srt, ass" />
        </Field>
        <Field label={t('settings.subtitles.codeset')} hint={t('settings.subtitles.codesetHint')}>
          <select value={draft.subtitleCodeset} onChange={(e) => set('subtitleCodeset', e.target.value)}>
            {CODESETS.filter((c) => c.value !== 'UTF-8').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
      </Card>
    </>
  );
}
