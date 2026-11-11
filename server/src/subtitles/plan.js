// What happens to each sidecar of a job: embedded into the output, copied next to it, both or
// neither. Pure functions, so the rules can be tested without files.
import path from 'node:path';
import { fileTag, normLang } from './languages.js';
import { IMAGE_FORMATS, TEXT_FORMATS } from './text.js';

export const EMBED_MODES = ['never', 'missing', 'always'];
export const COPY_MODES = ['never', 'notEmbedded', 'always'];
export const DEFAULT_EMBED = 'missing';
export const DEFAULT_COPY = 'always';

/**
 * The modes for a job: its own choice, else the one set for the whole queue, else Settings.
 * Returns { embed, copy, embedFrom, copyFrom } (from: 'job' | 'queue' | 'settings').
 */
export function effectiveModes(job, settings) {
  const queue = settings.get('queueSubtitles') ?? {};
  const pick = (own, q, s) => (own ? [own, 'job'] : q ? [q, 'queue'] : [s, 'settings']);
  const [embed, embedFrom] = pick(job.subEmbed, queue.embed, settings.get('subtitleEmbed'));
  const [copy, copyFrom] = pick(job.subCopy, queue.copy, settings.get('subtitleCopy'));
  return { embed, copy, embedFrom, copyFrom };
}

/**
 * The subtitle languages the output will have from the source, following the preset's subtitle
 * selection (HandBrake: none / first / all tracks matching the language list; an empty list or
 * "any" matches every track). Returns { langs: Set, count }.
 */
export function outputSubtitleLangs(sourceSubs, preset) {
  const tracks = (sourceSubs ?? []).map((s) => normLang(s.lang));
  const behavior = preset?.SubtitleTrackSelectionBehavior ?? 'none';
  if (behavior === 'none' || !tracks.length) return { langs: new Set(), count: 0 };
  const list = (preset.SubtitleLanguageList ?? []).map((l) => (l === 'any' ? 'any' : normLang(l)));
  const any = !list.length || list.includes('any');
  const chosen = [];
  if (behavior === 'first') {
    if (any) chosen.push(tracks[0]);
    else {
      for (const l of list) {
        const i = tracks.indexOf(l);
        if (i >= 0) {
          chosen.push(tracks[i]);
          break;
        }
      }
    }
  } else {
    chosen.push(...tracks.filter((t) => any || list.includes(t)));
  }
  return { langs: new Set(chosen.filter(Boolean)), count: chosen.length };
}

/** Container family of a HandBrake format: mkv | mp4 | webm. */
export function containerOf(format) {
  if (/webm/.test(format ?? '')) return 'webm';
  if (/mp4|m4v|mov/.test(format ?? '')) return 'mp4';
  return 'mkv';
}

/** Whether a sidecar of this format can go into the container (text: HandBrake; pictures: mkvmerge). */
export function canEmbed(fileFormat, container) {
  if (TEXT_FORMATS.includes(fileFormat)) return container !== 'webm';
  if (IMAGE_FORMATS.includes(fileFormat)) return container === 'mkv';
  return false;
}

/**
 * Decides each sidecar. files: the job's sidecars (with include, lang, forced, sdh).
 * Returns [{ ...file, embed, copy, why }] where why says why it is or isn't embedded:
 * excluded | never | always | missing | present | unknownLang | container.
 */
export function planSubtitles({ files, sourceSubs, preset, format, embed, copy }) {
  const container = containerOf(format);
  const out = outputSubtitleLangs(sourceSubs, preset);
  return (files ?? []).map((f) => {
    if (f.include === false) return { ...f, embed: false, copy: false, why: 'excluded' };
    let doEmbed = false;
    let why;
    if (embed === 'never') why = 'never';
    else if (!canEmbed(f.format, container)) why = 'container';
    else if (embed === 'always') [doEmbed, why] = [true, 'always'];
    else if (f.lang) [doEmbed, why] = out.langs.has(f.lang) ? [false, 'present'] : [true, 'missing'];
    // No language: only when the output gets no subtitles at all from the source.
    else [doEmbed, why] = out.count ? [false, 'unknownLang'] : [true, 'missing'];
    const doCopy = copy === 'always' || (copy === 'notEmbedded' && !doEmbed);
    return { ...f, embed: doEmbed, copy: doCopy, why };
  });
}

/**
 * HandBrakeCLI arguments for the embedded text sidecars. items: [{ file, tmp }] in order, where
 * tmp is the UTF-8 SRT or SSA/ASS file written for HandBrake. The first forced one is marked as
 * the default track (HandBrake also marks it forced; it is only used for forced subtitles).
 */
export function handbrakeArgs(items) {
  const srt = items.filter((i) => path.extname(i.tmp) === '.srt');
  const ssa = items.filter((i) => path.extname(i.tmp) !== '.srt');
  const args = [];
  let defaultSet = false;
  for (const [kind, list] of [['srt', srt], ['ssa', ssa]]) {
    if (!list.length) continue;
    args.push(`--${kind}-file`, list.map((i) => i.tmp).join(','));
    args.push(`--${kind}-lang`, list.map((i) => i.file.lang || 'und').join(','));
    if (kind === 'srt') args.push('--srt-codeset', list.map(() => 'UTF-8').join(','));
    const forced = list.findIndex((i) => i.file.forced);
    if (!defaultSet && forced >= 0) {
      args.push(`--${kind}-default=${forced + 1}`);
      defaultSet = true;
    }
  }
  return args;
}

/**
 * Name of a copied sidecar next to the output, as media servers expect:
 * "<video name>.<lang>[.forced][.sdh].<ext>". taken: lower-case names already used (updated).
 */
export function targetName(outputPath, file, taken) {
  const base = path.basename(outputPath, path.extname(outputPath));
  const tags = [fileTag(file.lang), file.forced && 'forced', file.sdh && 'sdh'].filter(Boolean);
  const ext = file.format;
  for (let n = 1; ; n++) {
    const name = [base, ...tags, ...(n > 1 ? [String(n)] : [])].join('.') + `.${ext}`;
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      if (ext === 'idx') taken.add(`${name.slice(0, -4)}.sub`.toLowerCase());
      return name;
    }
  }
}
