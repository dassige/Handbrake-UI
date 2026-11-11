import { useCallback } from 'react';
import { api } from '../api.js';
import { bytes, fileName } from '../format.js';
import { useDialogs } from './Dialogs.jsx';
import { rich, t } from '../i18n/index.js';
import { deleteReason } from '../i18n/serverText.js';

const SHOW = 10;

function Blocked({ list }) {
  if (!list.length) return null;
  return (
    <>
      <p className="small"><strong>{t('components.delete.notDeleted')}</strong></p>
      <ul className="ask-list small">
        {list.slice(0, SHOW).map((b) => (
          <li key={b.path}>
            {fileName(b.path)}: <span className="muted">{deleteReason(b)}</span>
          </li>
        ))}
        {list.length > SHOW && <li className="muted">{t('components.delete.more', { count: list.length - SHOW })}</li>}
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
        await dialogs.alert({ title: t('components.delete.nothingTitle'), danger: true, message: <Blocked list={blocked} /> });
        return false;
      }
      const folders = items.filter((i) => i.type === 'dir');
      const ok = await dialogs.choose({
        title: t('components.delete.title'),
        icon: 'warn',
        cancelValue: false,
        message: (
          <>
            <p>
              {rich(
                folders.length === 0 ? 'components.delete.summary'
                  : folders.length === 1 ? 'components.delete.summaryFolder' : 'components.delete.summaryFolders',
                {
                  what: <strong>{items.length === 1 ? fileName(items[0].path) : t('components.delete.items', { count: items.length })}</strong>,
                  files: t('common.files.count', { count: preview.files }),
                  size: bytes(preview.bytes),
                  folders: t('common.folders.count', { count: folders.length }),
                },
              )}
            </p>
            {items.length > 1 && (
              <ul className="ask-list small">
                {items.slice(0, SHOW).map((i) => (
                  <li key={i.path}>
                    {fileName(i.path)}{i.type === 'dir' ? '/' : ''}{' '}
                    <span className="muted">
                      {i.type === 'dir' ? `${t('common.files.count', { count: i.files })}, ` : ''}{bytes(i.bytes)}
                    </span>
                  </li>
                ))}
                {items.length > SHOW && <li className="muted">{t('components.delete.more', { count: items.length - SHOW })}</li>}
              </ul>
            )}
            <Blocked list={blocked} />
            <p className="text-bad small">
              {t('components.delete.warning')}
            </p>
          </>
        ),
        buttons: [
          { label: t('common.cancel'), value: false, autoFocus: true },
          { label: items.length === 1 ? t('common.delete') : t('components.delete.deleteItems', { count: items.length }), value: true, danger: true },
        ],
      });
      if (!ok) return false;
      try {
        const r = await api.deleteFiles(items.map((i) => i.path));
        if (r.deleted.length) onNotice?.(t('components.delete.deleted', { count: r.deleted.length }));
        const problems = [...r.blocked, ...r.errors];
        if (problems.length) onError?.(new Error(t('components.delete.notDeletedList', { list: problems.map((b) => `${fileName(b.path)} (${deleteReason(b)})`).join('; ') })));
        return r.deleted.length > 0;
      } catch (e) {
        onError?.(e);
        return false;
      }
    },
    [dialogs, onError, onNotice],
  );
}
