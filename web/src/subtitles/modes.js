import { t } from '../i18n/index.js';

// Same values as server/src/subtitles/plan.js. Labels: subtitles.embed.<mode>, subtitles.copy.<mode>.
export const EMBED_MODES = [
  { value: 'missing', labelKey: 'subtitles.embed.missing', hintKey: 'subtitles.embed.missingHint' },
  { value: 'always', labelKey: 'subtitles.embed.always', hintKey: 'subtitles.embed.alwaysHint' },
  { value: 'never', labelKey: 'subtitles.embed.never', hintKey: 'subtitles.embed.neverHint' },
];
export const COPY_MODES = [
  { value: 'always', labelKey: 'subtitles.copy.always', hintKey: 'subtitles.copy.alwaysHint' },
  { value: 'notEmbedded', labelKey: 'subtitles.copy.notEmbedded', hintKey: 'subtitles.copy.notEmbeddedHint' },
  { value: 'never', labelKey: 'subtitles.copy.never', hintKey: 'subtitles.copy.neverHint' },
];

export const embedLabel = (mode) => t(EMBED_MODES.find((m) => m.value === mode)?.labelKey ?? 'subtitles.embed.missing');
export const copyLabel = (mode) => t(COPY_MODES.find((m) => m.value === mode)?.labelKey ?? 'subtitles.copy.always');

/** What a job without its own choice gets: the queue's choice, else Settings'. */
export function inherited(settings) {
  const q = settings?.queueSubtitles ?? {};
  return {
    embed: q.embed ?? settings?.subtitleEmbed ?? 'missing',
    copy: q.copy ?? settings?.subtitleCopy ?? 'always',
    embedFrom: q.embed ? 'queue' : 'settings',
    copyFrom: q.copy ? 'queue' : 'settings',
  };
}

// Text formats can be edited; .idx/.sup are pictures.
export const TEXT_FORMATS = ['srt', 'vtt', 'ass', 'ssa'];

export const CODESETS = [
  { value: 'UTF-8', label: 'UTF-8' },
  { value: 'windows-1252', label: 'Windows-1252 (Western Europe)' },
  { value: 'iso-8859-15', label: 'ISO-8859-15 (Western Europe)' },
  { value: 'windows-1250', label: 'Windows-1250 (Central Europe)' },
  { value: 'iso-8859-2', label: 'ISO-8859-2 (Central Europe)' },
  { value: 'windows-1251', label: 'Windows-1251 (Cyrillic)' },
  { value: 'koi8-r', label: 'KOI8-R (Cyrillic)' },
  { value: 'windows-1253', label: 'Windows-1253 (Greek)' },
  { value: 'windows-1254', label: 'Windows-1254 (Turkish)' },
  { value: 'windows-1255', label: 'Windows-1255 (Hebrew)' },
  { value: 'windows-1256', label: 'Windows-1256 (Arabic)' },
  { value: 'windows-1257', label: 'Windows-1257 (Baltic)' },
  { value: 'utf-16le', label: 'UTF-16' },
  { value: 'gbk', label: 'GBK (Chinese, simplified)' },
  { value: 'big5', label: 'Big5 (Chinese, traditional)' },
  { value: 'shift_jis', label: 'Shift_JIS (Japanese)' },
  { value: 'euc-kr', label: 'EUC-KR (Korean)' },
];

export const FPS_VALUES = [23.976, 24, 25, 29.97, 30];

/** True when a sidecar has edits that change its text or timing (shown as "edited"). */
export function isEdited(edits) {
  const e = edits ?? {};
  return !!(e.offsetMs || e.fps || e.codeset || Object.keys(e.cleanup ?? {}).length);
}

/** 00:01:02,345 */
export function cueTime(ms) {
  const v = Math.max(0, Math.round(ms));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(v / 3_600_000))}:${p(Math.floor(v / 60_000) % 60)}:${p(Math.floor(v / 1000) % 60)},${p(v % 1000, 3)}`;
}
