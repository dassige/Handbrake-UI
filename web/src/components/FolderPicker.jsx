import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, ChevronRight, Folder } from 'lucide-react';
import { api } from '../api.js';
import { rootLabel } from '../roots.js';
import { Modal } from './Modal.jsx';

/**
 * Lets you pick a folder under the sources folders by browsing the server, instead
 * of typing its path. onPick(path) gets the chosen folder.
 */
export function FolderPicker({ settings, title = 'Choose a folder', initial, onPick, onClose, onError, kind = 'source' }) {
  // kind 'any': the target folder too (the server only lets the app browse the configured folders).
  const roots = kind === 'any' ? [...settings.sourceRoots, settings.targetRoot] : settings.sourceRoots;
  const startRoot = roots.find((r) => initial && (initial === r || initial.startsWith(r))) ?? roots[0];
  const [root, setRoot] = useState(startRoot);
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (p) => {
      setLoading(true);
      try {
        setListing(await api.browse(kind, p));
      } catch (e) {
        onError?.(e);
      } finally {
        setLoading(false);
      }
    },
    [onError, kind],
  );

  useEffect(() => {
    load(initial && initial.startsWith(startRoot) ? initial : startRoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirs = (listing?.items ?? []).filter((i) => i.type === 'dir');

  return (
    <Modal
      title={title}
      onClose={onClose}
      className="picker-layer"
      footer={
        <>
          <span className="picker-path mono" title={listing?.path}>{listing?.path ?? '…'}</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!listing} onClick={() => onPick(listing.path)}>Choose this folder</button>
        </>
      }
    >
      {roots.length > 1 && (
        <div className="picker-roots" role="group" aria-label="Sources folder">
          {roots.map((r) => (
            <button
              key={r}
              type="button"
              className={`chip ${r === root ? 'active' : ''}`}
              onClick={() => {
                setRoot(r);
                load(r);
              }}
              title={r}
            >
              {rootLabel(settings, r)}
            </button>
          ))}
        </div>
      )}
      <nav className="crumbs picker-crumbs" aria-label="Folder">
        {listing?.parent && (
          <button className="icon-btn" title="Up one folder" onClick={() => load(listing.parent)}>
            <ArrowUp size={15} />
          </button>
        )}
        {(listing?.crumbs ?? []).map((c, i, all) => (
          <span key={c.path} className="crumb">
            {i > 0 && <ChevronRight size={14} className="muted" />}
            {i < all.length - 1 ? <button className="link" onClick={() => load(c.path)}>{c.name}</button> : <strong>{c.name}</strong>}
          </span>
        ))}
      </nav>
      <ul className="picker-list">
        {!loading && dirs.length === 0 && <li className="muted small">No sub-folders here.</li>}
        {dirs.map((d) => (
          <li key={d.path}>
            <button type="button" onClick={() => load(d.path)}>
              <Folder size={16} /> <span className="file-name">{d.name}</span> <ChevronRight size={14} className="muted" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
