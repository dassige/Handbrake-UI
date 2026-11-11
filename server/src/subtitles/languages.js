// Languages of subtitle files, recognised from words in their names ("Movie.en.srt",
// "Movie.ita.forced.srt", "Subs/2_English.srt") and from HandBrake's track languages.
// Each row: ISO 639-2/B code (what HandBrake's --srt-lang takes and writes into MKV), ISO 639-1
// code (used in the names of copied files: "Movie.en.srt"), then other words that mean it:
// 639-2/T codes and names in English, the language itself, Italian, German, French and Spanish.
const ROWS = [
  ['eng', 'en', 'english', 'inglese', 'englisch', 'anglais', 'ingles', 'inglés'],
  ['ita', 'it', 'italian', 'italiano', 'italienisch', 'italien'],
  ['ger', 'de', 'deu', 'german', 'deutsch', 'tedesco', 'allemand', 'aleman', 'alemán'],
  ['fre', 'fr', 'fra', 'french', 'francais', 'français', 'francese', 'französisch', 'frances', 'francés'],
  ['spa', 'es', 'spanish', 'espanol', 'español', 'castellano', 'spagnolo', 'spanisch', 'espagnol', 'esp'],
  ['por', 'pt', 'portuguese', 'portugues', 'português', 'portoghese', 'portugiesisch', 'portugais', 'brazilian', 'ptbr', 'pob'],
  ['dut', 'nl', 'nld', 'dutch', 'nederlands', 'olandese', 'niederländisch', 'néerlandais', 'flemish'],
  ['swe', 'sv', 'swedish', 'svenska', 'svedese', 'schwedisch', 'suédois', 'sueco'],
  ['nor', 'no', 'nob', 'nno', 'nb', 'nn', 'norwegian', 'norsk', 'norvegese', 'norwegisch', 'norvégien', 'noruego'],
  ['dan', 'da', 'danish', 'dansk', 'danese', 'dänisch', 'danois', 'danés'],
  ['fin', 'fi', 'finnish', 'suomi', 'finlandese', 'finnisch', 'finnois', 'finlandés'],
  ['ice', 'is', 'isl', 'icelandic', 'islenska', 'íslenska', 'islandese'],
  ['pol', 'pl', 'polish', 'polski', 'polacco', 'polnisch', 'polonais', 'polaco'],
  ['cze', 'cs', 'ces', 'czech', 'cesky', 'čeština', 'cestina', 'ceco', 'tschechisch', 'tchèque', 'checo'],
  ['slo', 'sk', 'slk', 'slovak', 'slovencina', 'slovenčina', 'slovacco'],
  ['slv', 'sl', 'slovenian', 'slovene', 'slovenscina', 'slovenščina', 'sloveno'],
  ['hun', 'hu', 'hungarian', 'magyar', 'ungherese', 'ungarisch', 'hongrois', 'húngaro'],
  ['rum', 'ro', 'ron', 'romanian', 'romana', 'română', 'rumeno', 'rumänisch', 'roumain', 'rumano'],
  ['gre', 'el', 'ell', 'greek', 'ellinika', 'greco', 'griechisch', 'grec', 'griego'],
  ['tur', 'tr', 'turkish', 'turkce', 'türkçe', 'turco', 'türkisch', 'turc'],
  ['rus', 'ru', 'russian', 'russkij', 'russo', 'russisch', 'russe', 'ruso'],
  ['ukr', 'uk', 'ukrainian', 'ucraino', 'ukrainisch', 'ukrainien', 'ucraniano'],
  ['bul', 'bg', 'bulgarian', 'bulgaro', 'bulgarisch', 'bulgare'],
  ['hrv', 'hr', 'croatian', 'hrvatski', 'croato', 'kroatisch', 'croate', 'croata'],
  ['srp', 'sr', 'serbian', 'srpski', 'serbo', 'serbisch', 'serbe', 'serbio'],
  ['bos', 'bs', 'bosnian', 'bosanski', 'bosniaco'],
  ['mac', 'mk', 'mkd', 'macedonian', 'macedone'],
  ['alb', 'sq', 'sqi', 'albanian', 'shqip', 'albanese'],
  ['est', 'et', 'estonian', 'eesti', 'estone'],
  ['lav', 'lv', 'latvian', 'latviesu', 'lettone'],
  ['lit', 'lt', 'lithuanian', 'lietuviu', 'lituano'],
  ['heb', 'he', 'hebrew', 'ebraico', 'hebräisch', 'hébreu', 'hebreo'],
  ['ara', 'ar', 'arabic', 'arabo', 'arabisch', 'arabe', 'árabe'],
  ['per', 'fa', 'fas', 'persian', 'farsi', 'persiano'],
  ['hin', 'hindi'], // "hi" is read as "hearing impaired", the usual meaning in subtitle names
  ['jpn', 'ja', 'japanese', 'giapponese', 'japanisch', 'japonais', 'japonés'],
  ['kor', 'ko', 'korean', 'coreano', 'koreanisch', 'coréen'],
  ['chi', 'zh', 'zho', 'chinese', 'cinese', 'chinesisch', 'chinois', 'chino', 'chs', 'cht', 'mandarin', 'cantonese'],
  ['tha', 'th', 'thai', 'tailandese'],
  ['vie', 'vi', 'vietnamese', 'vietnamita'],
  ['ind', 'id', 'indonesian', 'indonesiano', 'bahasa'],
  ['may', 'ms', 'msa', 'malay', 'malese'],
  ['cat', 'ca', 'catalan', 'catala', 'català', 'catalano'],
  ['baq', 'eu', 'eus', 'basque', 'euskara', 'basco'],
  ['glg', 'gl', 'galician', 'galego', 'galiziano'],
  ['wel', 'cy', 'cym', 'welsh', 'cymraeg', 'gallese'],
  ['gle', 'ga', 'irish', 'gaeilge', 'irlandese'],
  ['lat', 'la', 'latin', 'latino', 'latein'],
];

const BY_WORD = new Map();
const TWO = new Map();
for (const [code, two, ...words] of ROWS) {
  TWO.set(code, two.length === 2 ? two : null);
  for (const w of [code, two, ...words]) if (!BY_WORD.has(w)) BY_WORD.set(w, code);
}
export const LANGUAGE_CODES = ROWS.map((r) => r[0]);

/** ISO 639-2/B code for a word or code ("en", "eng", "fra", "English", "pt-BR"), or null. */
export function langFromWord(word) {
  if (!word) return null;
  const w = String(word).toLowerCase().normalize('NFC');
  return BY_WORD.get(w) ?? BY_WORD.get(w.split(/[-_]/)[0]) ?? null;
}

/** Normalises a track language from HandBrake or ffprobe ("fra" → "fre"); null for und/unknown. */
export function normLang(code) {
  if (!code || /^(und|unk|zxx|mis|mul)$/i.test(code)) return null;
  return langFromWord(code);
}

/** The short code used in file names: "en" for eng, or the 3-letter code when there is none. */
export function fileTag(code) {
  return (code && (TWO.get(code) ?? code)) || null;
}

// Words in a subtitle file's name that are flags rather than languages.
const FORCED = new Set(['forced', 'forzati', 'forzato', 'forcé', 'forces', 'force', 'erzwungen', 'foreign']);
const SDH = new Set(['sdh', 'hi', 'cc', 'hoh', 'hearing', 'hearingimpaired', 'nonudenti']);
const DEFAULT = new Set(['default']);

/**
 * Reads language and flags from the words of a subtitle file name that follow the video's
 * name ("en.forced", "2_English", "ita sdh"). Unknown words are ignored.
 */
export function readTags(rest) {
  const words = String(rest ?? '').toLowerCase().split(/[\s._\-[\]()]+/).filter(Boolean);
  let lang = null;
  let forced = false;
  let sdh = false;
  let isDefault = false;
  for (const w of words) {
    if (FORCED.has(w)) forced = true;
    else if (SDH.has(w)) sdh = true;
    else if (DEFAULT.has(w)) isDefault = true;
    else if (!lang && !/^\d+$/.test(w)) lang = langFromWord(w);
  }
  // "pt-BR" is split into two words above: try the whole thing too.
  if (!lang && /^[a-z]{2}-[a-z]{2}$/i.test(String(rest).trim())) lang = langFromWord(rest.trim());
  return { lang, forced, sdh, default: isDefault };
}
