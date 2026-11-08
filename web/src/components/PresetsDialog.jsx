import { useRef, useState } from 'react';
import { Star, Trash2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { dateTime } from '../format.js';
import { Modal } from './Modal.jsx';

export function PresetsDialog({ presets, run, onClose }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(files) {
    setBusy(true);
    try {
      for (const f of files) {
        const content = await f.text();
        await run(
          () => api.uploadPreset(f.name, content),
          (r) => `${f.name}: ${r.map((p) => `${p.name} ${p.action}`).join(', ')}`,
        );
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Modal title="Presets" onClose={onClose} wide>
      <div
        className={`upload-zone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload([...e.dataTransfer.files]);
        }}
      >
        <Upload size={22} />
        <div>
          <strong>Drop preset files here</strong> or{' '}
          <button className="link" onClick={() => input.current?.click()} disabled={busy}>choose files</button>
          <p className="muted small">
            In HandBrake: Presets → select your preset → Export. A preset with the same name replaces the old one;
            jobs already in the queue keep the settings they were added with.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={(e) => upload([...e.target.files])}
        />
      </div>

      {presets.length === 0 ? (
        <p className="muted">No presets uploaded yet.</p>
      ) : (
        <div className="preset-list">
          {presets.map((p) => (
            <div key={p.id} className={`preset-card ${p.isDefault ? 'default' : ''}`}>
              <div className="preset-head">
                <div>
                  <strong>{p.name}</strong>
                  {p.category && <span className="muted"> · {p.category}</span>}
                  {p.isDefault && <span className="badge done">default</span>}
                </div>
                <div className="job-actions">
                  {!p.isDefault && (
                    <button className="icon-btn" title="Make default" onClick={() => run(() => api.setDefaultPreset(p.id))}>
                      <Star size={16} />
                    </button>
                  )}
                  <button
                    className="icon-btn danger"
                    title="Delete preset"
                    onClick={() => confirm(`Delete preset "${p.name}"? Queued jobs keep their copy.`) && run(() => api.deletePreset(p.id))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {p.description && <p className="muted small">“{p.description}”</p>}
              <dl className="preset-summary">
                <dt>Video</dt>
                <dd>{[p.summary.videoEncoder, p.summary.videoPreset, p.summary.quality, p.summary.multiPass && 'multi-pass'].filter(Boolean).join(' · ')}</dd>
                <dt>Size</dt>
                <dd>{p.summary.maxSize ? `max ${p.summary.maxSize}` : 'source'} · {p.summary.framerate}</dd>
                <dt>Audio</dt>
                <dd>{p.summary.audio.join(', ') || '—'}{p.summary.audioTracks ? ` (${p.summary.audioTracks} tracks)` : ''}</dd>
                <dt>Subtitles</dt>
                <dd>{p.summary.subtitles ?? '—'}</dd>
                <dt>Container</dt>
                <dd>{p.summary.format.replace('av_', '').toUpperCase()}</dd>
              </dl>
              <p className="muted small">Uploaded {dateTime(p.createdAt)}{p.fileName ? ` from ${p.fileName}` : ''}</p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
