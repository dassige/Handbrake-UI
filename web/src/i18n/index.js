import { cloneElement, createElement, Fragment, isValidElement, useSyncExternalStore } from 'react';

/**
 * Translations for the UI.
 *
 * Strings live in locales/<lang>/<namespace>.json (nested objects); a key is
 * "<namespace>.<path>", e.g. t('settings.folders.title'). English is bundled; the other
 * languages are loaded on demand. A key missing in a language falls back to English.
 *
 *   t('queue.added', { count: 3 })   → picks "added_one" / "added_other" (Intl plural rules)
 *   t('app.until', { time: '03:40' }) → "until {time}" with {time} filled in
 *   rich('app.watchMsg', { path: <strong>…</strong> })
 *                                    → React nodes; the string may also use <strong>, <b>, <em>,
 *                                      <code>, <kbd> and <small> tags
 *
 * Never call t() at module level: the language can change while the app runs. Keep keys
 * (or functions) in module-level tables and translate when rendering.
 */

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
];
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
const STORAGE_KEY = 'hbq.language';

const english = import.meta.glob('./locales/en/*.json', { eager: true, import: 'default' });
const lazy = import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json'], { import: 'default' });
const helpLazy = import.meta.glob(['../help/help.*.json'], { import: 'default' });

/** { "settings.folders.title": "Sources folders", ... } from { "<path>/settings.json": {...} }. */
function flatten(files) {
  const out = new Map();
  const walk = (prefix, value) => {
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(`${prefix}.${k}`, v);
    else if (typeof value === 'string') out.set(prefix, value);
  };
  for (const [file, json] of Object.entries(files)) walk(file.match(/([^/]+)\.json$/)[1], json);
  return out;
}

const EN = flatten(english);
const pluralRules = new Map();
const plural = (lang, n) => {
  if (!pluralRules.has(lang)) pluralRules.set(lang, new Intl.PluralRules(lang));
  return pluralRules.get(lang).select(n);
};

let state = { lang: 'en', strings: EN, help: null };
const listeners = new Set();
const loaded = new Map([['en', { strings: EN, help: null }]]);

async function load(lang) {
  if (loaded.has(lang)) return loaded.get(lang);
  const prefix = `./locales/${lang}/`;
  const files = Object.entries(lazy).filter(([p]) => p.startsWith(prefix));
  const json = await Promise.all(files.map(([p, imp]) => imp().then((j) => [p, j])));
  const helpFile = helpLazy[`../help/help.${lang}.json`];
  const help = helpFile ? (await helpFile()).topics : null;
  const entry = { strings: flatten(Object.fromEntries(json)), help };
  loaded.set(lang, entry);
  return entry;
}

/** The language the browser prefers, if the app has it; else English. */
export function browserLanguage() {
  const prefs = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const p of prefs) {
    const code = String(p ?? '').toLowerCase().split('-')[0];
    if (LANGUAGE_CODES.includes(code)) return code;
  }
  return 'en';
}

/** 'auto' (or anything unknown) → the browser's language. */
export function resolveLanguage(setting) {
  return LANGUAGE_CODES.includes(setting) ? setting : browserLanguage();
}

/** Switches the UI language (loads it first if needed) and re-renders whoever uses useLanguage(). */
export async function setLanguage(setting) {
  const lang = resolveLanguage(setting);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // private window or blocked storage: the next start shows English until the settings load
  }
  if (lang === state.lang) return;
  let entry;
  try {
    entry = await load(lang);
  } catch (err) {
    console.error(`Cannot load the ${lang} translation`, err);
    return;
  }
  state = { lang, ...entry };
  document.documentElement.lang = lang;
  for (const l of listeners) l();
}

/** Before the first render: the language used last time (the settings arrive a moment later). */
export function initLanguage() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return setLanguage(saved ?? 'auto');
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The current language code; the component re-renders when it changes. */
export function useLanguage() {
  return useSyncExternalStore(subscribe, () => state.lang);
}

export const currentLanguage = () => state.lang;

/** Locale for Intl / toLocale*: the browser's own variant when it speaks the UI language (en-NZ dates for English). */
export function intlLocale() {
  const nav = typeof navigator === 'undefined' ? null : navigator.language;
  return nav && nav.toLowerCase().split('-')[0] === state.lang ? nav : state.lang;
}

function find(strings, lang, key, count) {
  if (count != null) {
    const n = Number(count);
    return strings.get(`${key}_${plural(lang, n)}`) ?? (n === 0 ? strings.get(`${key}_zero`) : undefined) ?? strings.get(`${key}_other`) ?? strings.get(key);
  }
  return strings.get(key);
}

function lookup(key, count) {
  const s = find(state.strings, state.lang, key, count) ?? find(EN, 'en', key, count);
  if (s == null && import.meta.env?.DEV) console.warn(`i18n: missing key ${key}`);
  return s ?? key;
}

/** True when the key exists (in English at least). */
export const has = (key) => EN.has(key) || EN.has(`${key}_other`);

const VAR = /\{(\w+)\}/g;

/** The translated string, with {name} placeholders filled in from vars (count also picks the plural form). */
export function t(key, vars) {
  const s = lookup(key, vars?.count);
  return vars ? s.replace(VAR, (m, name) => (vars[name] == null ? m : String(vars[name]))) : s;
}

const TAGS = new Set(['strong', 'b', 'em', 'i', 'code', 'kbd', 'small']);
const TOKEN = /<(\w+)>([\s\S]*?)<\/\1>|\{(\w+)\}/g;

function richNodes(text, vars, keyPrefix) {
  const out = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}${i++}`;
    if (m[1]) {
      const inner = richNodes(m[2], vars, `${key}.`);
      out.push(TAGS.has(m[1]) ? createElement(m[1], { key }, ...inner) : createElement(Fragment, { key }, m[0]));
    } else {
      const v = vars?.[m[3]];
      if (v == null) out.push(m[0]);
      else out.push(isValidElement(v) ? cloneElement(v, { key }) : String(v));
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Like t(), but returns React nodes: vars may be elements, and <strong>…</strong> style tags become elements. */
export function rich(key, vars) {
  return createElement(Fragment, null, ...richNodes(lookup(key, vars?.count), vars, 'r'));
}

/** Help topics in the current language; a topic not translated yet comes back in English. */
export function translatedHelp(englishTopics) {
  const tr = state.help;
  if (!tr) return englishTopics;
  return Object.fromEntries(Object.entries(englishTopics).map(([id, topic]) => [id, tr[id] ?? topic]));
}
