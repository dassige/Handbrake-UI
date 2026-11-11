import { useState } from 'react';
import { Captions } from 'lucide-react';
import { api } from '../api.js';
import { Modal } from '../components/Modal.jsx';
import { Help } from '../help/Help.jsx';
import { t } from '../i18n/index.js';
import { COPY_MODES, EMBED_MODES, copyLabel, embedLabel } from './modes.js';

/**
 * The queue's subtitle choice: applies to every job (queued now or added later) that has no
 * choice of its own, instead of the one in Settings.
 */
export function QueueSubtitlesButton({ settings, run }) {
  const [open, setOpen] = useState(false);
  const q = settings?.queueSubtitles ?? {};
  const custom = !!(q.embed || q.copy);
  return (
    <>
      <button
        type="button"
        className={`btn ghost small ${custom ? 'active-tool' : ''}`}
        title={custom ? t('subtitles.queue.titleCustom', { embed: embedLabel(q.embed ?? settings.subtitleEmbed), copy: copyLabel(q.copy ?? settings.subtitleCopy) }) : t('subtitles.queue.title')}
        onClick={() => setOpen(true)}
        disabled={!settings}
      >
        <Captions size={14} /> {t('subtitles.queue.button')}
        {custom && <span className="unsaved-dot" />}
      </button>
      {open && <QueueSubtitlesDialog settings={settings} run={run} onClose={() => setOpen(false)} />}
    </>
  );
}

function QueueSubtitlesDialog({ settings, run, onClose }) {
  const [embed, setEmbed] = useState(settings.queueSubtitles?.embed ?? '');
  const [copy, setCopy] = useState(settings.queueSubtitles?.copy ?? '');
  async function save() {
    const r = await run(() => api.saveSettings({ queueSubtitles: { embed: embed || null, copy: copy || null } }), t('subtitles.queue.saved'));
    if (r) onClose();
  }
  return (
    <Modal
      title={<>{t('subtitles.queue.dialogTitle')}<Help id="subtitles.queue" /></>}
      ariaLabel={t('subtitles.queue.dialogTitle')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => { setEmbed(''); setCopy(''); }}>{t('subtitles.queue.useSettings')}</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={save}>{t('common.save')}</button>
        </>
      }
    >
      <p className="muted small">{t('subtitles.queue.intro')}</p>
      <label className="set-field">
        <span className="set-label">{t('subtitles.job.embed')}</span>
        <select value={embed} onChange={(e) => setEmbed(e.target.value)}>
          <option value="">{t('subtitles.followSettings', { mode: embedLabel(settings.subtitleEmbed) })}</option>
          {EMBED_MODES.map((m) => <option key={m.value} value={m.value}>{t(m.labelKey)}</option>)}
        </select>
      </label>
      <label className="set-field">
        <span className="set-label">{t('subtitles.job.copy')}</span>
        <select value={copy} onChange={(e) => setCopy(e.target.value)}>
          <option value="">{t('subtitles.followSettings', { mode: copyLabel(settings.subtitleCopy) })}</option>
          {COPY_MODES.map((m) => <option key={m.value} value={m.value}>{t(m.labelKey)}</option>)}
        </select>
      </label>
      <p className="muted small">{t('subtitles.queue.jobsKeep')}</p>
    </Modal>
  );
}
