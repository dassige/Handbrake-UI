import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Captions, ChevronRight, Download, Eye, FileVideo, Folder, FolderOpen, ListPlus, Lock, RefreshCw, Trash2, Upload } from 'lucide-react';
import { rootLabel, watchedFolder } from '../roots.js';
import { api } from '../api.js';
import { bytes, dateTime } from '../format.js';
import { FolderBadges, StatusBadge } from './StatusBadge.jsx';
import { Help } from '../help/Help.jsx';
import { downloadTitle, useDownload } from '../download/useDownload.jsx';
import { useDeleteFiles } from './useDeleteFiles.jsx';
import { t } from '../i18n/index.js';
import { sortList, useRememberedSort } from '../sort.js';
import { SortControl } from './SortControl.jsx';
import { langName, langShort } from '../subtitles/languages.js';

export const DRAG_PATHS = 'application/x-hbui-paths';

/** Sidecar subtitle files next to a video: "CC EN IT", every file in the tooltip. */
function SubtitlesBadge({ list }) {
  const langs = [...new Set(list.map((s) => (s.lang ? langShort(s.lang) : '?')))];
  const title = t('subtitles.browser.title', {
    count: list.length,
    list: list.map((s) => [s.lang ? langName(s.lang) : t('subtitles.job.unknownLanguage'), s.forced && t('subtitles.job.forced'), s.sdh && t('subtitles.job.sdh')].filter(Boolean).join(' ')).join(', '),
  });
  return (
    <span className="badge subs" title={title} aria-label={title}>
      <Captions size={12} /> {langs.length <= 3 ? langs.join(' ') : list.length}
    </span>
  );
}
const SORT_KEYS = ['name', 'date', 'type', 'size'];

const storeKey = (kind) => `hbui.browserRoot.${kind}`;
const readStore = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeStore = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private window: not remembered
  }
};

/** The folders a browser of this kind can show: root=source|target|any. */
export function browserRoots(settings, kind) {
  if (!settings) return [];
  if (kind === 'target') return [settings.targetRoot];
  if (kind === 'any') return [...settings.sourceRoots, settings.targetRoot];
  return settings.sourceRoots;
}

/**
 * Folder browser for the source roots, the target root or all of them; items can be
 * dragged out or added with a button. With onUpload, it also takes files dropped from
 * the computer and shows an Upload button: onUpload(dir, root, files).
 * addLabel is the add button's text; addTitle the tooltip of a file row ("Double-click or drag to …").
 * sortId names the feature (convert, quality, rename, merge): each remembers its own sort.
 */
export function SourceBrowser({
  settings, changeTick, onAdd, onError, root = 'source', title = t('sources.title'), addLabel, addTitle,
  hint = t('sources.hint'), help, onUpload, allowDelete, onNotice, onWatch, sortId = root,
}) {
  const addText = addLabel ?? t('sources.addLabel');
  // Without addTitle, a custom addLabel is fitted into the English-style sentence (callers should pass addTitle).
  const rowAddTitle = addTitle ?? (addLabel ? t('sources.addTitleAction', { action: addLabel.toLowerCase() }) : t('sources.addTitle'));
  const [dir, setDir] = useState(null); // null = the chosen root
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [fileDrop, setFileDrop] = useState(false);
  const lastClicked = useRef(null);
  const download = useDownload(onError);
  const removeFiles = useDeleteFiles({ onError, onNotice });
  const roots = browserRoots(settings, root);
  const rootsKey = roots.join('|');
  const [chosenRoot, setChosenRoot] = useState(() => readStore(storeKey(root)));
  const sourceRoot = roots.includes(chosenRoot) ? chosenRoot : roots[0];
  const chooseRoot = (r) => {
    setChosenRoot(r);
    writeStore(storeKey(root), r);
  };

  const load = useCallback(
    async (path, { keepSelection } = {}) => {
      setLoading(true);
      try {
        const r = await api.browse(root, path ?? sourceRoot);
        setListing(r);
        if (!keepSelection) setSelected(new Set());
      } catch (e) {
        onError(e);
        if (path) setDir(null); // the folder vanished: go back to the root
      } finally {
        setLoading(false);
      }
    },
    [onError, root, sourceRoot],
  );

  // Back to the root when the chosen or configured folders change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDir(null), [sourceRoot, rootsKey]);
  useEffect(() => {
    if (sourceRoot) load(dir);
  }, [dir, sourceRoot, load]);
  // Refresh badges when jobs change, keeping the selection.
  useEffect(() => {
    if (changeTick && sourceRoot) load(dir, { keepSelection: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeTick]);

  const [sort, setSort] = useRememberedSort(`browser.${sortId}`, SORT_KEYS);
  const items = useMemo(
    () => sortList(listing?.items ?? [], sort, (i) => ({ name: i.name, mtime: i.mtime, size: i.size, dir: i.type === 'dir' })),
    [listing, sort],
  );

  function onRowClick(e, item) {
    const next = new Set(e.ctrlKey || e.metaKey ? selected : []);
    if (e.shiftKey && lastClicked.current) {
      const a = items.findIndex((i) => i.path === lastClicked.current);
      const b = items.findIndex((i) => i.path === item.path);
      const [from, to] = a < b ? [a, b] : [b, a];
      for (let i = from; i <= to; i++) next.add(items[i].path);
    } else if ((e.ctrlKey || e.metaKey) && selected.has(item.path)) {
      next.delete(item.path);
    } else {
      next.add(item.path);
    }
    lastClicked.current = item.path;
    setSelected(next);
  }

  function toggle(item) {
    const next = new Set(selected);
    if (next.has(item.path)) next.delete(item.path);
    else next.add(item.path);
    lastClicked.current = item.path;
    setSelected(next);
  }

  function onDragStart(e, item) {
    const paths = selected.has(item.path) ? [...selected] : [item.path];
    if (!selected.has(item.path)) setSelected(new Set([item.path]));
    e.dataTransfer.setData(DRAG_PATHS, JSON.stringify(paths));
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.effectAllowed = 'copy';
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = paths.length === 1 ? item.name : t('sources.dragItems', { count: paths.length });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
  }

  const isProtected = (settings?.protectedRoots ?? []).includes(listing?.root ?? sourceRoot);

  async function deleteSelected() {
    if (await removeFiles([...selected])) {
      setSelected(new Set());
      load(dir, { keepSelection: true });
    }
  }

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.path));

  const acceptsFiles = (e) => onUpload && e.dataTransfer.types.includes('Files');

  return (
    <section
      className={`pane sources ${fileDrop ? 'drop-active' : ''}`}
      onDragOver={(e) => {
        if (!acceptsFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setFileDrop(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFileDrop(false);
      }}
      onDrop={(e) => {
        if (!acceptsFiles(e)) return;
        e.preventDefault();
        setFileDrop(false);
        if (listing) onUpload(listing.path, listing.root, [...e.dataTransfer.files]);
      }}
    >
      {fileDrop && (
        <div className="drop-overlay">
          <Upload size={28} />
          <span>{listing ? t('sources.dropUploadInto', { folder: listing.crumbs.at(-1)?.name }) : t('sources.dropUploadHere')}</span>
        </div>
      )}
      <div className="pane-head">
        <h2>{title}{help && <Help id={help} />}</h2>
        <div className="pane-tools">
          {roots.length > 1 && (
            <select
              className="root-select"
              value={sourceRoot}
              onChange={(e) => chooseRoot(e.target.value)}
              title={t('sources.rootTitle')}
              aria-label={t('sources.rootLabel')}
            >
              {roots.map((r) => (
                <option key={r} value={r} title={r}>
                  {root !== 'target' && settings.protectedRoots?.includes(r)
                    ? t('sources.rootProtected', { name: rootLabel(settings, r) })
                    : rootLabel(settings, r)}
                </option>
              ))}
            </select>
          )}
          {onUpload && (
            <button
              className="btn ghost small"
              disabled={!listing}
              title={t('sources.uploadTitle')}
              onClick={() => onUpload(listing.path, listing.root, [])}
            >
              <Upload size={14} /> {t('common.upload')}
            </button>
          )}
          <button className="icon-btn" title={t('common.refresh')} onClick={() => load(dir, { keepSelection: true })}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <nav className="crumbs" aria-label={t('sources.crumbs')}>
        {listing?.parent && (
          <button className="icon-btn" title={t('sources.up')} onClick={() => setDir(listing.parent)}>
            <ArrowUp size={15} />
          </button>
        )}
        {(listing?.crumbs ?? []).map((c, i, all) => (
          <span key={c.path} className="crumb">
            {i > 0 && <ChevronRight size={14} className="muted" />}
            {i < all.length - 1 ? (
              <button className="link" onClick={() => setDir(i === 0 ? null : c.path)}>{c.name}</button>
            ) : (
              <strong>{c.name}</strong>
            )}
          </span>
        ))}
        {onWatch && listing && (
          watchedFolder(settings, listing.path) ? (
            <button
              className={`watch-pill ${settings.watch.enabled ? 'on' : ''}`}
              onClick={() => onWatch(listing.path)}
              title={settings.watch.enabled ? t('sources.watch.watchedTitle') : t('sources.watch.watchedOffTitle')}
            >
              <Eye size={13} /> {settings.watch.enabled ? t('sources.watch.watched') : t('sources.watch.watchedOff')}
            </button>
          ) : (
            <button
              className="btn ghost small watch-btn"
              onClick={() => onWatch(listing.path)}
              title={t('sources.watch.watchTitle')}
            >
              <Eye size={14} /> {t('sources.watch.watch')}
            </button>
          )
        )}
      </nav>

      <div className="select-bar">
        <label className="check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.path)))}
          />
          {selected.size ? t('sources.selected', { count: selected.size }) : t('common.selectAll')}
        </label>
        <SortControl sort={sort} onChange={setSort} options={SORT_KEYS} />
        <div className="select-actions">
          {allowDelete && !isProtected && (
            <button
              className="btn ghost small danger"
              disabled={!selected.size}
              title={t('sources.deleteTitle')}
              onClick={deleteSelected}
            >
              <Trash2 size={14} /> {t('common.delete')}
            </button>
          )}
          {allowDelete && isProtected && (
            <span className="protected-note" title={t('sources.protectedTitle')}>
              <Lock size={13} /> {t('sources.protected')}
            </span>
          )}
          <button
            className="btn ghost small"
            disabled={!selected.size}
            title={t('sources.downloadTitle')}
            onClick={() => download(items.filter((i) => selected.has(i.path)))}
          >
            <Download size={14} /> {t('common.download')}
          </button>
          <button className="btn primary small" disabled={!selected.size} onClick={() => onAdd([...selected])}>
            <ListPlus size={14} /> {addText}
          </button>
        </div>
      </div>

      <ul
        className="file-list"
        role="listbox"
        aria-multiselectable="true"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (allowDelete && !isProtected && e.key === 'Delete' && selected.size) {
            e.preventDefault();
            deleteSelected();
          }
        }}
      >
        {items.length === 0 && !loading && <li className="empty">{t('sources.empty')}</li>}
        {items.map((item) => (
          <li
            key={item.path}
            role="option"
            aria-selected={selected.has(item.path)}
            className={`file-row ${selected.has(item.path) ? 'selected' : ''} ${item.excluded ? 'excluded' : ''}`}
            draggable
            onDragStart={(e) => onDragStart(e, item)}
            onClick={(e) => onRowClick(e, item)}
            onDoubleClick={() => (item.type === 'dir' ? setDir(item.path) : onAdd([item.path]))}
            title={item.type === 'dir' ? t('sources.dirTitle') : rowAddTitle}
          >
            <input
              type="checkbox"
              checked={selected.has(item.path)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggle(item)}
              aria-label={t('sources.selectItem', { name: item.name })}
            />
            {item.type === 'dir' ? (
              <button
                className="icon-btn folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setDir(item.path);
                }}
                title={t('sources.openFolder')}
              >
                {item.jobs ? <FolderOpen size={17} /> : <Folder size={17} />}
              </button>
            ) : (
              <FileVideo size={17} className="file-icon" />
            )}
            <span className="file-name">{item.name}</span>
            {item.type === 'dir' && watchedFolder(settings, item.path) && (
              <Eye size={14} className="watched-icon" aria-label={t('sources.watch.watchFolder')} title={t('sources.watch.watchFolder')} />
            )}
            <span className="file-meta">
              <button
                className="icon-btn row-download"
                title={downloadTitle(item)}
                aria-label={downloadTitle(item)}
                onClick={(e) => {
                  e.stopPropagation();
                  download([item]);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Download size={15} />
              </button>
              {item.type === 'dir' ? (
                <FolderBadges counts={item.jobs} />
              ) : (
                <>
                  {item.excluded && <span className="badge cancelled" title={t('sources.excludedTitle')}>{t('sources.excluded')}</span>}
                  {item.jobs && <StatusBadge status={item.jobs} />}
                  {item.subtitles?.length > 0 && <SubtitlesBadge list={item.subtitles} />}
                  <span className="muted" title={dateTime(item.mtime)}>{bytes(item.size)}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="hint">{hint}</p>
    </section>
  );
}
