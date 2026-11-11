// What the About section shows: who made the app, its licence, release notes
// (from CHANGELOG.md, managed by DGS AutoVersion) and this installation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const AUTHOR = 'Gerry Dassi (DGSoft)';
export const LICENSE = 'GPL-2.0-only';
export const REPOSITORY = 'https://github.com/dassige/encforge';

const ROOT = path.join(import.meta.dirname, '../..');
const MAX_RELEASES = 30;

/**
 * Splits a Keep-a-Changelog style file into releases:
 * "## [1.3.0] - 2026/11/10" followed by "- item" lines (continuation lines are joined).
 * Empty "- " items (a version bump with no notes) are dropped.
 */
export function parseChangelog(text) {
  const releases = [];
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const head = /^##\s*\[?([^\]\s]+)\]?\s*(?:-\s*(.+))?$/.exec(raw.trim());
    if (head) {
      current = { version: head[1], date: head[2]?.trim() ?? null, notes: [] };
      releases.push(current);
      continue;
    }
    if (!current) continue;
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*]\s*/.test(line)) {
      const item = line.replace(/^[-*]\s*/, '').trim();
      if (item) current.notes.push(item);
    } else if (current.notes.length) {
      current.notes[current.notes.length - 1] += ` ${line}`;
    } else {
      current.notes.push(line);
    }
  }
  return releases.slice(0, MAX_RELEASES);
}

const readText = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

export function aboutInfo({ version, dataDir }) {
  const app = version.app?.version ?? null;
  const changelog = parseChangelog(readText(path.join(ROOT, 'CHANGELOG.md')));
  return {
    name: 'EncForge',
    author: AUTHOR,
    license: LICENSE,
    licenseText: readText(path.join(ROOT, 'LICENSE')),
    repositoryUrl: REPOSITORY,
    // GitHub Releases, made by scripts/release.cjs (npm run release).
    releaseNotesUrl: app ? `${REPOSITORY}/releases/tag/v${app}` : `${REPOSITORY}/releases`,
    releasesUrl: `${REPOSITORY}/releases`,
    versions: version,
    releases: changelog,
    runtime: {
      node: process.versions.node,
      os: `${os.type()} ${os.release()} (${process.arch})`,
      docker: fs.existsSync('/.dockerenv'),
      dataDir,
    },
  };
}
