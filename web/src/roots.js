// Friendly names of the sources folders (Settings → Folders → Name).
import { t } from './i18n/index.js';

const base = (p) => String(p ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/** The name to show for a sources folder (or the target folder). */
export function rootLabel(settings, root) {
  if (!settings || !root) return root ?? '';
  if (root === settings.targetRoot) return t('misc.roots.target');
  return settings.sourceNames?.[root] || base(root);
}

/** True when p is root or inside it. */
export function isInsidePath(root, p) {
  if (!root || !p) return false;
  const r = root.replace(/[\\/]+$/, '');
  return p === r || p.startsWith(`${r}/`) || p.startsWith(`${r}\\`);
}

/** The watch-folder entry for a path, if that path is watched. */
export const watchedFolder = (settings, p) => settings?.watch?.folders?.find((f) => f.path === p) ?? null;

/** "Downloads / Show.S01" for a path inside a sources folder; the path itself otherwise. */
export function displayPath(settings, p) {
  const roots = [...(settings?.sourceRoots ?? []), settings?.targetRoot].filter(Boolean);
  const root = roots.filter((r) => isInsidePath(r, p)).sort((a, b) => b.length - a.length)[0];
  if (!root) return p;
  const rest = p.slice(root.replace(/[\\/]+$/, '').length).replace(/^[\\/]+/, '').split(/[\\/]/).filter(Boolean);
  return [rootLabel(settings, root), ...rest].join(' / ');
}
