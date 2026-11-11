// Checks the web app's translations (web/src/i18n/locales/<lang>/*.json and web/src/help/help.<lang>.json)
// against English and against the code that uses them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.resolve(import.meta.dirname, '../../web/src');
const LOCALES = path.join(WEB_SRC, 'i18n/locales');
const LANGS = ['en', 'it', 'de', 'fr', 'es'];
const PLURAL = /_(zero|one|two|few|many|other)$/;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** { "settings.nav.folders": "Folders", ... } for one language. */
function catalog(lang) {
  const out = new Map();
  const dir = path.join(LOCALES, lang);
  if (!existsSync(dir)) return out;
  const walk = (prefix, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) walk(`${prefix}.${k}`, v);
    else out.set(prefix, value);
  };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) walk(f.replace(/\.json$/, ''), readJson(path.join(dir, f)));
  return out;
}

const en = catalog('en');
const base = (key) => key.replace(PLURAL, '');
const vars = (s) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
// Sorted: a translation may reorder tagged words within a sentence.
const tags = (s) => [...s.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort().join('');

test('i18n: English strings are non-empty strings', () => {
  assert.ok(en.size > 50, `only ${en.size} English strings`);
  for (const [k, v] of en) assert.ok(typeof v === 'string' && v.trim(), `${k} must be a non-empty string`);
});

for (const lang of LANGS.filter((l) => l !== 'en')) {
  test(`i18n: ${lang} has every English string, with the same placeholders and tags`, () => {
    const tr = catalog(lang);
    assert.ok(tr.size, `no ${lang} translation`);
    const enBases = new Set([...en.keys()].map(base));
    const trBases = new Set([...tr.keys()].map(base));
    for (const k of enBases) assert.ok(trBases.has(k), `${lang}: missing ${k}`);
    for (const [k, v] of tr) {
      assert.ok(enBases.has(base(k)), `${lang}: ${k} is not an English key`);
      assert.ok(typeof v === 'string' && v.trim(), `${lang}: ${k} must be a non-empty string`);
      // Every placeholder must exist in English (in any plural form of the key).
      const enVars = new Set([...en].filter(([ek]) => base(ek) === base(k)).flatMap(([, ev]) => [...vars(ev)]));
      for (const name of vars(v)) assert.ok(enVars.has(name), `${lang}: ${k} uses {${name}}, unknown in English`);
      const enForm = en.get(k) ?? en.get(`${base(k)}_other`) ?? en.get(base(k));
      // Plural forms may drop {count} ("one file"), but other placeholders must be kept.
      for (const name of vars(enForm)) if (name !== 'count') assert.ok(vars(v).has(name), `${lang}: ${k} lost {${name}}`);
      assert.equal(tags(v), tags(enForm), `${lang}: ${k} has different <tags> than English`);
    }
  });
}

test('i18n: every key used in the code exists in English', () => {
  const files = readdirSync(WEB_SRC, { recursive: true, encoding: 'utf8' })// i18n/index.js only has examples in its comment.
    .filter((f) => /\.jsx?$/.test(f) && !f.includes('locales') && !/i18n[\\/]index\.js$/.test(f));
  const used = new Set();
  for (const f of files) {
    const src = readFileSync(path.join(WEB_SRC, f), 'utf8');
    for (const m of src.matchAll(/\b(?:t|rich)\(\s*'([a-zA-Z][\w-]*(?:\.[\w-]+)+)'/g)) used.add(m[1]);
    // Module-level tables keep keys in properties named …Key: { value: 'flat', labelKey: 'settings.output.flat' }.
    for (const m of src.matchAll(/\b\w*Key\s*:\s*'([a-zA-Z][\w-]*(?:\.[\w-]+)+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 20, `only ${used.size} keys found in the code`);
  for (const key of used) assert.ok(en.has(key) || en.has(`${key}_other`), `t('${key}') has no English string`);
});

// ------------------------------------------------------------------ help

const enHelp = readJson(path.join(WEB_SRC, 'help/help.json')).topics;
const links = (line) => [...line.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map((m) => m[1]);
const kind = (line) => (line.startsWith('### ') ? 'h' : /^- /.test(line) ? '-' : /^\d+\. /.test(line) ? '1' : 'p');

for (const lang of LANGS.filter((l) => l !== 'en')) {
  test(`help: help.${lang}.json has every topic, with the same blocks, links and related topics`, () => {
    const file = path.join(WEB_SRC, `help/help.${lang}.json`);
    assert.ok(existsSync(file), `missing help/help.${lang}.json`);
    const topics = readJson(file).topics;
    for (const id of Object.keys(enHelp)) assert.ok(topics[id], `${lang}: missing topic ${id}`);
    for (const [id, t] of Object.entries(topics)) {
      const e = enHelp[id];
      assert.ok(e, `${lang}: ${id} is not an English topic`);
      assert.ok(t.title?.trim(), `${lang}/${id}: missing title`);
      assert.deepEqual(t.see ?? [], e.see ?? [], `${lang}/${id}: related topics differ from English`);
      assert.deepEqual(t.body.map(kind), e.body.map(kind), `${lang}/${id}: paragraphs, bullets and headings differ from English`);
      // Per block, in any order (a translation may reorder a sentence).
      assert.deepEqual(t.body.map((l) => links(l).sort()), e.body.map((l) => links(l).sort()), `${lang}/${id}: links differ from English`);
      for (const line of t.body) {
        assert.equal((line.match(/\*\*/g) ?? []).length % 2, 0, `${lang}/${id}: unbalanced ** in “${line}”`);
        assert.equal((line.match(/`/g) ?? []).length % 2, 0, `${lang}/${id}: unbalanced \` in “${line}”`);
      }
    }
  });
}
