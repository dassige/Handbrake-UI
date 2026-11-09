import { badRequest } from '../errors.js';
import {
  cutAtTags, fixApostrophes, parseName, renderTemplate, templateFields, titleCase, tokenize,
} from './parse.js';

export const DEFAULT_TV_TEMPLATE = '{show} S{season}e{episode}[ - {title}]';
export const DEFAULT_MOVIE_TEMPLATE = '{title}[ ({year})]';

/** Default options of each step type. */
export const STEP_DEFAULTS = {
  smart: {
    mode: 'auto', tvTemplate: DEFAULT_TV_TEMPLATE, movieTemplate: DEFAULT_MOVIE_TEMPLATE,
    titleCase: true, apostrophes: true, showYear: false, extraTags: [],
  },
  cleanTags: { extraTags: [] },
  replace: { find: '', replaceWith: '', regex: false, caseSensitive: false, occurrence: 'all', applyTo: 'name' },
  removePattern: { pattern: '', regex: true, caseSensitive: false, applyTo: 'name' },
  removeAfter: { text: '', keepText: true },
  remove: { start: 1, count: 1, backwards: false },
  add: { text: '', position: 0, backwards: false },
  move: { from: 1, count: 1, to: 1, backwards: false },
  trim: { characters: ' .,_-' },
  case: { mode: 'title' },
  apostrophes: {},
  collapseSpaces: {},
};

export const STEP_TYPES = Object.keys(STEP_DEFAULTS);

/** Validates and fills defaults for a list of steps coming from the UI. */
export function normalizeSteps(steps) {
  if (!Array.isArray(steps)) throw badRequest('steps must be a list');
  return steps.map((s, i) => {
    if (!s || !STEP_TYPES.includes(s.type)) throw badRequest(`Step ${i + 1}: unknown type "${s?.type}"`);
    const out = { type: s.type, active: s.active !== false, description: String(s.description ?? '') };
    for (const [k, def] of Object.entries(STEP_DEFAULTS[s.type])) {
      let v = s[k] ?? def;
      if (typeof def === 'boolean') v = Boolean(v);
      else if (typeof def === 'number') {
        v = Number(v);
        if (!Number.isFinite(v)) throw badRequest(`Step ${i + 1}: ${k} must be a number`);
      } else if (Array.isArray(def)) v = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
      else v = String(v);
      out[k] = v;
    }
    if (out.regex) {
      try {
        makeRegExp(out.find ?? out.pattern, out.caseSensitive, 'g');
      } catch (err) {
        throw badRequest(`Step ${i + 1}: invalid regular expression: ${err.message}`);
      }
    }
    return out;
  });
}

function makeRegExp(source, caseSensitive, flags = '') {
  return new RegExp(source, flags + (caseSensitive ? '' : 'i'));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceOccurrence(text, re, replacement, occurrence, literal) {
  const rep = literal ? () => replacement : replacement;
  if (occurrence === 'first') return text.replace(new RegExp(re.source, re.flags.replace('g', '')), rep);
  if (occurrence === 'last') {
    const matches = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
    const m = matches.at(-1);
    if (!m || m[0] === '' && matches.length > 1) return text;
    const single = new RegExp(re.source, re.flags.replace('g', ''));
    return text.slice(0, m.index) + m[0].replace(single, rep) + text.slice(m.index + m[0].length);
  }
  return text.replace(re, rep);
}

/** Applies fn to the name and/or extension, as chosen by the step. */
function onParts(state, applyTo, fn) {
  if (applyTo === 'name' || applyTo === 'both') state.name = fn(state.name);
  if (applyTo === 'ext' || applyTo === 'both') state.ext = fn(state.ext);
}

const STEP_FNS = {
  smart(state, step, ctx) {
    const p = parseName(state.name, {
      mode: step.mode, showOverride: ctx.showOverride, showOverrideAll: ctx.showOverrideAll, extraTags: step.extraTags,
    });
    const tidy = (s) => {
      let out = s ?? '';
      if (step.apostrophes) out = fixApostrophes(out);
      if (step.titleCase) out = titleCase(out);
      return out;
    };
    p.show = tidy(p.show);
    p.title = tidy(p.title);
    state.info = p;
    state.warnings.push(...p.warnings);
    const fields = templateFields(p, { showYear: step.showYear });
    const rendered = renderTemplate(p.type === 'tv' ? step.tvTemplate : step.movieTemplate, fields).trim();
    if (rendered) state.name = rendered;
  },
  cleanTags(state, step) {
    state.name = cutAtTags(tokenize(state.name), step.extraTags) || state.name;
  },
  replace(state, step) {
    if (!step.find) return;
    const re = step.regex
      ? makeRegExp(step.find, step.caseSensitive, 'g')
      : makeRegExp(escapeRegExp(step.find), step.caseSensitive, 'g');
    onParts(state, step.applyTo, (t) => replaceOccurrence(t, re, step.replaceWith, step.occurrence, !step.regex));
  },
  removePattern(state, step) {
    if (!step.pattern) return;
    const re = makeRegExp(step.regex ? step.pattern : escapeRegExp(step.pattern), step.caseSensitive, 'g');
    onParts(state, step.applyTo, (t) => t.replace(re, ''));
  },
  removeAfter(state, step) {
    if (!step.text) return;
    const i = state.name.indexOf(step.text);
    if (i >= 0) state.name = state.name.slice(0, step.keepText ? i + step.text.length : i);
  },
  remove(state, step) {
    const n = state.name;
    const start = Math.max(0, step.start - 1);
    state.name = step.backwards
      ? n.slice(0, Math.max(0, n.length - start - step.count)) + n.slice(n.length - start)
      : n.slice(0, start) + n.slice(start + step.count);
  },
  add(state, step) {
    const n = state.name;
    const pos = Math.min(n.length, Math.max(0, step.position));
    const at = step.backwards ? n.length - pos : pos;
    state.name = n.slice(0, at) + step.text + n.slice(at);
  },
  move(state, step) {
    const n = state.name;
    const from = Math.max(0, step.from - 1);
    const startAt = step.backwards ? Math.max(0, n.length - from - step.count) : from;
    const piece = n.slice(startAt, startAt + step.count);
    const rest = n.slice(0, startAt) + n.slice(startAt + step.count);
    const to = Math.min(rest.length, Math.max(0, step.to - 1));
    state.name = rest.slice(0, to) + piece + rest.slice(to);
  },
  trim(state, step) {
    const chars = escapeRegExp(step.characters || ' ');
    state.name = state.name.replace(new RegExp(`^[${chars}]+|[${chars}]+$`, 'g'), '');
  },
  case(state, step) {
    const n = state.name;
    if (step.mode === 'upper') state.name = n.toUpperCase();
    else if (step.mode === 'lower') state.name = n.toLowerCase();
    else if (step.mode === 'sentence') state.name = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
    else state.name = titleCase(n);
  },
  apostrophes(state) {
    state.name = fixApostrophes(state.name);
  },
  collapseSpaces(state) {
    state.name = state.name.replace(/\s+/g, ' ').trim();
  },
};

/**
 * Runs the steps over one file name.
 * Returns { name, ext, info (from the smart step), warnings }.
 */
export function runSteps(base, ext, steps, ctx = {}) {
  const state = { name: base, ext, info: null, warnings: [] };
  for (const step of steps) {
    if (!step.active) continue;
    try {
      STEP_FNS[step.type](state, step, ctx);
    } catch (err) {
      state.warnings.push(`step “${step.description || step.type}” failed: ${err.message}`);
    }
  }
  return state;
}

// ------------------------------------------------------------------ Advanced Renamer import

/** Decodes the text of an Advanced Renamer .aren preset into steps. */
export function importAren(text) {
  if (!/^\s*\[header\]/m.test(text) || !/\[methods\]/.test(text)) {
    throw badRequest('Not an Advanced Renamer preset (.aren)');
  }
  const steps = [];
  const skipped = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^method\d+=(.*)$/.exec(line.trim());
    if (!m) continue;
    const f = {};
    for (const [, k, v] of m[1].matchAll(/(\w+):"(.*?)";/g)) f[k] = v;
    const base = {
      active: f.active !== '0',
      description: f.methoddescription ?? '',
    };
    const regex = f.regularexpressions === '1';
    const caseSensitive = f.casesensitive === '1';
    const applyTo = f.applyto === 'extension' ? 'ext' : f.applyto === 'nameandextension' ? 'both' : 'name';
    switch (f.methodname) {
      case 'replace':
        steps.push({
          ...base, type: 'replace', find: f.replace ?? '', regex, caseSensitive, applyTo,
          // Advanced Renamer uses \1 for groups; JavaScript uses $1.
          replaceWith: regex ? (f.replacewith ?? '').replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1') : f.replacewith ?? '',
          occurrence: { 1: 'first', 2: 'last' }[f.occurrence] ?? 'all',
        });
        break;
      case 'removepattern':
        steps.push({ ...base, type: 'removePattern', pattern: f.pattern ?? '', regex, caseSensitive, applyTo });
        break;
      case 'remove':
        if (/^\d+$/.test(f.start ?? '')) {
          steps.push({ ...base, type: 'remove', start: Number(f.start), count: Number(f.count ?? 1), backwards: f.backwards === '1' });
        } else {
          steps.push({ ...base, type: 'removeAfter', text: f.start ?? '', keepText: true });
        }
        break;
      case 'add':
        steps.push({ ...base, type: 'add', text: f.add ?? '', position: Number(f.position ?? 0), backwards: f.backwards === '1' });
        break;
      case 'move':
        steps.push({
          ...base, type: 'move', from: Number(f.movefrom ?? 1), count: Number(f.movecount ?? 1),
          to: Number(f.moveto ?? 1), backwards: f.backwards === '1',
        });
        break;
      case 'trim':
        steps.push({ ...base, type: 'trim', characters: f.characters ?? ' ' });
        break;
      case 'newcase':
      case 'case':
        steps.push({ ...base, type: 'case', mode: 'title' });
        break;
      default:
        skipped.push(f.methodname ?? 'unknown');
    }
  }
  return { steps: normalizeSteps(steps), skipped };
}
