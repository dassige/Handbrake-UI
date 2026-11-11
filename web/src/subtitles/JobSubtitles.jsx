import { useEffect, useState } from 'react';
import { AlertTriangle, Captions, Download, PenLine, RefreshCw, Save } from 'lucide-react';
import { api } from '../api.js';
import { fileName } from '../format.js';
import { Help } from '../help/Help.jsx';
import { t } from '../i18n/index.js';
import { langName, languageOptions } from './languages.js';
import { COPY_MODES, EMBED_MODES, containerName, copyLabel, embedLabel, inherited, isEdited, TEXT_FORMATS } from './modes.js';
import { SubtitleEditor } from './SubtitleEditor.jsx';

/** "Embed + copy", "Embed", "Copy" or "Not used", with why it is (not) embedded as a tooltip. */
function Action({ file }) {
  const what = file.embed && file.copy ? 'both' : file.embed ? 'embed' : file.copy ? 'copy' : 'none';
  return (
    <span className={`badge sub-action ${what}`} title={t(`subtitles.why.${file.why}`)}>
      {t(`subtitles.action.${what}`)}
    </span>
  );
}

function ModeSelect({ label, value, modes, inheritedText, disabled, onChange }) {
  return (
    <label className="field-inline">
      {label}
      <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{inheritedText}</option>
        {modes.map((m) => <option key={m.value} value={m.value}>{t(m.labelKey)}</option>)}
      </select>
    </label>
  );
}

const ERROR_CODES = ['readFailed', 'muxFailed', 'copyFailed', 'prepareFailed'];

/** The Subtitles part of the job details: the sidecar files, what happens to them, the result. */
export function JobSubtitles({ job, settings, run }) {
  const [info, setInfo] = useState(null);
  const [editing, setEditing] = useState(null);
  const active = job.status === 'running' || job.status === 'paused';
  const locked = active;
  const inh = inherited(settings);
  // Reload when anything that changes the plan changes.
  const key = JSON.stringify([job.subtitles, job.subEmbed, job.subCopy, job.presetId, job.format, job.sourceInfo?.subtitles, settings?.queueSubtitles, settings?.subtitleEmbed, settings?.subtitleCopy]);

  useEffect(() => {
    let stop = false;
    if (job.subtitles == null) {
      setInfo(null);
      return undefined;
    }
    api.jobSubtitles(job.id).then((r) => !stop && setInfo(r), () => !stop && setInfo(null));
    return () => {
      stop = true;
    };
  }, [job.id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (patch, msg) => run(() => api.updateJobSubtitles(job.id, patch), msg).then((r) => r && setInfo(r));
  const setFile = (file, change) => save({ files: [{ path: file.path, ...change }] });
  const files = info?.files ?? [];
  const result = job.subtitleResult;
  const errors = (result?.errors ?? []).filter((e) => ERROR_CODES.includes(e.code));
  const editingFile = editing && files.find((f) => f.path === editing);
  const inheritedText = (from, label) => t(from === 'queue' ? 'subtitles.followQueue' : 'subtitles.followSettings', { mode: label });
  // Files the output format can't hold (from the server's plan), shown before the conversion.
  const blocked = files.filter((f) => f.why === 'container');
  const showBlocked = blocked.length > 0 && job.status !== 'done' && info?.effective?.embed !== 'never';
  const lost = info?.effective?.copy === 'never';

  return (
    <section>
      <h3>
        <Captions size={15} /> {t('subtitles.job.title')}
        <Help id="subtitles.job" />
      </h3>
      {job.subtitles == null ? (
        <p className="muted">{t('subtitles.job.notLooked')}</p>
      ) : !files.length ? (
        <p className="muted">{t('subtitles.job.none')}</p>
      ) : (
        <>
          <div className="sub-modes">
            <ModeSelect
              label={t('subtitles.job.embed')}
              value={job.subEmbed}
              modes={EMBED_MODES}
              inheritedText={inheritedText(inh.embedFrom, embedLabel(inh.embed))}
              disabled={locked}
              onChange={(v) => save({ embed: v })}
            />
            <ModeSelect
              label={t('subtitles.job.copy')}
              value={job.subCopy}
              modes={COPY_MODES}
              inheritedText={inheritedText(inh.copyFrom, copyLabel(inh.copy))}
              disabled={locked}
              onChange={(v) => save({ copy: v })}
            />
          </div>
          {showBlocked && (
            <p className={`small ${lost ? 'text-bad' : 'warn-text'}`}>
              <AlertTriangle size={13} />{' '}
              {t(lost ? 'subtitles.job.containerLost' : 'subtitles.job.containerCopied', {
                container: containerName(job.format) ?? job.format,
                names: blocked.map((f) => f.name).join(', '),
              })}
            </p>
          )}
          <ul className="sub-files">
            {files.map((f) => (
              <li key={f.path} className={f.include === false ? 'off' : ''}>
                <div className="sub-file-head">
                  <label className="check" title={t('subtitles.job.includeTitle')}>
                    <input type="checkbox" checked={f.include !== false} disabled={locked} onChange={(e) => setFile(f, { include: e.target.checked })} />
                    <code className="path" title={f.path}>{f.name}</code>
                  </label>
                  <Action file={f} />
                </div>
                <div className="sub-file-tools">
                  <select
                    value={f.lang ?? ''}
                    disabled={locked}
                    onChange={(e) => setFile(f, { lang: e.target.value || null })}
                    aria-label={t('subtitles.job.language')}
                    title={f.detected?.lang && f.detected.lang !== f.lang ? t('subtitles.job.detectedAs', { lang: langName(f.detected.lang) }) : t('subtitles.job.language')}
                  >
                    <option value="">{t('subtitles.job.unknownLanguage')}</option>
                    {languageOptions().map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                  </select>
                  <label className="check small" title={t('subtitles.job.forcedTitle')}>
                    <input type="checkbox" checked={!!f.forced} disabled={locked} onChange={(e) => setFile(f, { forced: e.target.checked })} />
                    {t('subtitles.job.forced')}
                  </label>
                  <label className="check small" title={t('subtitles.job.sdhTitle')}>
                    <input type="checkbox" checked={!!f.sdh} disabled={locked} onChange={(e) => setFile(f, { sdh: e.target.checked })} />
                    {t('subtitles.job.sdh')}
                  </label>
                  <span className="badge">{f.format.toUpperCase()}</span>
                  {isEdited(f.edits) && <span className="badge sub-edited">{t('subtitles.job.edited')}</span>}
                  <span className="spacer" />
                  {TEXT_FORMATS.includes(f.format) && (
                    <button className="btn small" onClick={() => setEditing(f.path)}>
                      <PenLine size={13} /> {locked ? t('subtitles.job.view') : t('subtitles.job.edit')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {!locked && (
        <button
          className="link small"
          onClick={() => run(() => api.detectJobSubtitles(job.id), t('subtitles.job.lookedAgain')).then((r) => r && setInfo(r))}
          title={t('subtitles.job.lookAgainTitle')}
        >
          <RefreshCw size={12} /> {t('subtitles.job.lookAgain')}
        </button>
      )}

      {result && (result.embedded?.length > 0 || result.copied?.length > 0 || errors.length > 0) && (
        <div className="sub-result">
          {result.embedded?.length > 0 && (
            <p className="small"><strong>{t('subtitles.result.embedded')}</strong> {result.embedded.join(', ')}</p>
          )}
          {result.copied?.length > 0 && (
            <>
              <p className="small"><strong>{t('subtitles.result.copied')}</strong></p>
              <ul className="tracks small">
                {result.copied.map((c) => (
                  <li key={c.to}>
                    <code className="path">{fileName(c.to)}</code>{' '}
                    {job.status === 'done' && (
                      <a className="link" href={api.downloadUrl(c.to)} download title={t('subtitles.result.download')}><Download size={12} /></a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {errors.map((e, i) => (
            <p key={i} className="text-bad small">{t(`subtitles.result.${e.code}`, { name: e.name ?? '', error: e.error ?? '' })}</p>
          ))}
        </div>
      )}
      {job.status === 'done' && files.some((f) => f.include !== false) && (
        <button
          className="btn small"
          title={t('subtitles.result.writeAgainTitle')}
          onClick={() => run(() => api.writeJobSubtitles(job.id), t('subtitles.result.written'))}
        >
          <Save size={13} /> {t('subtitles.result.writeAgain')}
        </button>
      )}

      {editingFile && (
        <SubtitleEditor
          job={job}
          file={editingFile}
          readOnly={locked}
          run={run}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setInfo(r);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
