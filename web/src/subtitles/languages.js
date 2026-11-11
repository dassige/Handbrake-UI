import { currentLanguage } from '../i18n/index.js';

// The subtitle languages the server knows (server/src/subtitles/languages.js): ISO 639-2/B code
// (what is stored) and the ISO 639-1 code used for its name in the UI language.
export const SUB_LANGUAGES = [
  ['eng', 'en'], ['ita', 'it'], ['ger', 'de'], ['fre', 'fr'], ['spa', 'es'], ['por', 'pt'], ['dut', 'nl'],
  ['swe', 'sv'], ['nor', 'no'], ['dan', 'da'], ['fin', 'fi'], ['ice', 'is'], ['pol', 'pl'], ['cze', 'cs'],
  ['slo', 'sk'], ['slv', 'sl'], ['hun', 'hu'], ['rum', 'ro'], ['gre', 'el'], ['tur', 'tr'], ['rus', 'ru'],
  ['ukr', 'uk'], ['bul', 'bg'], ['hrv', 'hr'], ['srp', 'sr'], ['bos', 'bs'], ['mac', 'mk'], ['alb', 'sq'],
  ['est', 'et'], ['lav', 'lv'], ['lit', 'lt'], ['heb', 'he'], ['ara', 'ar'], ['per', 'fa'], ['hin', 'hi'],
  ['jpn', 'ja'], ['kor', 'ko'], ['chi', 'zh'], ['tha', 'th'], ['vie', 'vi'], ['ind', 'id'], ['may', 'ms'],
  ['cat', 'ca'], ['baq', 'eu'], ['glg', 'gl'], ['wel', 'cy'], ['gle', 'ga'], ['lat', 'la'],
];
const TWO = new Map(SUB_LANGUAGES);

const namesCache = new Map();
function names() {
  const lang = currentLanguage();
  if (!namesCache.has(lang)) {
    try {
      namesCache.set(lang, new Intl.DisplayNames([lang], { type: 'language' }));
    } catch {
      namesCache.set(lang, null);
    }
  }
  return namesCache.get(lang);
}

/** "English" (in the UI language) for "eng"; the code itself when unknown. */
export function langName(code) {
  if (!code) return null;
  const name = names()?.of(TWO.get(code) ?? code);
  return name ? name.charAt(0).toLocaleUpperCase() + name.slice(1) : code;
}

/** Short label for badges: "EN", "IT", or the 3-letter code. */
export function langShort(code) {
  return (TWO.get(code) ?? code ?? '?').toUpperCase();
}

/** Languages sorted by name, for a <select>. */
export function languageOptions() {
  return SUB_LANGUAGES.map(([code]) => ({ code, name: langName(code) })).sort((a, b) => a.name.localeCompare(b.name));
}
