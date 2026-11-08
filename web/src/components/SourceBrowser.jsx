import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, FileVideo, Folder, FolderOpen, ListPlus, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { bytes, dateTime } from '../format.js';
import { FolderBadges, StatusBadge } from './StatusBadge.jsx';

export const DRAG_PATHS = 'application/x-hbui-paths';

export function SourceBrowser({ settings, changeTick, onAdd, onError }) {
  const [dir, setDir] = useState(null); // null = source root
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const lastClicked = useRef(null);
  const sourceRoot = settings?.sourceRoot;

  const load = useCallback(
    async (path, { keepSelection } = {}) => {
      setLoading(true);
      try {
        const r = await api.browse('source', path);
        setListing(r);
        if (!keepSelection) setSelected(new Set());
      } catch (e) {
        onError(e);
        if (path) setDir(null); // the folder vanished: go back to the root
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  // Reset to the root when the configured source folder changes.
  useEffect(() => setDir(null), [sourceRoot]);
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

  return (
    <section className="pane sources">
      <div className="pane-head">
        <h2>Sources</h2>
        <div className="pane-tools">
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
        <button className="btn primary small" disabled={!selected.size} onClick={() => onAdd([...selected])}>
          <ListPlus size={14} /> Add to queue
        </button>
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
            title={item.type === 'dir' ? 'Double-click to open · drag to the queue to add every video inside' : 'Double-click or drag to the queue to add'}
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
      <p className="hint">Drag files or folders to the queue. Ctrl/Shift-click to select several.</p>
    </section>
  );
}
