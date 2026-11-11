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
 * One file downloads straight away, unless it is a video with subtitle files: then it asks
 * whether to take them too (one ZIP). Folders, or several files, ask first; the chosen videos'
 * subtitle files are included.
 */
export function useDownload(onError) {
  const dialogs = useDialogs();

  return useCallback(
    async (items) => {
      if (!items.length) return;
      if (items.length === 1 && items[0].type === 'file') {
        const file = items[0].path;
        let withSubs = null;
        try {
          if ((await api.downloadSubtitles([file])).count) withSubs = await api.prepareZip([file], undefined, true);
        } catch {
          // Asking failed: download the file alone.
        }
        if (!withSubs) {
          startDownload(api.downloadUrl(file));
          return;
        }
        const choice = await dialogs.choose({
          title: t('download.subtitles.title'),
          icon: 'question',
          message: (
            <>
              <p>{rich('download.subtitles.message', { count: withSubs.subtitles, name: <strong>{fileName(file)}</strong> })}</p>
              <p className="muted small">{rich('download.dialog.zipHint', { name: withSubs.name })}</p>
            </>
          ),
          buttons: [
            { label: t('common.cancel'), value: null },
            { label: t('download.subtitles.videoOnly'), value: 'video' },
            { label: t('download.subtitles.zip', { size: bytes(withSubs.size) }), value: 'zip', primary: true, autoFocus: true },
          ],
        });
        if (choice === 'video') startDownload(api.downloadUrl(file));
        if (choice === 'zip') startDownload(api.zipUrl(withSubs.id));
        return;
      }
      const onlyFiles = items.every((i) => i.type === 'file');
      let zip;
      try {
        zip = await api.prepareZip(items.map((i) => i.path), undefined, true);
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
            {zip.subtitles > 0 && <p className="muted small">{t('download.dialog.withSubtitles', { count: zip.subtitles })}</p>}
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
        for (const p of [...items.map((i) => i.path), ...(zip.subtitlePaths ?? [])]) {
          startDownload(api.downloadUrl(p));
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
