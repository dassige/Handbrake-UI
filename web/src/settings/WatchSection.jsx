import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, FolderSearch, Plus, RefreshCw, SkipForward, Trash2, TriangleAlert } from 'lucide-react';
import { FolderPicker } from '../components/FolderPicker.jsx';
import { rootLabel } from '../roots.js';
import { api } from '../api.js';
import { ago, bytes, clockTime, fileName, relTo } from '../format.js';
import { Card, Check, Field, NumberInput, Switch } from './fields.jsx';

const isInside = (root, p) => {
  const r = root.replace(/[\\/]+$/, '');
  return p === r || p.startsWith(r + '/') || p.startsWith(r + '\\');
};

export function WatchSection({ draft, set, base, presets, liveStatus, run, dirty, onError }) {
  const w = draft.watch;
  const setW = (k, v) => set('watch', { ...w, [k]: v });
  const setFolder = (i, patch) => setW('folders', w.folders.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const [status, setStatus] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [picking, setPicking] = useState(null); // row index while the folder picker is open

  useEffect(() => {
    api.watchStatus().then(setStatus, () => {});
  }, [base.watch]);
  useEffect(() => {
    if (liveStatus) setStatus(liveStatus);
  }, [liveStatus]);

  async function scanNow() {
    setScanning(true);
    const r = await run(() => api.watchScan(), (x) => (x.added ? `Added ${x.added} file${x.added === 1 ? '' : 's'} to the queue` : 'Nothing new to add'));
    if (r) setStatus(r.status);
    setScanning(false);
  }

  const roots = draft.sourceRoots.filter(Boolean);
  const outside = (p) => p.trim() && !roots.some((r) => isInside(r, p.trim()));
  const saved = base.watch;

  return (
    <>
      <Card
        title="Watch folders"
        help="settings.watch"
        aside={<Switch checked={w.enabled} onChange={(v) => setW('enabled', v)} label={w.enabled ? 'On' : 'Off'} />}
      >
        <p className="set-hint">
          New videos that appear in these folders are added to the queue by themselves. Files that are already there when you add
          a folder are left alone (drag them into the queue if you want them). Each file is added once.
        </p>
        <div className="watch-list">
          {w.folders.map((f, i) => (
            <div key={i} className="watch-row">
              <Field label={`Folder ${i + 1}`} className="grow">
                <div className="inline-form">
                  <input
                    value={f.path}
                    list="watch-roots"
                    spellCheck={false}
                    placeholder={roots[0] ? `${roots[0]}/…` : '/mnt/...'}
                    onChange={(e) => setFolder(i, { path: e.target.value })}
                    aria-invalid={outside(f.path) || undefined}
                  />
                  <button type="button" className="btn small" onClick={() => setPicking(i)} title="Pick the folder by browsing the server">
                    <FolderSearch size={14} /> Browse…
                  </button>
                </div>
                {outside(f.path) && <span className="warn-text">Must be inside one of the sources folders.</span>}
              </Field>
              <Field label="Preset">
                <select value={f.presetId ?? ''} onChange={(e) => setFolder(i, { presetId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Default preset</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.category ? `${p.category} / ` : ''}{p.name}</option>
                  ))}
                </select>
              </Field>
              <label className="set-check compact">
                <input type="checkbox" checked={f.recursive} onChange={(e) => setFolder(i, { recursive: e.target.checked })} />
                <span>Sub-folders</span>
              </label>
              <button type="button" className="icon-btn danger" title="Stop watching this folder (nothing is deleted)" onClick={() => setW('folders', w.folders.filter((_, j) => j !== i))}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <datalist id="watch-roots">{roots.map((r) => <option key={r} value={r} label={rootLabel(draft, r)} />)}</datalist>
          <button
            type="button"
            className="btn small add-root"
            onClick={() => {
              setW('folders', [...w.folders, { path: '', presetId: null, recursive: true }]);
              setPicking(w.folders.length);
            }}
          >
            <Plus size={14} /> Add a watch folder…
          </button>
          {picking != null && (
            <FolderPicker
              settings={draft}
              title="Choose a watch folder"
              initial={w.folders[picking]?.path || undefined}
              onError={onError}
              onClose={() => {
                // A new row left empty is dropped again.
                if (!w.folders[picking]?.path) setW('folders', w.folders.filter((_, j) => j !== picking));
                setPicking(null);
              }}
              onPick={(path) => {
                setFolder(picking, { path });
                setPicking(null);
              }}
            />
          )}
        </div>
      </Card>

      <Card title="When files appear">
        <div className="set-row">
          <Field label="Wait until a file has not changed for (minutes)" hint="So files still downloading or copying are not picked up.">
            <NumberInput min="1" max="1440" value={w.settleMinutes} onChange={(v) => setW('settleMinutes', v)} className="narrow" />
          </Field>
          <Field label="Look for new files every (minutes)">
            <NumberInput min="1" max="60" value={w.intervalMinutes} onChange={(v) => setW('intervalMinutes', v)} className="narrow" />
          </Field>
        </div>
        <Check
          checked={w.autoStart}
          onChange={(v) => setW('autoStart', v)}
          hint={draft.schedule.enabled ? 'With the conversion window on, the queue then waits for the window to open.' : undefined}
        >
          Start the queue after adding files
        </Check>
      </Card>

      <Card
        title="Activity"
        aside={
          <button type="button" className="btn small" onClick={scanNow} disabled={!saved.enabled || scanning || dirty}>
            <RefreshCw size={14} className={scanning || status?.scanning ? 'spin' : ''} /> Look now
          </button>
        }
      >
        {!saved.enabled ? (
          <p className="set-hint">Watching is off{w.enabled ? ' (save to turn it on)' : ''}.</p>
        ) : (
          <>
            <p className="set-hint">
              {status?.lastScanAt ? `Last look ${ago(status.lastScanAt)}` : 'Not looked yet'}
              {status?.nextScanAt ? ` · next at ${clockTime(status.nextScanAt)}` : ''}
              {dirty ? ' · save your changes first' : ''}
            </p>
            {Object.entries(status?.errors ?? {}).map(([folder, msg]) => (
              <p key={folder} className="warn-text"><TriangleAlert size={13} /> {folder}: {msg}</p>
            ))}
            {status?.pending?.length > 0 && (
              <>
                <h4 className="set-subhead">Waiting to settle</h4>
                <ul className="activity-list">
                  {status.pending.map((p) => (
                    <li key={p.path} title={p.path}>
                      <Clock size={14} className="muted" />
                      <span className="file-name">{relTo(p.folder, p.path)}</span>
                      <span className="muted small">{bytes(p.size)} · from {clockTime(Math.max(p.readyAt, Date.now()))}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h4 className="set-subhead">Recently</h4>
            {status?.recent?.length ? (
              <ul className="activity-list">
                {status.recent.map((r) => (
                  <li key={r.path + r.at} title={r.path}>
                    {r.action === 'added' ? <CheckCircle2 size={14} className="text-good" /> : <SkipForward size={14} className="muted" />}
                    <span className="file-name">{fileName(r.path)}</span>
                    <span className="muted small">{r.action === 'added' ? 'added' : `skipped: ${r.note}`} · {ago(r.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="set-hint">Nothing added yet.</p>
            )}
          </>
        )}
      </Card>
    </>
  );
}
