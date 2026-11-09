// Checks the UI help content (web/src/help/help.json) against the code that uses it, so the JSON can be
// edited freely. Same rules as dgsoft-image-manager's help test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.resolve(import.meta.dirname, '../../web/src');
const { topics } = JSON.parse(readFileSync(path.join(WEB_SRC, 'help/help.json'), 'utf8'));

const sources = readdirSync(WEB_SRC, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.jsx'))
  .map((f) => readFileSync(path.join(WEB_SRC, f), 'utf8'));
const usedIds = new Set(sources.flatMap((s) => [...s.matchAll(/<Help id="([^"]+)"|\bhelp="([^"]+)"/g)].map((m) => m[1] ?? m[2])));
const links = (line) => [...line.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map((m) => m[1]);

test('help: every topic has a title and a body', () => {
  for (const [id, t] of Object.entries(topics)) {
    assert.ok(t.title?.trim(), `${id}: missing title`);
    assert.ok(Array.isArray(t.body) && t.body.length && t.body.every((l) => typeof l === 'string' && l.trim()), `${id}: body must be non-empty strings`);
  }
});

test('help: every help button in the UI has a topic', () => {
  assert.ok(usedIds.size > 20, `only ${usedIds.size} help buttons found`);
  for (const id of usedIds) assert.ok(topics[id], `<Help id="${id}"> has no topic in help.json`);
});

test('help: links and related topics exist', () => {
  for (const [id, t] of Object.entries(topics)) {
    for (const ref of t.see ?? []) assert.ok(topics[ref] && ref !== id, `${id}: "see" refers to unknown topic ${ref}`);
    for (const href of t.body.flatMap(links)) {
      if (href.startsWith('#')) assert.ok(topics[href.slice(1)], `${id}: link to unknown topic ${href}`);
      else assert.match(href, /^https:\/\//, `${id}: unexpected link ${href}`);
    }
  }
});

test('help: **bold** and `code` markers are balanced', () => {
  for (const [id, t] of Object.entries(topics)) {
    for (const line of t.body) {
      assert.equal((line.match(/\*\*/g) ?? []).length % 2, 0, `${id}: unbalanced ** in “${line}”`);
      assert.equal((line.match(/`/g) ?? []).length % 2, 0, `${id}: unbalanced \` in “${line}”`);
    }
  }
});

test('help: every topic can be reached', () => {
  const reachable = new Set(usedIds);
  for (const t of Object.values(topics)) {
    for (const ref of t.see ?? []) reachable.add(ref);
    for (const href of t.body.flatMap(links)) if (href.startsWith('#')) reachable.add(href.slice(1));
  }
  for (const id of Object.keys(topics)) assert.ok(reachable.has(id), `${id} is never shown`);
});
