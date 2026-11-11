// The release script (scripts/release.cjs, run by `npm run release` and the VS Code
// "Release GITHUB" button). Requiring it never runs a release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);
const release = require(path.join(ROOT, 'scripts/release.cjs'));
const config = require(path.join(ROOT, 'scripts/release.config.cjs'));

test('release: `npm run release` runs the CommonJS script', () => {
  const file = pkg.scripts.release.replace(/^node\s+/, '');
  assert.equal(path.extname(file), '.cjs');
  assert.ok(existsSync(path.join(ROOT, file)));
});

test('release: the version comes from the root package.json', () => {
  assert.equal(release.readProjectVersion(), pkg.version);
});

test('release: the config points at this repo and only counts vX.Y.Z tags', () => {
  assert.equal(config.GITHUB_REPO, 'https://github.com/dassige/encforge');
  // The same pattern git describe --match uses: v1.3.1 yes, server-v2.0.0 / web-v2.0.0 no.
  const glob = new RegExp(`^${config.TAG_PATTERN.replace('*', '.*')}$`);
  assert.ok(glob.test('v2.0.0'));
  assert.ok(!glob.test('server-v2.0.0'));
  assert.ok(!glob.test('web-v2.0.0'));
});

test('release: conventional commits become grouped notes with a compare link', () => {
  const notes = release.buildMarkdownNotes(
    ['fix(queue): keep the order', 'feat: conversion window\n\nRuns at night.', 'feat!: drop Node 20', 'tidy up'],
    'v2.1.0',
    'v2.0.0',
  );
  assert.match(notes, /^## EncForge v2\.1\.0/);
  assert.ok(notes.indexOf('✨ Features') < notes.indexOf('🐛 Bug Fixes'));
  assert.match(notes, /- \*\*queue:\*\* Keep the order/);
  assert.match(notes, /⚠️ \*\*Breaking:\*\* Drop Node 20/);
  assert.match(notes, /Runs at night\./);
  assert.match(notes, /🔀 Other Changes[\s\S]*- Tidy up/);
  assert.match(notes, /compare\/v2\.0\.0\.\.\.v2\.1\.0/);
});
