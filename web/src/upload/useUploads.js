import { useCallback, useMemo, useRef, useState } from 'react';
import { api, sendChunk } from '../api.js';
import { t } from '../i18n/index.js';

const CHUNK = 32 * 1024 * 1024;
const MAX_RETRIES = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;

/**
 * Upload manager: files are sent one at a time, in chunks, while the rest of the
 * app stays usable. A failed chunk is retried from the size the server has, so
 * a dropped connection only costs the chunk in flight.
 *
 * Item: { id, file, dir, name, size, sent, status, error, path, startedAt, startSent }
 * status: waiting | uploading | done | failed | cancelled
 */
export function useUploads({ onError } = {}) {
  const [items, setItems] = useState([]);
  const listRef = useRef([]);
  const busy = useRef(false);
  const current = useRef(null); // { id, abort }
  const cancelled = useRef(new Set());
  const lastPaint = useRef(0);
  const errRef = useRef(onError);
  errRef.current = onError;

  const mutate = useCallback((fn, paint = true) => {
    listRef.current = fn(listRef.current);
    if (paint) setItems(listRef.current);
  }, []);
  const patch = useCallback(
    (id, p, paint = true) => mutate((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)), paint),
    [mutate],
  );

  /** Where the server is for this file (0 when nothing is there yet). */
  const serverOffset = async (item) => {
    const r = await api.uploadCheck(item.dir, [{ name: item.name, size: item.size }]);
    const f = r.files[0];
    if (f.error) throw new Error(f.error);
    return f.partial ?? 0;
  };

  const uploadOne = useCallback(
    async (item) => {
      let offset = await serverOffset(item);
      patch(item.id, { sent: offset, startSent: offset, startedAt: Date.now() });
      let retries = 0;
      while (offset < item.size) {
        if (cancelled.current.has(item.id)) return;
        const end = Math.min(item.size, offset + CHUNK);
        const base = offset;
        const target = { dir: item.dir, name: item.name, size: item.size, offset: base };
        const { promise, abort } = sendChunk(target, item.file.slice(base, end), (n) => {
          // Repaint at most 4 times a second.
          const now = Date.now();
          const paint = now - lastPaint.current > 250;
          if (paint) lastPaint.current = now;
          patch(item.id, { sent: base + n }, paint);
        });
        current.current = { id: item.id, abort };
        try {
          const r = await promise;
          retries = 0;
          offset = r.offset;
          if (r.done) {
            patch(item.id, { status: 'done', sent: item.size, path: r.path });
            return;
          }
          patch(item.id, { sent: offset });
        } catch (e) {
          if (e.aborted || cancelled.current.has(item.id)) return;
          // Refused (bad request, signed out, not allowed): trying again would not help.
          if ([400, 401, 403].includes(e.status) || ++retries > MAX_RETRIES) throw e;
          patch(item.id, { error: t('upload.errors.retrying', { error: e.message }) });
          await sleep(Math.min(30_000, 1000 * 2 ** (retries - 1)));
          offset = await serverOffset(item);
          patch(item.id, { sent: offset, error: null });
        } finally {
          current.current = null;
        }
      }
    },
    [patch],
  );

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (;;) {
        const next = listRef.current.find((x) => x.status === 'waiting');
        if (!next) break;
        patch(next.id, { status: 'uploading', error: null });
        try {
          await uploadOne(next);
        } catch (e) {
          if (!cancelled.current.has(next.id)) {
            patch(next.id, { status: 'failed', error: e.message });
            errRef.current?.(new Error(t('upload.errors.failed', { name: next.name, error: e.message })));
          }
        }
      }
    } finally {
      busy.current = false;
    }
  }, [patch, uploadOne]);

  const api_ = useMemo(
    () => ({
      /** Adds files: [{ file, dir, name, size }]. */
      add(files) {
        const added = files.map((f) => ({ ...f, id: nextId++, sent: 0, status: 'waiting', error: null, path: null }));
        mutate((l) => [...l, ...added]);
        pump();
      },
      /** Stops a file and throws away what was sent. */
      async cancel(id) {
        const item = listRef.current.find((x) => x.id === id);
        if (!item || !['waiting', 'uploading', 'failed'].includes(item.status)) return;
        cancelled.current.add(id);
        if (current.current?.id === id) current.current.abort();
        patch(id, { status: 'cancelled', error: null });
        // The server may still be closing the chunk in flight: try twice.
        for (let i = 0; i < 3; i++) {
          try {
            await api.uploadDiscard(item.dir, item.name, item.size);
            return;
          } catch {
            await sleep(1500);
          }
        }
      },
      retry(id) {
        cancelled.current.delete(id);
        patch(id, { status: 'waiting', error: null });
        pump();
      },
      clearFinished() {
        mutate((l) => l.filter((x) => ['waiting', 'uploading'].includes(x.status)));
      },
    }),
    [mutate, patch, pump],
  );

  return { items, ...api_ };
}
