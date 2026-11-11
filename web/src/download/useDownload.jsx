import { useCallback } from 'react';
import { api } from '../api.js';
import { bytes, fileName } from '../format.js';
import { useDialogs } from '../components/Dialogs.jsx';
import { rich, t } from '../i18n/index.js';

/** Hands a URL to the browser's own download manager (progress, pause and resume live there). */
export function startDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns download(items), items = [{ path, type: 'file' | 'dir', size? }].
 * One file downloads straight away; folders, or several files, ask first.
 */
export function useDownload(onError) {
  const dialogs = useDialogs();

  return useCallback(
    async (items) => {
      if (!items.length) return;
      if (items.length === 1 && items[0].type === 'file') {
        startDownload(api.downloadUrl(items[0].path));
        return;
      }
      const onlyFiles = items.every((i) => i.type === 'file');
      let zip;
      try {
        zip = await api.prepareZip(items.map((i) => i.path));
      } catch (e) {
        onError?.(e);
        return;
      }
      const answer = await dialogs.choose({
        title: t('common.download'),
        icon: 'question',
        message: (
          <>
            <p>
              {onlyFiles
                ? t('download.dialog.summary', { count: zip.files, size: bytes(zip.contentSize) })
                : t('download.dialog.summaryFolders', { count: zip.files, size: bytes(zip.contentSize) })}
            </p>
            <p className="muted small">
              {onlyFiles ? `${t('download.dialog.separateHint')} ` : ''}
              {rich('download.dialog.zipHint', { name: zip.name })}
            </p>
          </>
        ),
        buttons: [
          { label: t('common.cancel'), value: null },
          ...(onlyFiles ? [{ label: t('download.dialog.separate'), value: 'files' }] : []),
          { label: t('download.dialog.zip', { size: bytes(zip.size) }), value: 'zip', primary: true, autoFocus: true },
        ],
      });
      if (answer === 'zip') startDownload(api.zipUrl(zip.id));
      if (answer === 'files') {
        for (const i of items) {
          startDownload(api.downloadUrl(i.path));
          // Browsers drop clicks that come too close together.
          await sleep(600);
        }
      }
    },
    [dialogs, onError],
  );
}

export const downloadTitle = (item) =>
  item.type === 'dir' ? t('download.title.folder', { name: fileName(item.path) }) : t('download.title.file', { name: fileName(item.path) });
