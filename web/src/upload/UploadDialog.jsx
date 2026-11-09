import { useMemo, useRef, useState } from 'react';
import { FolderPlus, Upload, X } from 'lucide-react';
import { api } from '../api.js';
import { bytes, relTo } from '../format.js';
import { Modal } from '../components/Modal.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { Help } from '../help/Help.jsx';

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/** Picks files on this computer and sends them to a folder under a sources folder. */
export function UploadDialog({ dir: initialDir, root, settings, initialFiles = [], onStart, onClose, onError }) {
  const dialogs = useDialogs();
  const [dir, setDir] = useState(initialDir);
  const [files, setFiles] = useState(() => dedupe(initialFiles));
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const exts = useMemo(() => new Set(settings?.videoExtensions ?? []), [settings]);
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
      title: 'New folder',
      message: <p>Create a folder inside <code>{relTo(root, dir) || root}</code>.</p>,
      label: 'Folder name',
      confirmLabel: 'Create',
      validate: (v) => (/[/\\]/.test(v) ? 'No slashes, please' : v.startsWith('.') ? 'The name cannot start with a dot' : v ? null : 'Type a name'),
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
          title: 'Some files are already there',
          icon: 'warn',
          message: (
            <>
              <p>
                {existing.length === 1 ? 'A file with this name is' : `${existing.length} files with these names are`} already in the
                folder. Existing files are never replaced.
              </p>
              <ul className="ask-list">
                {existing.slice(0, 12).map((c) => <li key={c.name}>{c.name}</li>)}
                {existing.length > 12 && <li className="muted">… and {existing.length - 12} more</li>}
              </ul>
            </>
          ),
          buttons: [
            { label: 'Cancel', value: null },
            { label: 'Skip them', value: 'skip' },
            { label: 'Upload as copies, “name (1)”', value: 'copy', primary: true, autoFocus: true },
          ],
        });
        if (!answer) return;
        if (answer === 'skip') list = list.filter((c) => !existing.includes(c));
      }
      if (!list.length) return;

      const remaining = list.reduce((s, c) => s + c.size - (c.partial || 0), 0);
      if (check.freeBytes != null && remaining > check.freeBytes) {
        await dialogs.alert({
          title: 'Not enough space',
          danger: true,
          message: `These files need ${bytes(remaining)}, but the server has only ${bytes(check.freeBytes)} free in that folder.`,
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
      title={<>Upload videos<Help id="upload.overview" /></>}
      ariaLabel="Upload videos"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted small spacer">
            {videos.length ? `${videos.length} file${videos.length > 1 ? 's' : ''} · ${bytes(total)}` : 'No files chosen'}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!videos.length || busy} onClick={start}>
            <Upload size={15} /> Upload
          </button>
        </>
      }
    >
      <div className="upload-dest">
        <span className="muted">Upload to</span>
        <code className="path">{dir}</code>
        <button className="btn small" onClick={newFolder}>
          <FolderPlus size={14} /> New folder
        </button>
      </div>
      <p className="muted small">To upload somewhere else, close this window and open that folder in Sources first.</p>

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
        <p><strong>Drop video files here</strong> or click to choose them on this computer</p>
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
              <span className="muted small">{isVideo(f) ? bytes(f.size) : 'not a video file, skipped'}</span>
              <button className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles((l) => l.filter((x) => x !== f))}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Keep this browser tab open until the uploads finish. You can keep working meanwhile. If an upload is interrupted, upload the
        same file to the same folder again: it continues where it stopped.
      </p>
    </Modal>
  );
}
