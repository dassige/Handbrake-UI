import { useCallback } from 'react';
import { api } from '../api.js';
import { bytes, fileName } from '../format.js';
import { useDialogs } from '../components/Dialogs.jsx';

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
        title: 'Download',
        icon: 'question',
        message: (
          <>
            <p>
              {zip.files} file{zip.files === 1 ? '' : 's'}, {bytes(zip.contentSize)} in all
              {!onlyFiles && ', from the chosen folders and their sub-folders'}.
            </p>
            <p className="muted small">
              {onlyFiles
                ? 'Separate files can be paused and resumed in the browser; your browser may ask once whether this site may download several files. '
                : ''}
              One ZIP file (<code>{zip.name}</code>) keeps the folders, but an interrupted ZIP download must start again from the beginning.
            </p>
          </>
        ),
        buttons: [
          { label: 'Cancel', value: null },
          ...(onlyFiles ? [{ label: 'Separate files', value: 'files' }] : []),
          { label: `One ZIP (${bytes(zip.size)})`, value: 'zip', primary: true, autoFocus: true },
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
  item.type === 'dir' ? `Download the folder “${fileName(item.path)}” as a ZIP` : `Download “${fileName(item.path)}”`;
