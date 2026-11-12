import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePaneSwitch } from '../components/PaneSwitch.jsx';
import { AlertTriangle, ArrowRight, RefreshCw, SpellCheck, Trash2, Wand2 } from 'lucide-react';
import { api } from '../api.js';
import { SourceBrowser } from '../components/SourceBrowser.jsx';
import { useDialogs } from '../components/Dialogs.jsx';
import { Help } from '../help/Help.jsx';
import { dateTime, fileName } from '../format.js';
import { displayPath } from '../roots.js';
import { rich, t } from '../i18n/index.js';
import { renameWarning } from '../i18n/serverText.js';
import { compareNames, sortList, useRememberedSort } from '../sort.js';
import { SortControl } from '../components/SortControl.jsx';

const SORT_KEYS = ['name', 'date', 'type', 'size'];
// Files renamed, moved or deleted since the check are only in "gone".
const FILTERS = [
  { id: 'all', labelKey: 'naming.filters.all', test: (r) => !r.gone },
  { id: 'rename', labelKey: 'naming.filters.rename', test: (r) => !r.gone && !!r.expected },
  { id: 'warning', labelKey: 'naming.filters.warning', test: (r) => !r.gone && r.warnings.length > 0 },
  { id: 'gone', labelKey: 'naming.filters.gone', test: (r) => r.gone },
];
const PAGE = 500;
// The Rename view previews at most this many files at once (server/src/rename/renamer.js).
const RENAME_MAX = 5000;

/**
 * Finds the videos whose name is not the one a rename rule set gives them. Every check is
 * saved on the server (the newest 20); `checks` is their list, without the rows.
 */
export function NamingView({ settings, rules, ruleId, setRuleId, checks, changeTick, run, onError, onFixInRename }) {
  const dialogs = useDialogs();
  const [checkId, setCheckId] = useState(null);
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useRememberedSort('namingResults', SORT_KEYS);
  const [selected, setSelected] = useState(() => new Set());
  const [shown, setShown] = useState(PAGE);
  const [checking, setChecking] = useState(false);

  const effectiveRuleId = rules.some((r) => r.id === ruleId) ? ruleId : rules[0]?.id ?? null;
  const effectiveId = checks.some((c) => c.id === checkId) ? checkId : checks[0]?.id ?? null;

  // The chosen result, again whenever files change (renamed ones show as gone).
  const load = useCallback(async () => {
    if (effectiveId == null) {
      setResult(null);
      return;
    }
    try {
      const r = await api.namingCheck(effectiveId);
      setResult(r);
    } catch (e) {
      onError(e);
    }
  }, [effectiveId, onError]);
  useEffect(() => {
    load();
  }, [load, changeTick]);

  // Showing a result picks its rule set, so "Check again" and "Fix in Rename" use it.
  const resultId = result?.id;
  useEffect(() => {
    if (result && rules.some((r) => r.id === result.ruleId)) setRuleId(result.ruleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultId]);

  useEffect(() => {
    setSelected(new Set());
    setShown(PAGE);
  }, [effectiveId, filter, search]);

  async function check(paths, id = effectiveRuleId) {
    if (!paths?.length || id == null) return;
    setChecking(true);
    try {
      const r = await run(() => api.runNamingCheck(paths, id));
      if (r) {
        setResult(r);
        setCheckId(r.id);
        setFilter('all');
      }
    } finally {
      setChecking(false);
    }
  }

  /** Another rule set checks the shown folders again with it. */
  function pickRule(id) {
    setRuleId(id);
    if (result?.paths?.length) check(result.paths, id);
  }

  async function remove() {
    if (!result) return;
    const ok = await dialogs.confirm({
      title: t('naming.deleteTitle'),
      message: t('naming.deleteMessage'),
      confirmLabel: t('common.delete'),
      danger: true,
    });
    if (ok && (await run(() => api.removeNamingCheck(result.id)))) setCheckId(null);
  }

  const all = useMemo(() => (result?.id === effectiveId ? result.rows : []), [result, effectiveId]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, all.filter(f.test).length])), [all]);

  const rows = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const keep = FILTERS.find((f) => f.id === filter)?.test ?? FILTERS[0].test;
    const list = all.filter((r) => {
      if (!keep(r)) return false;
      const text = `${r.path}\n${r.expected ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    // Grouped by folder; sorted within each folder.
    const dirs = [...new Set(list.map((r) => r.dir))].sort(compareNames);
    const get = (r) => ({ name: r.oldName, mtime: r.mtime, size: r.size });
    return dirs.flatMap((d) => sortList(list.filter((r) => r.dir === d), sort, get));
  }, [all, filter, search, sort]);

  // Gone, in a protected folder or queued: not offered for fixing.
  const selectable = rows.filter((r) => !r.gone && !r.blocked);
  const selectedRows = selectable.filter((r) => selected.has(r.path));
  const allTicked = selectable.length > 0 && selectable.every((r) => selected.has(r.path));
  const tooMany = selectedRows.length > RENAME_MAX;
  const toggle = (r) => {
    if (r.gone || r.blocked) return;
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(r.path)) n.delete(r.path);
      else n.add(r.path);
      return n;
    });
  };

  // "Downloads / Show" or "Target / Movies": the folder's name, then the path inside it.
  const folder = (p) => displayPath(settings, p);
  const resultRule = rules.find((r) => r.id === result?.ruleId);
  const rulesChanged = !!result && !!resultRule && resultRule.updatedAt > result.createdAt;
  const shownResult = result?.id === effectiveId ? result : null;

  const [paneClass, paneSwitch, showPane] = usePaneSwitch([t('naming.folders'), t('naming.results')]);

  return (
    <main className={`panes rename-panes ${paneClass}`}>
      {paneSwitch}
      <SourceBrowser
        settings={settings}
        changeTick={changeTick}
        onAdd={(list) => {
          check(list);
          showPane(1);
        }}
        onError={onError}
        root="any"
        sortId="naming"
        title={t('naming.folders')}
        addLabel={t('naming.checkNames')}
        addTitle={t('naming.checkNamesTitle')}
        help="naming.folders"
        hint={t('naming.browserHint')}
      />
      <section className="pane naming">
        <div className="pane-head">
          <h2>{t('naming.title')}<Help id="naming.overview" /></h2>
          <div className="pane-tools">
            <label className="field-inline">
              {t('naming.rules')}
              <select value={effectiveRuleId ?? ''} disabled={checking} onChange={(e) => pickRule(Number(e.target.value))}>
                {rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            {checks.length > 0 && (
              <label className="field-inline">
                {t('naming.result')}
                <select value={effectiveId ?? ''} onChange={(e) => setCheckId(Number(e.target.value))}>
                  {checks.map((c) => (
                    <option key={c.id} value={c.id} title={c.paths.map((p) => fileName(p) || p).join(', ')}>
                      {dateTime(c.createdAt)} · {c.ruleName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {shownResult && (
              <>
                <button className="btn ghost small" disabled={checking} onClick={() => check(shownResult.paths)} title={t('naming.checkAgainTitle')}>
                  <RefreshCw size={14} /> {t('naming.checkAgain')}
                </button>
                <button className="icon-btn danger" title={t('naming.deleteResult')} onClick={remove}>
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        {!shownResult && (
          <div className="drop-hint">
            <SpellCheck size={28} />
            <p>{checking ? t('naming.checking') : effectiveId != null ? t('common.loading') : rich('naming.emptyHint')}</p>
            {effectiveId == null && <p className="small">{t('naming.emptyDetail')}</p>}
          </div>
        )}

        {shownResult && (
          <>
            <div className="quality-summary">
              <div className="small">
                <span className="muted">{t('naming.checked')} </span>
                {shownResult.paths.map((p, i) => (
                  <span key={p}>{i > 0 && ', '}<code className="naming-path" title={p}>{folder(p)}</code></span>
                ))}
              </div>
              <p className="small">
                {checking ? t('naming.checking') : rich('naming.summary', { flagged: shownResult.flagged, count: shownResult.total, rule: shownResult.ruleName, date: dateTime(shownResult.createdAt) })}
                {rulesChanged && !checking && <span className="warn-text"> · {t('naming.rulesChanged')}</span>}
              </p>
            </div>

            <div className="filters">
              {FILTERS.map((k) => (
                (k.id === 'all' || counts[k.id] > 0) && (
                  <button key={k.id} className={`chip ${filter === k.id ? 'active' : ''}`} onClick={() => setFilter(k.id)}>
                    {t(k.labelKey)} <span className="chip-count">{counts[k.id]}</span>
                  </button>
                )
              ))}
              <span className="spacer" />
              <SortControl sort={sort} onChange={setSort} options={SORT_KEYS} />
              <input className="quality-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('naming.filterPlaceholder')} />
            </div>

            <div className="rename-list">
              {rows.length === 0 && (
                <p className="empty">
                  {all.length && (filter !== 'all' || search) ? t('naming.noMatch')
                    : counts.gone ? t('naming.allFixed')
                    : shownResult.total ? t('naming.allGood') : t('naming.noVideos')}
                </p>
              )}
              {rows.length > 0 && (
                <table className="rename-table quality-table naming-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={allTicked}
                          disabled={!selectable.length}
                          onChange={() => setSelected(allTicked ? new Set() : new Set(selectable.map((r) => r.path)))}
                          aria-label={t('common.selectAll')}
                        />
                      </th>
                      <th>{t('naming.namesColumn')}<Help id="naming.results" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, shown).map((r, i) => {
                      const showDir = i === 0 || rows[i - 1].dir !== r.dir;
                      return [
                        showDir && (
                          <tr key={`${r.dir}-dir`} className="dir-row">
                            <td colSpan={2}>{folder(r.dir)}</td>
                          </tr>
                        ),
                        <tr key={r.path} className={`${selected.has(r.path) ? 'ticked' : ''} ${r.gone ? 'gone' : ''}`} onClick={() => toggle(r)}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.has(r.path)}
                              disabled={r.gone || !!r.blocked}
                              onChange={() => toggle(r)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={t('naming.selectFile', { name: r.oldName })}
                            />
                          </td>
                          <td className="names">
                            <div className="naming-current" title={r.path}>{r.oldName}</div>
                            {r.gone ? (
                              <div className="muted small">{t('naming.goneText')}</div>
                            ) : r.expected ? (
                              <div className="naming-expected" title={t('naming.expectedTitle')}>
                                <ArrowRight size={12} aria-hidden="true" /> {r.expected}
                              </div>
                            ) : (
                              <div className="muted small">{t('naming.nameUnchanged')}</div>
                            )}
                            {!r.gone && (r.blocked || r.warnings.length > 0) && (
                              <div className="warn-text">
                                <AlertTriangle size={12} /> {[r.blocked, ...r.warnings].filter(Boolean).map(renameWarning).join('; ')}
                              </div>
                            )}
                          </td>
                        </tr>,
                      ];
                    })}
                  </tbody>
                </table>
              )}
              {rows.length > shown && (
                <p className="empty">
                  {t('naming.showing', { shown, count: rows.length })}{' '}
                  <button className="link" onClick={() => setShown((n) => n + PAGE)}>{t('naming.showMore')}</button>
                </p>
              )}
            </div>

            <div className="rename-foot">
              <span className="muted small">
                {selected.size ? t('naming.selected', { count: selectedRows.length }) : t('common.files.count', { count: rows.length })}
                {tooMany && <span className="warn-text">&nbsp;· {t('naming.tooMany', { max: RENAME_MAX })}</span>}
              </span>
              <span className="spacer" />
              <button
                className="btn primary small"
                disabled={!selectedRows.length || tooMany}
                title={t('naming.fixTitle')}
                onClick={() => onFixInRename(selectedRows.map((r) => r.path), effectiveRuleId)}
              >
                <Wand2 size={14} /> {selectedRows.length ? t('naming.fixCount', { count: selectedRows.length }) : t('naming.fix')}
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
