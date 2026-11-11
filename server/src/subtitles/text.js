// Subtitle files as text: decoding (BOM, UTF-8, fallback codeset), parsing SRT, WebVTT and
// SSA/ASS into cues, the edits of the Subtitles tab (timing, frame rate, clean-up) and writing
// them back. Everything stays in memory: subtitle files are small.

export const TEXT_FORMATS = ['srt', 'vtt', 'ass', 'ssa'];
export const IMAGE_FORMATS = ['idx', 'sup'];

// Offered in the Subtitles tab; anything TextDecoder knows is accepted.
export const CODESETS = [
  'UTF-8', 'windows-1252', 'iso-8859-15', 'windows-1250', 'iso-8859-2', 'windows-1251', 'koi8-r',
  'windows-1253', 'windows-1254', 'windows-1255', 'windows-1256', 'windows-1257', 'utf-16le',
  'gbk', 'big5', 'shift_jis', 'euc-kr',
];

export function validCodeset(name) {
  try {
    new TextDecoder(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decodes a subtitle file. codeset: forced by the user, else BOM → UTF-8 → fallback.
 * Returns { text, codeset }.
 */
export function decode(buf, { codeset = null, fallback = 'windows-1252' } = {}) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (codeset) return { text: stripBom(new TextDecoder(codeset).decode(bytes)), codeset };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), codeset: 'UTF-8' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), codeset: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), codeset: 'utf-16be' };
  // UTF-16 without a BOM: every other byte of plain text is zero.
  const sample = bytes.subarray(0, 2000);
  let zeroOdd = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) zeroOdd++;
  if (sample.length > 20 && zeroOdd > sample.length / 4) return { text: new TextDecoder('utf-16le').decode(bytes), codeset: 'utf-16le' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), codeset: 'UTF-8' };
  } catch {
    return { text: new TextDecoder(fallback).decode(bytes), codeset: fallback };
  }
}

const stripBom = (s) => s.replace(/^﻿/, '');

// ------------------------------------------------------------------ time

const TIME = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[,.:](\d{1,3})/;

function parseTime(s) {
  const m = TIME.exec(s);
  if (!m) return null;
  const ms = Number(m[4].padEnd(3, '0'));
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + ms;
}

function srtTime(ms, sep = ',') {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3_600_000);
  const m = Math.floor(v / 60_000) % 60;
  const s = Math.floor(v / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(v % 1000).padStart(3, '0')}`;
}

/** ASS times: H:MM:SS.cc (centiseconds). */
function assTime(ms) {
  const v = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(v / 360_000);
  const m = Math.floor(v / 6000) % 60;
  const s = Math.floor(v / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(v % 100).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ parsing

/**
 * Parses subtitle text. Returns { format, cues: [{ start, end, text }], ass? } where text uses
 * "\n" between lines. For SSA/ASS, ass keeps every other line so the file can be written back.
 */
export function parse(text, format) {
  const clean = stripBom(text).replace(/\r\n?/g, '\n');
  if (format === 'ass' || format === 'ssa') return parseAss(clean, format);
  if (format === 'vtt') return { format, cues: parseBlocks(clean.replace(/^WEBVTT[^\n]*\n/, ''), true) };
  return { format: 'srt', cues: parseBlocks(clean, false) };
}

function parseBlocks(text, vtt) {
  const cues = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    if (vtt && /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseTime(a);
    const end = parseTime(b);
    if (start == null || end == null) continue;
    let body = lines.slice(i + 1).join('\n').replace(/\s+$/, '');
    if (vtt) body = body.replace(/<\/?(?:c|v|lang|ruby|rt)(?:[.\s][^>]*)?>/g, '').replace(/<\d{1,2}:\d{2}[^>]*>/g, '');
    cues.push({ start, end, text: body });
  }
  return cues;
}

function parseAss(text, format) {
  const lines = text.split('\n');
  let section = '';
  let fields = null;
  const cues = [];
  const out = [];
  for (const line of lines) {
    const sec = /^\s*\[(.+)\]\s*$/.exec(line);
    if (sec) section = sec[1].toLowerCase();
    if (section === 'events' && /^Format:/i.test(line)) {
      fields = line.slice(line.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
    }
    const dlg = section === 'events' && fields && /^Dialogue:/i.exec(line);
    if (!dlg) {
      out.push(line);
      continue;
    }
    const body = line.slice(line.indexOf(':') + 1).replace(/^ /, '');
    const parts = splitN(body, ',', fields.length);
    const si = fields.indexOf('start');
    const ei = fields.indexOf('end');
    const ti = fields.indexOf('text');
    const start = parseTime(parts[si] ?? '');
    const end = parseTime(parts[ei] ?? '');
    if (start == null || end == null || ti < 0) {
      out.push(line);
      continue;
    }
    // The text uses \N for line breaks; cues keep "\n" like the other formats.
    cues.push({ start, end, text: (parts[ti] ?? '').replace(/\\N/g, '\n'), parts, si, ei, ti, src: cues.length });
    out.push(cues.length - 1); // placeholder: where this event goes when written back
  }
  return { format, cues, ass: { lines: out } };
}

/** Splits on sep at most n - 1 times (the last field, the text, may contain commas). */
function splitN(s, sep, n) {
  const out = [];
  let rest = s;
  while (out.length < n - 1) {
    const i = rest.indexOf(sep);
    if (i < 0) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + 1);
  }
  out.push(rest);
  return out;
}

// ------------------------------------------------------------------ writing

/** Writes cues as SRT (CRLF line ends, numbered from 1). */
export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\r\n${srtTime(c.start)} --> ${srtTime(c.end)}\r\n${c.text.replace(/\n/g, '\r\n')}\r\n`).join('\r\n');
}

export function toVtt(cues) {
  return `WEBVTT\n\n${cues.map((c) => `${srtTime(c.start, '.')} --> ${srtTime(c.end, '.')}\n${c.text}\n`).join('\n')}`;
}

/** Writes a parsed SSA/ASS file back, with its events' new times and texts (removed ones left out). */
export function toAss(doc) {
  const kept = new Map(doc.cues.map((c) => [c.src ?? -1, c]));
  const out = [];
  for (const l of doc.ass.lines) {
    if (typeof l === 'string') out.push(l);
    else {
      const c = kept.get(l);
      if (!c) continue;
      const parts = [...c.parts];
      parts[c.si] = assTime(c.start);
      parts[c.ei] = assTime(c.end);
      parts[c.ti] = c.text.replace(/\n/g, '\\N');
      out.push(`Dialogue: ${parts.join(',')}`);
    }
  }
  return out.join('\r\n');
}

/** Writes a parsed document in format (srt, vtt, or the SSA/ASS it came from). */
export function serialize(doc, format = doc.format) {
  if (format === 'ass' || format === 'ssa') return toAss(doc);
  if (format === 'vtt') return toVtt(doc.cues);
  return toSrt(doc.cues);
}

// ------------------------------------------------------------------ edits

export const FPS_VALUES = [23.976, 24, 25, 29.97, 30];

// Credits and adverts that subtitle sites add: whole cues matching one of these are removed.
const ADS = [
  /\bwww\.|https?:\/\//i,
  /\b[\w-]+\.(com|org|net|info)\b/i,
  /opensubtitles|subscene|addic7ed|podnapisi|yts|yify|itasa|subsfactory|subspedia/i,
  /\b(subtitles?|subtitled|subs|synced?|sync|re-?synced?|corrected|ripped|encoded|translated|captioned)\s+(and\s+\w+\s+)?by\b/i,
  /advertise your product|become vip|support us/i,
  /sottotitoli\s+(a\s+cura|by|di)\b|traduzione\s+(a\s+cura|di)\b|revisione\s+(a\s+cura|di)\b/i,
  /untertitel\s+(von|by)\b|sous-titres?\s+(par|by)\b|subt[ií]tulos?\s+(por|by)\b/i,
];

/** True when edits change the text or timing (not just the codeset or the track's flags). */
export function hasTextEdits(edits) {
  const e = edits ?? {};
  return !!(e.offsetMs || (e.fps?.from && e.fps?.to && e.fps.from !== e.fps.to)
    || e.cleanup?.hi || e.cleanup?.tags || e.cleanup?.ads || e.cleanup?.overlaps);
}

/** Normalises edits coming from the web app; throws a message for bad values. */
export function normalizeEdits(e) {
  const out = {};
  if (e == null) return out;
  if (typeof e !== 'object') throw new Error('edits must be an object');
  if (e.offsetMs != null && e.offsetMs !== '') {
    const n = Math.round(Number(e.offsetMs));
    if (!Number.isFinite(n) || Math.abs(n) > 24 * 3_600_000) throw new Error('offsetMs must be a number of milliseconds');
    if (n) out.offsetMs = n;
  }
  if (e.fps?.from && e.fps?.to) {
    const from = Number(e.fps.from);
    const to = Number(e.fps.to);
    if (!FPS_VALUES.includes(from) || !FPS_VALUES.includes(to)) throw new Error(`fps must be one of ${FPS_VALUES.join(', ')}`);
    if (from !== to) out.fps = { from, to };
  }
  if (e.codeset) {
    if (!validCodeset(e.codeset)) throw new Error(`Unknown codeset: ${e.codeset}`);
    out.codeset = String(e.codeset);
  }
  const c = {};
  for (const k of ['hi', 'tags', 'ads', 'overlaps']) if (e.cleanup?.[k]) c[k] = true;
  if (Object.keys(c).length) out.cleanup = c;
  return out;
}

function cleanHi(text) {
  let t = text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[♪♫#]+/g, '');
  // "JOHN: Hello", "- MARY: Hi": a speaker's name in capitals before a colon.
  t = t.replace(/^(\s*-?\s*)[A-ZÀ-Ý][A-ZÀ-Ý0-9 .'-]{1,30}:\s*/gm, '$1');
  const lines = t.split('\n').map((l) => l.replace(/\s{2,}/g, ' ').trim()).filter((l) => l && !/^-+$/.test(l));
  // One line left of a two-person dialogue: drop its dash.
  if (lines.length === 1) lines[0] = lines[0].replace(/^-\s*/, '');
  return lines.join('\n');
}

function cleanTags(text, format) {
  let t = text.replace(/\{\\[^}]*\}/g, '');
  if (format !== 'ass' && format !== 'ssa') t = t.replace(/<[^>]+>/g, '');
  return t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

/**
 * Applies the timing and clean-up edits to a parsed document (a copy is returned).
 * Order: frame rate, offset, clean-up, overlaps. Returns { doc, removed }.
 */
export function applyEdits(doc, edits = {}) {
  const ratio = edits.fps ? edits.fps.from / edits.fps.to : 1;
  const offset = edits.offsetMs ?? 0;
  const c = edits.cleanup ?? {};
  let removed = 0;
  let cues = doc.cues.map((cue, i) => ({ ...cue, src: cue.src ?? i }));
  cues = cues.map((cue) => ({ ...cue, start: cue.start * ratio + offset, end: cue.end * ratio + offset }));
  const out = [];
  for (const cue of cues) {
    let text = cue.text;
    if (c.ads && ADS.some((re) => re.test(text))) {
      removed++;
      continue;
    }
    if (c.hi) text = cleanHi(text);
    if (c.tags) text = cleanTags(text, doc.format);
    if (cue.end <= 0 || !text.trim()) {
      removed++;
      continue;
    }
    out.push({ ...cue, start: Math.max(0, Math.round(cue.start)), end: Math.round(cue.end), text });
  }
  if (c.overlaps) {
    out.sort((a, b) => a.start - b.start);
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i].end > out[i + 1].start) out[i].end = Math.max(out[i].start + 1, out[i + 1].start - 1);
    }
  }
  return { doc: { ...doc, cues: out }, removed };
}
