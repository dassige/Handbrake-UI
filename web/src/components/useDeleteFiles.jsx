import { useCallback } from 'react';
import { api } from '../api.js';
import { bytes, fileName } from '../format.js';
import { useDialogs } from './Dialogs.jsx';

const SHOW = 10;

function Blocked({ list }) {
  if (!list.length) return null;
  return (
    <>
      <p className="small"><strong>Not deleted:</strong></p>
      <ul className="ask-list small">
        {list.slice(0, SHOW).map((b) => (
          <li key={b.path}>
            {fileName(b.path)}: <span className="muted">{b.reason}</span>
          </li>
        ))}
        {list.length > SHOW && <li className="muted">… and {list.length - SHOW} more</li>}
      </ul>
    </>
  );
}

/**
 * Returns remove(paths): shows exactly what would be deleted, asks, then deletes.
 * Resolves to true when something was deleted.
 */
export function useDeleteFiles({ onError, onNotice }) {
  const dialogs = useDialogs();

  return useCallback(
    async (paths) => {
      if (!paths.length) return false;
      let preview;
      try {
        preview = await api.deletePreview(paths);
      } catch (e) {
        onError?.(e);
        return false;
      }
      const { items, blocked } = preview;
      if (!items.length) {
        await dialogs.alert({ title: 'Nothing can be deleted', danger: true, message: <Blocked list={blocked} /> });
        return false;
      }
      const folders = items.filter((i) => i.type === 'dir');
      const ok = await dialogs.choose({
        title: 'Delete from the server?',
        icon: 'warn',
        cancelValue: false,
        message: (
          <>
            <p>
              <strong>
                {items.length === 1 ? fileName(items[0].path) : `${items.length} items`}
              </strong>
              {' '}will be deleted for good: {preview.files} file{preview.files === 1 ? '' : 's'}, {bytes(preview.bytes)}
              {folders.length > 0 && <>, including everything inside {folders.length === 1 ? 'the folder' : `${folders.length} folders`}</>}.
            </p>
            {items.length > 1 && (
              <ul className="ask-list small">
                {items.slice(0, SHOW).map((i) => (
                  <li key={i.path}>
                    {fileName(i.path)}{i.type === 'dir' ? '/' : ''}{' '}
                    <span className="muted">
                      {i.type === 'dir' ? `${i.files} file${i.files === 1 ? '' : 's'}, ` : ''}{bytes(i.bytes)}
                    </span>
                  </li>
                ))}
                {items.length > SHOW && <li className="muted">… and {items.length - SHOW} more</li>}
              </ul>
            )}
            <Blocked list={blocked} />
            <p className="text-bad small">
              This cannot be undone. If a download client (e.g. Deluge) is still seeding these files, it will report them as missing.
            </p>
          </>
        ),
        buttons: [
          { label: 'Cancel', value: false, autoFocus: true },
          { label: items.length === 1 ? 'Delete' : `Delete ${items.length} items`, value: true, danger: true },
        ],
      });
      if (!ok) return false;
      try {
        const r = await api.deleteFiles(items.map((i) => i.path));
        if (r.deleted.length) onNotice?.(`Deleted ${r.deleted.length} item${r.deleted.length === 1 ? '' : 's'}`);
        const problems = [...r.blocked, ...r.errors];
        if (problems.length) onError?.(new Error(`Not deleted: ${problems.map((b) => `${fileName(b.path)} (${b.reason})`).join('; ')}`));
        return r.deleted.length > 0;
      } catch (e) {
        onError?.(e);
        return false;
      }
    },
    [dialogs, onError, onNotice],
  );
}
