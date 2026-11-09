// Recognises TV episodes and movies in "scene" style file names and formats
// them with templates such as "{show} S{season}e{episode}[ - {title}]".

const LANG = 'ita|eng|fre|fra|ger|deu|spa|esp|dan|jap|jpn|kor|rus|por|pol|swe|nor|fin|dut|nld|chi|ara';

/** Release tags that end the useful part of a name wherever they appear. */
const STRONG = [
  /^\d{3,4}[pi]$/i,
  /^(4k|uhd|hdr10\+?|hdr|10bit|8bit|sdr)$/i,
  /^(web-?dl|webdl|webrip|web-?mux|dlmux|bdmux|bdrip|brrip|bluray|blu-ray|dvdrip|dvdmux|hdtv|satrip|nfrip|uhdrip|hdrip|tvrip|dlrip|remux|amzn|dsnp|hmax|atvp|pcok|hulu|dsny)$/i,
  /^(x26[45]|h26[45]|hevc|avc|xvid|divx|av1|vp9)$/i,
  /^(aac|ac3|eac3|e-ac3|dts|dts-?hd|ddp?\d*|dd\+|truehd|atmos|mp3|flac|opus|aac\d+|\d+ch)$/i,
  /^(italian|italiano|multisub|subita|subeng|multi|repack|proper|internal)$/i,
  new RegExp(`^(${LANG})$`, 'i'),
  new RegExp(`^(${LANG})(-(${LANG}))+$`, 'i'),
];

/** Tags that are also ordinary words: they only end the name when another tag follows. */
const WEAK = /^(web|dvd|rip|mux|nf|max|sub|subs|dv|hd|sd|extended|remastered|uncut|dubbed|subbed|forced|limited|complete|dual|audio)$/i;

function bare(word) {
  return word.replace(/^[([{]+|[)\]},]+$/g, '');
}

export function isStrongTag(word, extra = []) {
  const w = bare(word);
  if (!w) return false;
  const first = w.split('-')[0];
  return STRONG.some((re) => re.test(w) || re.test(first)) || extra.some((t) => t.toLowerCase() === w.toLowerCase());
}

function isWeakTag(word) {
  return WEAK.test(bare(word));
}

/** Turns "Show.Name.S01E02.Title.1080p.H.264-GRP" into space separated words. */
export function tokenize(base) {
  return base
    .replace(/\b(H)\.(26[45])\b/gi, '$1$2')
    .replace(/\b(DDP?|AAC|DD|AC3)(\d)\.(\d)\b/gi, '$1$2$3')
    .replace(/(^|[ .])(\d)\.(\d)(?=[ .\-]|$)/g, '$1$2$3ch')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes everything from the first release tag on; drops bracketed tag groups. */
export function cutAtTags(text, extra = []) {
  const cleaned = text.replace(/[[(]([^\])]*)[\])]/g, (m, inner) => {
    const words = inner.split(/[\s]+/).filter(Boolean);
    return words.length && words.every((w) => isStrongTag(w, extra) || isWeakTag(w)) ? ' ' : m;
  });
  const words = cleaned.split(' ').filter(Boolean);
  let cut = words.length;
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    if (isStrongTag(words[i], extra) || (isWeakTag(words[i]) && next && (isStrongTag(next, extra) || isWeakTag(next)))) {
      cut = i;
      break;
    }
  }
  return trimSeparators(words.slice(0, cut).join(' '));
}

function trimSeparators(s) {
  return s.replace(/^[\s\-–—:,]+|[\s\-–—:,(]+$/g, '').trim();
}

const EPISODE_PATTERNS = [
  /\bS(\d{1,2}) ?E(\d{1,3})(?: ?-? ?E(\d{1,3}))?(?![\d])/i,
  /(?<![\dx])(\d{1,2})x(\d{2,3})(?![\dp])/i,
];
const YEAR = /\(?\b((?:19|20)\d\d)\b\)?/g;

/**
 * Parses a file base name (no extension).
 * Returns { type: 'tv'|'movie', show, year, season, episode, episode2, title, warnings }.
 */
export function parseName(base, { mode = 'auto', showOverride = '', showOverrideAll = false, extraTags = [] } = {}) {
  const s = tokenize(base);
  const warnings = [];
  let ep = null;
  for (const re of EPISODE_PATTERNS) {
    ep = re.exec(s);
    if (ep) break;
  }

  if (ep && mode !== 'movie') {
    let show = trimSeparators(s.slice(0, ep.index));
    let year = null;
    const y = /\s\(?((?:19|20)\d\d)\)?$/.exec(show);
    if (y && show.length > y[0].length) {
      year = y[1];
      show = show.slice(0, y.index).trim();
    }
    // Skip release flags right after the marker (e.g. "S07E11.REPACK.Title").
    const rest = s.slice(ep.index + ep[0].length).trim().split(' ');
    while (rest.length && /^(repack|proper|real|rerip|internal|extended|uncut)$/i.test(rest[0])) rest.shift();
    let title = cutAtTags(rest.join(' '), extraTags);
    const ty = /\s*\((?:19|20)\d\d\)$/.exec(title);
    if (ty) {
      year ??= ty[0].replace(/\D/g, '');
      title = title.slice(0, ty.index).trim();
    }
    // The typed show name fills a missing show, or replaces every show when asked.
    if (showOverride && (showOverrideAll || !show)) {
      // Names like "S04E07 Reacher Title": the show name sits inside the title.
      if (title.toLowerCase().startsWith(showOverride.toLowerCase() + ' ')) title = title.slice(showOverride.length + 1);
      else if (title.toLowerCase() === showOverride.toLowerCase()) title = '';
      show = showOverride;
    }
    if (!show) warnings.push('no show name: type it in “Show name”');
    return {
      type: 'tv', show, year, season: Number(ep[1]), episode: Number(ep[2]),
      episode2: ep[3] ? Number(ep[3]) : null, title: trimSeparators(title), warnings,
    };
  }

  if (mode === 'tv') warnings.push('no episode number (S01E02 or 1x02) found');
  const clean = cutAtTags(s, extraTags);
  const years = [...clean.matchAll(YEAR)].filter((m) => m.index > 0);
  if (years.length) {
    const m = years[years.length - 1];
    const after = trimSeparators(clean.slice(m.index + m[0].length));
    return {
      type: 'movie', title: trimSeparators(clean.slice(0, m.index)), year: m[1],
      warnings: after ? [...warnings, `text after the year was dropped: “${after}”`] : warnings,
    };
  }
  if (mode !== 'tv') warnings.push('no year found');
  return { type: mode === 'tv' ? 'tv' : 'movie', title: clean, year: null, show: '', warnings };
}

// ------------------------------------------------------------------ text fixes

const IT_ELISION = /\b(L|D|Dell|Nell|Sull|Dall|Coll|Quell|Sant|Tutt|Senz|Nient|Quant)\s+(?=[aeiouhàèéìòù])/gi;

/** "L Osservatore" -> "L'Osservatore", "Wouldn T" -> "Wouldn't", "Holston S Pick" -> "Holston's Pick". */
export function fixApostrophes(s) {
  return s
    .replace(IT_ELISION, "$1'")
    .replace(/\b(\w+n) [tT]\b/g, "$1't")
    .replace(/\b([A-Za-z]{2,}) [sS]\b(?! ?\d)/g, "$1's");
}

const ELIDED = /(^|[\s(\-])((?:L|D|Dell|Nell|Sull|Dall|Coll|Quell|Sant|Tutt|Senz|Nient|Quant|All|Un|C)')(\p{Ll})/giu;

/** Capitalises the first letter of each word; leaves the rest untouched (keeps "McLaren", "INXS"). */
export function titleCase(s) {
  return s
    .replace(/(^|[\s(\-–])(\p{Ll})/gu, (m, sep, ch) => sep + ch.toUpperCase())
    .replace(ELIDED, (m, sep, prefix, ch) => sep + prefix + ch.toUpperCase());
}

// ------------------------------------------------------------------ templates

const pad = (n, width = 2) => String(n).padStart(width, '0');

export function templateFields(p, { showYear = false } = {}) {
  const epWidth = Math.max(2, String(p.episode2 ?? p.episode ?? '').length);
  return {
    show: p.show ? (showYear && p.year ? `${p.show} (${p.year})` : p.show) : '',
    season: p.season != null ? pad(p.season) : '',
    episode: p.episode != null ? pad(p.episode, epWidth) + (p.episode2 ? `-e${pad(p.episode2, epWidth)}` : '') : '',
    title: p.title ?? '',
    year: p.year ?? '',
  };
}

/**
 * Renders "{show} S{season}e{episode}[ - {title}]". A [...] block disappears
 * when any field inside it is empty.
 */
export function renderTemplate(tpl, fields) {
  const fill = (part) => part.replace(/\{(\w+)\}/g, (m, k) => fields[k] ?? '');
  const withOptional = tpl.replace(/\[([^\]]*)\]/g, (m, inner) => {
    const keys = [...inner.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
    return keys.every((k) => fields[k]) ? fill(inner) : '';
  });
  return fill(withOptional);
}

/** Makes a string safe as a file name on Linux, SMB and Windows clients. */
export function sanitizeFileName(s) {
  return s
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[<>"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.\-]+|[\s.]+$/g, '');
}
