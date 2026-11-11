import { useMemo, useRef, useState } from 'react';
import { FolderPlus, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { bytes, relTo } from '../format.js';
import { Modal } from '../components/Modal.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { Help } from '../help/Help.jsx';
import { rich, t } from '../i18n/index.js';

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/** Picks files on this computer and sends them to a folder under a sources folder. */
export function UploadDialog({ dir: initialDir, root, settings, initialFiles = [], onStart, onClose, onError }) {
  const dialogs = useDialogs();
  const [dir, setDir] = useState(initialDir);
  const [files, setFiles] = useState(() => dedupe(initialFiles));
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  // Videos, and subtitle files to go with them (.sub: the pictures of a VobSub .idx).
  const exts = useMemo(() => {
    const subs = settings?.subtitleExtensions ?? [];
    return new Set([...(settings?.videoExtensions ?? []), ...subs, ...(subs.includes('idx') ? ['sub'] : [])]);
  }, [settings]);
  const isVideo = (f) => exts.has(extOf(f.name));
  const videos = files.filter(isVideo);
  const total = videos.reduce((s, f) => s + f.size, 0);

  function dedupe(list) {
    const seen = new Map();
    for (const f of list) seen.set(`${f.name}|${f.size}`, f);
    return [...seen.values()];
  }
  const addFiles = (list) => setFiles((cur) => dedupe([...cur, ...list]));

  async function newFolder() {
    const name = await dialogs.prompt({
      title: t('upload.newFolder.title'),
      message: <p>{rich('upload.newFolder.message', { path: relTo(root, dir) || root })}</p>,
      label: t('upload.newFolder.label'),
      confirmLabel: t('upload.newFolder.create'),
      validate: (v) =>
        /[/\\]/.test(v)
          ? t('upload.newFolder.noSlashes')
          : v.startsWith('.')
            ? t('upload.newFolder.noDot')
            : v
              ? null
              : t('upload.newFolder.typeName'),
    });
    if (!name) return;
    try {
      const r = await api.makeFolder(dir, name);
      setDir(r.path);
    } catch (e) {
      onError(e);
    }
  }

  async function start() {
    if (!videos.length) return;
    setBusy(true);
    try {
      const check = await api.uploadCheck(dir, videos.map((f) => ({ name: f.name, size: f.size })));
      const byKey = new Map(videos.map((f) => [`${f.name.trim()}|${f.size}`, f]));
      let list = check.files.filter((c) => !c.error);
      const refused = check.files.filter((c) => c.error);
      if (refused.length) onError(new Error(refused.map((c) => c.error).join('; ')));

      const existing = list.filter((c) => c.exists && !c.partial);
      if (existing.length) {
        const answer = await dialogs.choose({
          title: t('upload.existing.title'),
          icon: 'warn',
          message: (
            <>
              <p>{t('upload.existing.message', { count: existing.length })}</p>
              <ul className="ask-list">
                {existing.slice(0, 12).map((c) => <li key={c.name}>{c.name}</li>)}
                {existing.length > 12 && <li className="muted">{t('upload.existing.more', { count: existing.length - 12 })}</li>}
              </ul>
            </>
          ),
          buttons: [
            { label: t('common.cancel'), value: null },
            { label: t('upload.existing.skip'), value: 'skip' },
            { label: t('upload.existing.copies'), value: 'copy', primary: true, autoFocus: true },
          ],
        });
        if (!answer) return;
        if (answer === 'skip') list = list.filter((c) => !existing.includes(c));
      }
      if (!list.length) return;

      const remaining = list.reduce((s, c) => s + c.size - (c.partial || 0), 0);
      if (check.freeBytes != null && remaining > check.freeBytes) {
        await dialogs.alert({
          title: t('upload.noSpace.title'),
          danger: true,
          message: t('upload.noSpace.message', { need: bytes(remaining), free: bytes(check.freeBytes) }),
        });
        return;
      }
      onStart(list.map((c) => ({ file: byKey.get(`${c.name}|${c.size}`), dir: check.dir, name: c.name, size: c.size })));
      onClose();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={<>{t('upload.dialog.title')}<Help id="upload.overview" /></>}
      ariaLabel={t('upload.dialog.title')}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted small spacer">
            {videos.length ? t('upload.dialog.chosen', { count: videos.length, size: bytes(total) }) : t('upload.dialog.noFiles')}
          </span>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!videos.length || busy} onClick={start}>
            <Upload size={15} /> {t('common.upload')}
          </button>
        </>
      }
    >
      <div className="upload-dest">
        <span className="muted">{t('upload.dialog.uploadTo')}</span>
        <code className="path">{dir}</code>
        <button className="btn small" onClick={newFolder}>
          <FolderPlus size={14} /> {t('upload.dialog.newFolder')}
        </button>
      </div>
      <p className="muted small">{t('upload.dialog.elsewhere')}</p>

      <div
        className={`upload-zone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          addFiles([...e.dataTransfer.files]);
        }}
        onClick={() => input.current?.click()}
      >
        <Upload size={26} />
        <p>{rich('upload.dialog.drop')}</p>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={[...exts].map((e) => `.${e}`).join(',')}
          onChange={(e) => {
            addFiles([...e.target.files]);
            e.target.value = '';
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="upload-pick">
          {files.map((f) => (
            <li key={`${f.name}|${f.size}`} className={isVideo(f) ? '' : 'off'}>
              <span className="file-name" title={f.name}>{f.name}</span>
              <span className="muted small">{isVideo(f) ? bytes(f.size) : t('upload.dialog.notVideo')}</span>
              <button className="icon-btn" aria-label={t('upload.dialog.removeFile', { name: f.name })} onClick={() => setFiles((l) => l.filter((x) => x !== f))}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{t('upload.dialog.keepOpen')}</p>
    </Modal>
  );
}
