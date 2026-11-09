// Deleting files and folders from the sources folders, when the user asks for it.
// Never the target folder, a sources folder itself, anything in a protected
// sources folder, or a file that is queued or converting. preview() says exactly
// what would go, so the UI can ask for confirmation; remove() checks everything
// again before deleting.
import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';
import { resolveUnderAny } from './paths.js';

const MAX_PATHS = 1000;

export class SourceFiles {
  constructor({ settings, queue, events, log }) {
    this.settings = settings;
    this.queue = queue;
    this.events = events;
    this.log = log;
  }

  /** Splits the chosen paths into what can be deleted and what cannot (with the reason). */
  async check(paths) {
    if (!Array.isArray(paths) || !paths.length) throw badRequest('Choose files or folders to delete');
    if (paths.length > MAX_PATHS) throw badRequest(`At most ${MAX_PATHS} items at a time`);
    const items = [];
    const blocked = [];
    for (const p of [...new Set(paths)]) {
      let resolved;
      try {
        resolved = await resolveUnderAny(this.settings.get('sourceRoots'), p);
      } catch (err) {
        blocked.push({ path: p, reason: err.message });
        continue;
      }
      const { root, path: abs } = resolved;
      if (this.settings.get('protectedRoots').includes(root)) {
        blocked.push({ path: abs, reason: `Files in ${root} are protected from deletion (Settings → Folders)` });
        continue;
      }
      if (abs === root) {
        blocked.push({ path: abs, reason: 'A sources folder itself cannot be deleted (remove it in Settings instead)' });
        continue;
      }
      const st = await fs.lstat(abs);
      const pending = this.queue.pendingSourcesUnder(abs);
      if (pending.length) {
        const what = pending.length === 1 ? path.basename(pending[0].path) : `${pending.length} files inside`;
        blocked.push({ path: abs, reason: `${what} ${pending.length === 1 ? 'is' : 'are'} queued or converting; remove ${pending.length === 1 ? 'it' : 'them'} from the queue first` });
        continue;
      }
      const dir = st.isDirectory();
      const { files, bytes } = dir ? await measure(abs) : { files: 1, bytes: st.size };
      items.push({ path: abs, type: dir ? 'dir' : 'file', files, bytes });
    }
    // A file inside a folder that is also chosen goes with the folder.
    const dirs = items.filter((i) => i.type === 'dir').map((i) => i.path + path.sep);
    const kept = items.filter((i) => !dirs.some((d) => i.path.startsWith(d)));
    return {
      items: kept,
      blocked,
      files: kept.reduce((s, i) => s + i.files, 0),
      bytes: kept.reduce((s, i) => s + i.bytes, 0),
    };
  }

  preview({ paths }) {
    return this.check(paths);
  }

  /** Deletes what check() allows; returns { deleted, blocked, errors }. */
  async remove({ paths }) {
    const { items, blocked } = await this.check(paths);
    const deleted = [];
    const errors = [];
    for (const it of items) {
      try {
        await fs.rm(it.path, { recursive: it.type === 'dir' });
        deleted.push(it.path);
        this.log.info(`Deleted ${it.type === 'dir' ? 'folder' : 'file'} ${it.path} (${it.files} file(s), ${it.bytes} bytes)`);
      } catch (err) {
        errors.push({ path: it.path, reason: err.message });
      }
    }
    if (deleted.length) this.events.emit('files', { deleted: deleted.length });
    return { deleted, blocked, errors };
  }
}

/** Files and bytes inside a folder (symlinks counted, not followed). */
async function measure(dir) {
  let files = 0;
  let bytes = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await measure(full);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      files++;
      bytes += await fs.lstat(full).then((s) => s.size, () => 0);
    }
  }
  return { files, bytes };
}
