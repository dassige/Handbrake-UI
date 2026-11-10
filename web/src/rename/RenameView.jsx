import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePaneSwitch } from '../components/PaneSwitch.jsx';
import { AlertTriangle, History, ListX, RotateCcw, SlidersHorizontal, Wand2, Upload } from 'lucide-react';
import { api } from '../api.js';
import { SourceBrowser, DRAG_PATHS } from '../components/SourceBrowser.jsx';
import { relTo } from '../format.js';
import { RuleEditor } from './RuleEditor.jsx';
import { HistoryDialog } from './HistoryDialog.jsx';
import { Help } from '../help/Help.jsx';
import { useDialogs } from '../components/Dialogs.jsx';

const pad = (n) => String(n).padStart(2, '0');

function InfoChip({ info }) {
  if (!info) return null;
  if (info.type === 'tv' && info.episode != null) {
    return <span className="badge queued" title={info.show}>TV · S{pad(info.season)}e{pad(info.episode)}</span>;
  }
  if (info.type === 'movie' && info.year) return <span className="badge done">Movie · {info.year}</span>;
  return null;
}

/** Blocking warnings make a row start unticked. */
const isBlocking = (w) => !w.startsWith('name already taken');

function NameInput({ row, onCommit }) {
  const [value, setValue] = useState(row.newName);
  useEffect(() => setValue(row.newName), [row.newName]);
  const commit = () => value.trim() && value !== row.newName && onCommit(value.trim());
  return (
    <input
      className={`name-input ${row.edited ? 'edited' : ''}`}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setValue(row.newName);
      }}
    />
  );
}

export function RenameView({ settings, rules, paths, setPaths, changeTick, run, onError }) {
  const dialogs = useDialogs();
  const [ruleId, setRuleId] = useState(null);
  const [showName, setShowName] = useState('');
  const [edits, setEdits] = useState({});
  const [rows, setRows] = useState([]);
  const [ticks, setTicks] = useState(() => new Map()); // explicit user choices
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState(null); // 'rules' | 'history'
  const [dropActive, setDropActive] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const seq = useRef(0);

  const effectiveRuleId = rules.some((r) => r.id === ruleId) ? ruleId : rules[0]?.id ?? null;
  const rule = rules.find((r) => r.id === effectiveRuleId);

  // Recompute the preview whenever its inputs change.
  useEffect(() => {
    if (!paths.length || !effectiveRuleId) {
      setRows([]);
      return undefined;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.previewRename({ paths, ruleId: effectiveRuleId, showOverride: showName, showOverrideAll: showAll, edits });
        if (mine !== seq.current) return;
        setRows(r.rows);
      } catch (e) {
        if (mine === seq.current) onError(e);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths, effectiveRuleId, showName, showAll, edits, refresh, rule?.updatedAt]);

  const addPaths = useCallback(
    (list) => setPaths((p) => [...new Set([...p, ...list])]),
    [setPaths],
  );

  /** Your clicks win; otherwise a row is ticked unless it has a warning (edited rows are always ticked). */
  const isTicked = (r) =>
    r.status === 'rename' && (ticks.has(r.path) ? ticks.get(r.path) : r.edited || !r.warnings.some(isBlocking));
  const toRename = rows.filter(isTicked);
  const counts = useMemo(() => ({
    rename: rows.filter((r) => r.status === 'rename').length,
    unchanged: rows.filter((r) => r.status === 'unchanged').length,
    warnings: rows.filter((r) => r.warnings.some(isBlocking)).length,
  }), [rows]);
  const multiDir = new Set(rows.map((r) => r.dir)).size > 1;

  async function apply() {
    if (!toRename.length) return;
    if (!(await dialogs.confirm({ title: 'Rename files', message: `Rename ${toRename.length} file${toRename.length > 1 ? 's' : ''}?`, confirmLabel: 'Rename' }))) return;
    const r = await run(
      () => api.applyRename(toRename.map((x) => ({ path: x.path, newName: x.newName })), rule?.name),
      (x) => `Renamed ${x.renamed.length} file${x.renamed.length === 1 ? '' : 's'} · undo from History`,
    );
    if (!r) return;
    if (r.errors.length) onError(new Error(`${r.errors.length} not renamed: ${r.errors.map((e) => `${e.path.split(/[\\/]/).pop()}: ${e.error}`).join('; ')}`));
    const map = new Map(r.renamed.map((x) => [x.from, x.to]));
    setPaths((p) => p.map((x) => map.get(x) ?? x));
    setEdits({});
    setTicks(new Map());
  }

  function toggle(row) {
    setTicks((m) => new Map(m).set(row.path, !isTicked(row)));
  }

  const allTicked = counts.rename > 0 && toRename.length === counts.rename;

  const [paneClass, paneSwitch, showPane] = usePaneSwitch(['Converted files', `Rename list${paths.length ? ` (${paths.length})` : ''}`]);

  return (
    <main className={`panes rename-panes ${paneClass}`}>
      {paneSwitch}
      <SourceBrowser
        settings={settings}
        root="target"
        title="Converted files"
        addLabel="Add to rename"
        hint="Drag files or folders to the rename list. Ctrl/Shift-click to select several."
        help="rename.overview"
        changeTick={changeTick}
        onAdd={(list) => {
          addPaths(list);
          showPane(1);
        }}
        onError={onError}
      />

      <section
        className={`pane rename ${dropActive ? 'drop-active' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_PATHS)) {
            e.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropActive(false)}
        onDrop={(e) => {
          setDropActive(false);
          const raw = e.dataTransfer.getData(DRAG_PATHS);
          if (raw) {
            e.preventDefault();
            addPaths(JSON.parse(raw));
          }
        }}
      >
        <div className="pane-head">
          <h2>Rename<Help id="rename.overview" /></h2>
          <div className="pane-tools">
            <label className="field-inline">
              Rules<Help id="rename.rules" />
              <select value={effectiveRuleId ?? ''} onChange={(e) => setRuleId(Number(e.target.value))}>
                {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <button className="btn ghost small" onClick={() => setDialog('rules')}><SlidersHorizontal size={14} /> Edit rules</button>
            <button className="btn ghost small" onClick={() => setDialog('history')}><History size={14} /> History</button>
          </div>
        </div>

        <div className="rename-bar">
          <label className="field-inline" title="Use when the show name is missing or wrong, e.g. “S04E07 Reacher Title”">
            Show name<Help id="rename.showName" />
            <input value={showName} onChange={(e) => setShowName(e.target.value)} placeholder="auto-detected" />
          </label>
          <select
            value={showAll ? 'all' : 'missing'}
            onChange={(e) => setShowAll(e.target.value === 'all')}
            disabled={!showName.trim()}
            title="Which rows get the typed show name"
          >
            <option value="missing">only where missing</option>
            <option value="all">for all rows</option>
          </select>
          <span className="spacer" />
          {Object.keys(edits).length > 0 && (
            <button className="btn ghost small" onClick={() => setEdits({})} title="Forget names typed by hand">
              <RotateCcw size={14} /> Reset edits
            </button>
          )}
          <button className="btn ghost small" disabled={!paths.length} onClick={() => { setPaths([]); setEdits({}); }}>
            <ListX size={14} /> Clear list
          </button>
        </div>

        <div className="rename-list">
          {rows.length === 0 && (
            <div className="drop-hint">
              <Upload size={28} />
              <p>{loading ? 'Reading…' : paths.length ? 'No video files found.' : 'Drag converted files or folders here, or use “Rename” on finished jobs.'}</p>
            </div>
          )}
          {rows.length > 0 && (
            <table className="rename-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allTicked}
                      onChange={() => setTicks(new Map(rows.filter((r) => r.status === 'rename').map((r) => [r.path, !allTicked])))}
                      aria-label="Select all"
                    />
                  </th>
                  <th>Current name → new name<Help id="rename.preview" /></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const showDir = multiDir && (i === 0 || rows[i - 1].dir !== r.dir);
                  const blocking = r.warnings.filter(isBlocking);
                  return [
                    showDir && (
                      <tr key={`${r.dir}-dir`} className="dir-row">
                        <td colSpan={3}>{relTo(settings?.targetRoot, r.dir)}</td>
                      </tr>
                    ),
                    <tr key={r.path} className={`${r.status} ${r.status === 'rename' && !isTicked(r) ? 'off' : ''}`}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={r.status === 'unchanged'}
                          checked={isTicked(r)}
                          onChange={() => toggle(r)}
                          aria-label={`Rename ${r.oldName}`}
                        />
                      </td>
                      <td className="names">
                        <div className="old-name" title={r.path}>{r.oldName}</div>
                        <NameInput row={r} onCommit={(v) => setEdits((e) => ({ ...e, [r.path]: v }))} />
                        {r.warnings.length > 0 && (
                          <div className={blocking.length ? 'warn-text' : 'muted small'}>
                            <AlertTriangle size={12} /> {r.warnings.join('; ')}
                          </div>
                        )}
                      </td>
                      <td className="row-meta">
                        {r.status === 'unchanged' ? <span className="badge">no change</span> : <InfoChip info={r.info} />}
                        {r.edited && (
                          <button
                            className="link small"
                            onClick={() => setEdits((e) => {
                              const n = { ...e };
                              delete n[r.path];
                              return n;
                            })}
                          >
                            undo edit
                          </button>
                        )}
                      </td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          )}
          {dropActive && <div className="drop-overlay">Drop to add to the rename list</div>}
        </div>

        <div className="rename-foot">
          <span className="muted small">
            {counts.rename} to rename · {counts.unchanged} unchanged
            {counts.warnings ? <span className="warn-text">&nbsp;· {counts.warnings} need a look</span> : null}
            {loading && ' · updating…'}
          </span>
          <span className="spacer" />
          <button className="btn ghost small" onClick={() => setRefresh((x) => x + 1)} disabled={!paths.length}>Refresh</button>
          <button className="btn primary" disabled={!toRename.length || loading} onClick={apply}>
            <Wand2 size={15} /> Rename {toRename.length || ''} file{toRename.length === 1 ? '' : 's'}
          </button>
        </div>
      </section>

      {dialog === 'rules' && (
        <RuleEditor
          rules={rules}
          initialId={effectiveRuleId}
          sampleNames={rows.map((r) => r.oldName)}
          run={run}
          onPick={setRuleId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'history' && (
        <HistoryDialog
          run={run}
          onClose={() => setDialog(null)}
          onUndone={() => setRefresh((x) => x + 1)}
        />
      )}
    </main>
  );
}
