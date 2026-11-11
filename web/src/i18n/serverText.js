// Text that the server sends as data (not as error messages), shown in the user's language.
// The server adds a `code` (and `params`) next to its English text; anything without a code
// (e.g. results stored before codes existed) is shown in English, as it came.
// Strings live in locales/<lang>/server.json.
import { has, t } from './index.js';

/**
 * The translated text for code + params under prefix, or null when there is no such key.
 * A sourceLabel param ('source', 'parts') picks a variant: prefix.code.source.
 */
function fromCode(prefix, code, params = {}) {
  if (!code) return null;
  const key = `${prefix}.${code}`;
  if (params?.sourceLabel != null && has(`${key}.${params.sourceLabel}`)) return t(`${key}.${params.sourceLabel}`, params);
  return has(key) ? t(key, params ?? {}) : null;
}

// Reasons stored as English text only (watch folder history keeps the reason, not the code).
const SKIP_CODES = {
  'no video files in folder': 'noVideoInFolder',
  'not a video file': 'notVideo',
  'already in the queue': 'alreadyQueued',
  'already converted': 'alreadyConverted',
  'not added': 'notAdded',
};

/**
 * A file skipped when adding to the queue: { path, reason, code? } → "already converted".
 * Also works with just { reason } (e.g. a watch folder's note).
 */
export const skipReason = (skipped) =>
  fromCode('server.skip', skipped.code ?? SKIP_CODES[skipped.reason]) ?? skipped.reason;

/** A quality issue: { kind, text, code?, params? } → "Old video codec: mpeg2video". */
export function qualityIssue(issue) {
  const params = { ...issue.params };
  if (params.resolution && has(`server.quality.resolutionClass.${params.resolution}`)) {
    params.resolution = t(`server.quality.resolutionClass.${params.resolution}`);
  }
  return fromCode('server.quality.issue', issue.code, params) ?? issue.text;
}

/** The name of a check after conversion: { id, label, status, detail, ... } → "Audio tracks". */
export const checkLabel = (check) => fromCode('server.check.label', check.labelCode, check.labelParams) ?? check.label;

const detail = (code, params) => fromCode('server.check.detail', code, params);

/** The result of a check after conversion → "2 (eng, ita)". */
export function checkDetail(check) {
  const params = { ...check.detailParams };
  // Lists the server sends as items: rebuilt here, then joined.
  if (Array.isArray(params.tracks)) {
    const parts = params.tracks.map(({ code, ...p }) => detail(code, p));
    if (parts.some((p) => p == null)) return check.detail;
    params.tracks = parts.join('; ');
  }
  if (Array.isArray(params.list)) {
    params.list = params.list.map((s) => detail(s.noLines ? 'subtitleItemNoLines' : 'subtitleItem', s) ?? '').join(', ');
  }
  if (check.detailCode === 'audioTracksShort') return params.tracks ?? check.detail;
  return detail(check.detailCode, params) ?? check.detail;
}

/** Why a check did not run: the verify result { status: 'skipped', note, noteCode? } → "Check stopped". */
export const checkNote = (verify) => fromCode('server.check.note', verify.noteCode) ?? verify.note;

// The renamer's warnings stay English strings (they are also matched, joined and stored by the
// server), so they are recognised here by their wording.
const RENAME_WARNINGS = [
  [/^no show name: type it in “Show name”$/, 'noShowName'],
  [/^no episode number \(S01E02 or 1x02\) found$/, 'noEpisode'],
  [/^no year found$/, 'noYear'],
  [/^text after the year was dropped: “(?<text>.*)”$/s, 'textAfterYear'],
  [/^name already taken; using “(?<name>.*)”$/s, 'nameTaken'],
  [/^step “(?<step>.*?)” failed: (?<message>.*)$/s, 'stepFailed'],
];

/** A rename warning (a string, or { code, params, text }) → "no year found". */
export function renameWarning(w) {
  if (typeof w !== 'string') return fromCode('server.rename', w.code, w.params) ?? w.text;
  for (const [re, code] of RENAME_WARNINGS) {
    const m = re.exec(w);
    if (m) return fromCode('server.rename', code, { ...m.groups }) ?? w;
  }
  return w;
}

// Notes stored on jobs as English text (rename_note column), recognised by their wording.
const RENAME_NOTES = [
  [/^Needs rename: (?<warnings>.*)$/s, 'needsRename'],
  [/^Not renamed automatically: the check found problems$/, 'checkFailed'],
  [/^Automatic rename failed: (?<message>.*)$/s, 'failed'],
  [/^Merged into (?<name>.*); this part was removed$/s, 'merged'],
];

/** A job's rename note → "Needs rename: no year found". */
export function renameNote(note) {
  if (!note) return note;
  for (const [re, code] of RENAME_NOTES) {
    const m = re.exec(note);
    if (!m) continue;
    const params = { ...m.groups };
    if (params.warnings != null) params.warnings = params.warnings.split('; ').map(renameWarning).join('; ');
    return fromCode('server.renameNote', code, params) ?? note;
  }
  return note;
}

/** A merge compatibility problem: { level, message, code?, params? } → "Episode 2 (part 2): audio track 1 is AC-3, part 1 has AAC." */
export function mergeProblem(problem) {
  const p = problem.params ?? {};
  if (!problem.code || !has(`server.merge.problem.${problem.code}`)) return problem.message;
  const params = { ...p };
  if (p.part != null) params.part = t('server.merge.part', { name: p.name, part: p.part });
  if (p.type) params.track = t(`server.merge.track.${p.type}`, { track: p.track });
  if (Array.isArray(p.diff)) params.diff = p.diff.map((d) => t(`server.merge.layoutDiff.${d.type}`, d)).join(', ');
  return t(`server.merge.problem.${problem.code}`, params);
}

/** Why a file can't be deleted: { path, reason, code?, params? }. */
export const deleteReason = (blocked) => fromCode('server.delete', blocked.code, blocked.params) ?? blocked.reason;

/** Why a full restore can't run now (backup inspection) → "a conversion is running", or null. */
export const backupBusy = (inspection) =>
  inspection.busy ? fromCode('server.backup.busy', inspection.busyCode) ?? inspection.busy : null;

/** The warnings of a backup inspection, translated when the server sent them as data. */
export function backupWarnings(inspection) {
  const missing = inspection.missingFolders;
  if (!Array.isArray(missing) || missing.length !== inspection.warnings.length) return inspection.warnings;
  return missing.map((folder) => t('server.backup.missingFolder', { folder }));
}
