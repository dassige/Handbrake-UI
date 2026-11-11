// ISO 639-2 languages as HandBrake knows them (libhb/lang.c, HandBrake 1.11.2):
// [code, English name, native name?]. Presets list audio and subtitle languages by code.
// In other UI languages the name comes from Intl.DisplayNames (the English one when Intl has none).
import { currentLanguage, intlLocale, t } from '../i18n/index.js';

export const LANGUAGES = [
  ["und", "Unknown"],
  ["aar", "Afar", "Qafar"],
  ["abk", "Abkhaz", "Аԥсуа бызшәа"],
  ["afr", "Afrikaans"],
  ["aka", "Akan"],
  ["sqi", "Albanian", "shqip"],
  ["amh", "Amharic", "አማርኛ"],
  ["ara", "Arabic", "العربية"],
  ["arg", "Aragonese", "aragonés"],
  ["hye", "Armenian", "Հայերեն"],
  ["asm", "Assamese", "অসমীয়া"],
  ["ava", "Avar", "магӏарул мацӏ"],
  ["ave", "Avestan"],
  ["aym", "Aymara", "Aymar aru"],
  ["aze", "Azerbaijani", "Azərbaycan­ılı"],
  ["bak", "Bashkir", "Башҡорт"],
  ["bam", "Bambara", "Bamana"],
  ["eus", "Basque", "euskara"],
  ["bel", "Belarusian", "Беларуская"],
  ["ben", "Bengali", "Bangla"],
  ["bih", "Bihari"],
  ["bis", "Bislama"],
  ["bos", "Bosnian", "bosanski"],
  ["bre", "Breton", "brezhoneg"],
  ["bul", "Bulgarian", "български"],
  ["mya", "Burmese", "ဗမာ"],
  ["cat", "Catalan", "català"],
  ["cha", "Chamorro", "Finu' Chamorro"],
  ["che", "Chechen", "Нохчийн Мотт"],
  ["zho", "Chinese", "中文"],
  ["chu", "Church Slavonic"],
  ["chv", "Chuvash", "Чӑвашла"],
  ["cor", "Cornish", "kernewek"],
  ["cos", "Corsican", "Corsu"],
  ["cre", "Cree"],
  ["hrv", "Croatian", "hrvatski"],
  ["ces", "Czech", "čeština"],
  ["dan", "Danish", "dansk"],
  ["div", "Divehi", "ދިވެހިބަސް"],
  ["nld", "Dutch", "Nederlands"],
  ["dzo", "Dzongkha", "རྫོང་ཁ"],
  ["eng", "English"],
  ["epo", "Esperanto", "esperanto"],
  ["est", "Estonian", "eesti"],
  ["ewe", "Ewe", "eʋegbe"],
  ["fao", "Faroese", "føroyskt"],
  ["fij", "Fijian", "Na Vosa Vakaviti"],
  ["fin", "Finnish", "suomi"],
  ["fra", "French", "Francais"],
  ["fil", "Filipino", "Wikang Filipino"],
  ["fry", "Western Frisian", "Frysk"],
  ["ful", "Fulah"],
  ["kat", "Georgian", "ქართული"],
  ["deu", "German", "Deutsch"],
  ["gla", "Gaelic (Scots)", "Gàidhlig"],
  ["glg", "Galician", "galego"],
  ["glv", "Manx", "Gaelg"],
  ["ell", "Greek, Modern", "Ελληνικά"],
  ["kal", "Greenlandic", "Kalaallisut"],
  ["grn", "Guarani", "Avañe’ẽ"],
  ["guj", "Gujarati", "ગુજરાતી"],
  ["hat", "Haitian"],
  ["hau", "Hausa"],
  ["heb", "Hebrew", "עברית"],
  ["her", "Herero", "Otjiherero"],
  ["hin", "Hindi", "हिंदी"],
  ["hmo", "Hiri Motu"],
  ["hun", "Hungarian", "magyar"],
  ["ibo", "Igbo"],
  ["isl", "Icelandic", "íslenska"],
  ["ido", "Ido"],
  ["iku", "Inuktitut"],
  ["ile", "Interlingue"],
  ["ina", "Interlingua"],
  ["ind", "Indonesian", "Bahasa Indonesia"],
  ["ipk", "Inupiaq"],
  ["gle", "Irish", "Gaeilge"],
  ["ita", "Italian", "italiano"],
  ["jav", "Javanese", "Basa Jawa"],
  ["jpn", "Japanese", "日本語"],
  ["kan", "Kannada"],
  ["kas", "Kashmiri", "کٲشُر"],
  ["kau", "Kanuri"],
  ["kaz", "Kazakh", "қазақ тілі"],
  ["khm", "Central Khmer", "ភាសាខ្មែរ"],
  ["kik", "Kikuyu", "Gikuyu"],
  ["kin", "Kinyarwanda"],
  ["kir", "Kirghiz", "قىرعىزچا"],
  ["kom", "Komi", "Коми кыв"],
  ["kon", "Kongo", "Kikongo"],
  ["kor", "Korean", "한국어"],
  ["kua", "Kuanyama", "Oshikwanyama"],
  ["kur", "Kurdish", "کوردی"],
  ["lao", "Lao", "ລາວ"],
  ["lat", "Latin", "lingua latīna"],
  ["lav", "Latvian", "latviešu"],
  ["lim", "Limburgish", "Limburgs"],
  ["lin", "Lingala", "lingála"],
  ["lit", "Lithuanian", "lietuvių"],
  ["ltz", "Luxembourgish", "Lëtzebuergesch"],
  ["lub", "Luba-Katanga", "Tshiluba"],
  ["lug", "Ganda", "Luganda"],
  ["mkd", "Macedonian", "македонски"],
  ["mah", "Marshallese", "Kajin M̧ajeļ"],
  ["mal", "Malayalam", "മലയാളം"],
  ["mri", "Maori", "Reo Māori"],
  ["mar", "Marathi", "मराठी"],
  ["msa", "Malay", "Bahasa Melayu"],
  ["mlg", "Malagasy"],
  ["mlt", "Maltese", "Malti"],
  ["mol", "Moldavian", "limba moldovenească"],
  ["mon", "Mongolian", "Монгол хэл"],
  ["nau", "Nauruan", "dorerin Naoero"],
  ["nav", "Navajo", "Diné bizaad"],
  ["nbl", "Ndebele, South", "Nrebele"],
  ["nde", "Ndebele, North", "isiNdebele"],
  ["ndo", "Ndonga", "Oshindonga"],
  ["nep", "Nepali", "नेपाली"],
  ["nno", "Norwegian Nynorsk", "nynorsk"],
  ["nob", "Norwegian Bokmål", "norsk bokmål"],
  ["nor", "Norwegian", "norsk"],
  ["iii", "Nuosu", "ꆈꌠ꒿"],
  ["nya", "Chewa", "Nyanja"],
  ["oci", "Occitan (post 1500); Provençal", "Occitan"],
  ["oji", "Ojibwe", "ᐊᓂᔑᓈᐯᒧᐎᓐ"],
  ["ori", "Oriya", "ଓଡ଼ିଆ"],
  ["orm", "Oromo", "Oromoo"],
  ["oss", "Ossetian; Ossetic", "Ирон æвзаг"],
  ["fas", "Persian", "فارسی"],
  ["pli", "Pali", "Pāli"],
  ["pol", "Polish", "polski"],
  ["por", "Portuguese", "Portugues"],
  ["pan", "Punjabi", "ਪੰਜਾਬੀ"],
  ["pus", "Pashto", "پښتو"],
  ["que", "Quechua", "runasimi"],
  ["ron", "Romanian", "română"],
  ["roh", "Romansh", "rumantsch"],
  ["run", "Rundi", "Ikirundi"],
  ["rus", "Russian", "русский"],
  ["smo", "Samoan", "Gagana fa'a Sāmoa"],
  ["sag", "Sango", "Sängö"],
  ["san", "Sanskrit", "संस्कृत"],
  ["srd", "Sardinian", "sardu"],
  ["srp", "Serbian", "srpski"],
  ["sin", "Sinhala", "සිංහල"],
  ["slk", "Slovak", "slovenčina"],
  ["slv", "Slovenian", "slovenščina"],
  ["sme", "Northern Sami", "davvisámegiella"],
  ["sna", "Shona", "chiShona"],
  ["snd", "Sindhi", "سنڌي"],
  ["som", "Somali", "Soomaali"],
  ["sot", "Sotho, Southern", "Sesotho"],
  ["spa", "Spanish", "español"],
  ["ssw", "Swati", "Siswati"],
  ["sun", "Sundanese", "Basa Sunda"],
  ["swa", "Swahili", "Kiswahili"],
  ["swe", "Swedish", "svenska"],
  ["tah", "Tahitian", "Reo Tahiti"],
  ["tgk", "Tajik", "Тоҷикӣ"],
  ["tam", "Tamil", "தமிழ்"],
  ["tat", "Tatar", "Татар"],
  ["tel", "Telugu", "తెలుగు"],
  ["tgl", "Tagalog", "Katagalugan"],
  ["tha", "Thai", "ไทย"],
  ["bod", "Tibetan", "བོད་ཡིག"],
  ["tir", "Tigrinya", "ትግርኛ"],
  ["ton", "Tonga (Tonga Islands)", "lea fakatonga"],
  ["tsn", "Tswana", "Setswana"],
  ["tso", "Tsonga", "Xitsonga"],
  ["tuk", "Turkmen", "Türkmen dili"],
  ["tur", "Turkish", "Türkçe"],
  ["twi", "Twi"],
  ["ukr", "Ukrainian", "українська"],
  ["urd", "Urdu", "اُردو"],
  ["uig", "Uyghur", "ئۇيغۇرچە"],
  ["uzb", "Uzbek", "O'zbekcha"],
  ["ven", "Venda", "Tshivenḓa"],
  ["vie", "Vietnamese", "Tiếng Việt"],
  ["vol", "Volapük"],
  ["cym", "Welsh", "Cymraeg"],
  ["wln", "Walloon", "Walon"],
  ["wol", "Wolof"],
  ["xho", "Xhosa", "isiXhosa"],
  ["yid", "Yiddish", "ייִדיש"],
  ["yor", "Yoruba", "Èdè Yorùbá"],
  ["zha", "Zhuang", "Vahcuengh"],
  ["zul", "Zulu", "isiZulu"],
];

const BY_CODE = new Map(LANGUAGES.map(([code, name, native]) => [code, { code, name, native }]));

// ISO 639-2/B (bibliographic) codes, which older presets may use, and their 639-2/T code above.
const BIBLIOGRAPHIC = {
  alb: 'sqi', arm: 'hye', baq: 'eus', bur: 'mya', chi: 'zho', cze: 'ces', dut: 'nld', fre: 'fra', geo: 'kat', ger: 'deu',
  gre: 'ell', ice: 'isl', mac: 'mkd', mao: 'mri', may: 'msa', per: 'fas', rum: 'ron', slo: 'slk', tib: 'bod', wel: 'cym',
};
// Two-letter codes for the common languages, for Intl implementations that don't map 639-2 codes themselves.
const TWO_LETTER = {
  ara: 'ar', bod: 'bo', ces: 'cs', cym: 'cy', dan: 'da', deu: 'de', ell: 'el', eng: 'en', eus: 'eu', fas: 'fa', fin: 'fi',
  fra: 'fr', heb: 'he', hin: 'hi', hun: 'hu', hye: 'hy', isl: 'is', ita: 'it', jpn: 'ja', kat: 'ka', kor: 'ko', mkd: 'mk',
  mri: 'mi', msa: 'ms', mya: 'my', nld: 'nl', nor: 'no', pol: 'pl', por: 'pt', ron: 'ro', rus: 'ru', slk: 'sk', spa: 'es',
  sqi: 'sq', swe: 'sv', tha: 'th', tur: 'tr', ukr: 'uk', vie: 'vi', zho: 'zh',
};
// Codes Intl names differently from HandBrake (a related language, or a macro-language): keep HandBrake's name.
const ENGLISH_ONLY = new Set(['bih', 'mol', 'tgl', 'twi']);

const displayNames = new Map();
/** The name of a language in the UI language, or null when Intl doesn't know it. */
function localName(code) {
  if (ENGLISH_ONLY.has(code) || currentLanguage() === 'en') return null;
  const locale = intlLocale();
  try {
    if (!displayNames.has(locale)) displayNames.set(locale, new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }));
    const tag = TWO_LETTER[code] ?? code;
    const name = displayNames.get(locale).of(tag);
    if (!name || name === tag || name === code || name === 'root') return null;
    // Intl writes some languages in lower case ("italiano"): capitalise them like a list entry.
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return null;
  }
}

/** The language for an ISO 639-2 code: { code, name (in the UI language), native? }, or null. */
export function language(code) {
  if (code === 'any') return { code, name: t('presets.languages.any'), native: null };
  if (code === 'und') return { code, name: t('common.unknown'), native: null };
  const l = BY_CODE.get(code) ?? BY_CODE.get(BIBLIOGRAPHIC[code]);
  if (!l) return null;
  const name = localName(l.code) ?? l.name;
  // No need to repeat the native name when the UI already shows it ("Italiano (italiano)").
  const native = l.native && l.native.toLocaleLowerCase() !== name.toLocaleLowerCase() ? l.native : null;
  return { code, name, native };
}

const sorted = new Map();
/** Every language as { code, name, native }, sorted by name in the UI language. */
export function languageList() {
  const locale = intlLocale();
  if (!sorted.has(locale)) {
    const collator = new Intl.Collator(locale);
    const list = LANGUAGES.map(([code]) => language(code));
    const [und, ...rest] = list; // "Unknown" stays first
    sorted.set(locale, [und, ...rest.sort((a, b) => collator.compare(a.name, b.name))]);
  }
  return sorted.get(locale);
}
