import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Download, FileVideo, Folder, FolderOpen, ListPlus, RefreshCw, Upload } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime } from '../format.js';
import { FolderBadges, StatusBadge } from './StatusBadge.jsx';
import { Help } from '../help/Help.jsx';
import { downloadTitle, useDownload } from '../download/useDownload.jsx';

export const DRAG_PATHS = 'application/x-hbui-paths';

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
 */
export function SourceBrowser({
  settings, changeTick, onAdd, onError, root = 'source', title = 'Sources', addLabel = 'Add to queue',
  hint = 'Drag files or folders to the queue. Ctrl/Shift-click to select several.', help, onUpload,
}) {
  const [dir, setDir] = useState(null); // null = the chosen root
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [fileDrop, setFileDrop] = useState(false);
  const lastClicked = useRef(null);
  const download = useDownload(onError);
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

  const items = listing?.items ?? [];

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
    ghost.textContent = paths.length === 1 ? item.name : `${paths.length} items`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
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
          <span>Drop to upload into {listing ? listing.crumbs.at(-1)?.name : 'this folder'}</span>
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
              title="Which folder to browse"
              aria-label="Folder to browse"
            >
              {roots.map((r) => (
                <option key={r} value={r}>
                  {root === 'any' && r === settings.targetRoot ? `${r} (target)` : r}
                </option>
              ))}
            </select>
          )}
          {onUpload && (
            <button
              className="btn ghost small"
              disabled={!listing}
              title="Upload videos from this computer into the open folder"
              onClick={() => onUpload(listing.path, listing.root, [])}
            >
              <Upload size={14} /> Upload
            </button>
          )}
          <button className="icon-btn" title="Refresh" onClick={() => load(dir, { keepSelection: true })}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <nav className="crumbs" aria-label="Folder">
        {listing?.parent && (
          <button className="icon-btn" title="Up one folder" onClick={() => setDir(listing.parent)}>
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
      </nav>

      <div className="select-bar">
        <label className="check">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.path)))}
          />
          {selected.size ? `${selected.size} selected` : 'Select all'}
        </label>
        <div className="select-actions">
          <button
            className="btn ghost small"
            disabled={!selected.size}
            title="Download the selected files and folders to this computer"
            onClick={() => download(items.filter((i) => selected.has(i.path)))}
          >
            <Download size={14} /> Download
          </button>
          <button className="btn primary small" disabled={!selected.size} onClick={() => onAdd([...selected])}>
            <ListPlus size={14} /> {addLabel}
          </button>
        </div>
      </div>

      <ul className="file-list" role="listbox" aria-multiselectable="true">
        {items.length === 0 && !loading && <li className="empty">No folders or video files here.</li>}
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
            title={item.type === 'dir' ? 'Double-click to open · drag it to add every video inside' : `Double-click or drag to ${addLabel.toLowerCase()}`}
          >
            <input
              type="checkbox"
              checked={selected.has(item.path)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggle(item)}
              aria-label={`Select ${item.name}`}
            />
            {item.type === 'dir' ? (
              <button
                className="icon-btn folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setDir(item.path);
                }}
                title="Open folder"
              >
                {item.jobs ? <FolderOpen size={17} /> : <Folder size={17} />}
              </button>
            ) : (
              <FileVideo size={17} className="file-icon" />
            )}
            <span className="file-name">{item.name}</span>
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
                  {item.excluded && <span className="badge cancelled" title="Matches an exclude pattern; skipped when adding a folder">excluded</span>}
                  {item.jobs && <StatusBadge status={item.jobs} />}
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
