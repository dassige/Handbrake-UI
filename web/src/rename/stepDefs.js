// Rename step types: labels, editable fields and defaults (mirrors server/src/rename/steps.js).

const APPLY_TO = ['applyTo', 'select', 'Apply to', [['name', 'Name'], ['ext', 'Extension'], ['both', 'Name and extension']]];

const f = (k, type, label, options) => ({ k, type, label, options });

export const STEP_DEFS = {
  smart: {
    label: 'Recognise episode / movie',
    help: 'Finds S01E02 or 1x02 (TV) or a year (movie), drops release tags and builds the name from a template. [ ] blocks vanish when a field inside is empty.',
    defaults: {
      mode: 'auto', tvTemplate: '{show} S{season}e{episode}[ - {title}]', movieTemplate: '{title}[ ({year})]',
      titleCase: true, apostrophes: true, showYear: false, extraTags: [],
    },
    fields: [
      f('mode', 'select', 'Type', [['auto', 'Auto (TV or movie)'], ['tv', 'TV series'], ['movie', 'Movie']]),
      f('tvTemplate', 'text', 'TV template — {show} {season} {episode} {title} {year}'),
      f('movieTemplate', 'text', 'Movie template — {title} {year}'),
      f('titleCase', 'bool', 'Title Case words'),
      f('apostrophes', 'bool', "Fix apostrophes (L Uomo → L'Uomo, Wouldn T → Wouldn't)"),
      f('showYear', 'bool', 'Keep the year in the show name (remakes)'),
      f('extraTags', 'list', 'Extra release tags to drop (comma separated)'),
    ],
    summary: (s) => `${{ auto: 'auto', tv: 'TV', movie: 'movie' }[s.mode]} · ${s.mode === 'movie' ? s.movieTemplate : s.mode === 'tv' ? s.tvTemplate : `${s.tvTemplate} | ${s.movieTemplate}`}`,
  },
  cleanTags: {
    label: 'Remove release tags',
    help: 'Cuts the name at the first release tag (1080p, WEB-DL, x265, ITA…).',
    defaults: { extraTags: [] },
    fields: [f('extraTags', 'list', 'Extra tags (comma separated)')],
    summary: (s) => (s.extraTags.length ? `+ ${s.extraTags.join(', ')}` : 'built-in tag list'),
  },
  replace: {
    label: 'Replace',
    defaults: { find: '', replaceWith: '', regex: false, caseSensitive: false, occurrence: 'all', applyTo: 'name' },
    fields: [
      f('find', 'text', 'Find'),
      f('replaceWith', 'text', 'Replace with (regex groups: $1, $2…)'),
      f('regex', 'bool', 'Regular expression'),
      f('caseSensitive', 'bool', 'Case sensitive'),
      f('occurrence', 'select', 'Occurrence', [['all', 'All'], ['first', 'First'], ['last', 'Last']]),
      f(...APPLY_TO),
    ],
    summary: (s) => `${q(s.find)} → ${q(s.replaceWith)}${flags(s)}${s.occurrence !== 'all' ? ` · ${s.occurrence}` : ''}`,
  },
  removePattern: {
    label: 'Remove pattern',
    defaults: { pattern: '', regex: true, caseSensitive: false, applyTo: 'name' },
    fields: [f('pattern', 'text', 'Pattern'), f('regex', 'bool', 'Regular expression'), f('caseSensitive', 'bool', 'Case sensitive'), f(...APPLY_TO)],
    summary: (s) => `${q(s.pattern)}${flags(s)}`,
  },
  removeAfter: {
    label: 'Remove everything after text',
    defaults: { text: '', keepText: true },
    fields: [f('text', 'text', 'Text'), f('keepText', 'bool', 'Keep the text itself')],
    summary: (s) => `after ${q(s.text)}${s.keepText ? '' : ' (inclusive)'}`,
  },
  remove: {
    label: 'Remove characters',
    defaults: { start: 1, count: 1, backwards: false },
    fields: [f('start', 'number', 'From position (1 = first)'), f('count', 'number', 'Count'), f('backwards', 'bool', 'Count from the end')],
    summary: (s) => `${s.count} from position ${s.start}${s.backwards ? ' (from end)' : ''}`,
  },
  add: {
    label: 'Add text',
    defaults: { text: '', position: 0, backwards: false },
    fields: [f('text', 'text', 'Text'), f('position', 'number', 'Position (0 = start)'), f('backwards', 'bool', 'Count from the end')],
    summary: (s) => `${q(s.text)} at ${s.position}${s.backwards ? ' from end' : ''}`,
  },
  move: {
    label: 'Move characters',
    defaults: { from: 1, count: 1, to: 1, backwards: false },
    fields: [f('from', 'number', 'From position (1 = first)'), f('count', 'number', 'Count'), f('to', 'number', 'To position'), f('backwards', 'bool', 'Count from the end')],
    summary: (s) => `${s.count} chars from ${s.from} to ${s.to}`,
  },
  trim: {
    label: 'Trim characters',
    defaults: { characters: ' .,_-' },
    fields: [f('characters', 'text', 'Characters to trim at both ends')],
    summary: (s) => q(s.characters),
  },
  case: {
    label: 'Change case',
    defaults: { mode: 'title' },
    fields: [f('mode', 'select', 'Case', [['title', 'Title Case'], ['upper', 'UPPER'], ['lower', 'lower'], ['sentence', 'Sentence case']])],
    summary: (s) => s.mode,
  },
  apostrophes: {
    label: 'Fix apostrophes',
    help: "L Uomo → L'Uomo, Dell Oca → Dell'Oca, Wouldn T → Wouldn't, Holston S → Holston's",
    defaults: {},
    fields: [],
    summary: () => "L Uomo → L'Uomo",
  },
  collapseSpaces: {
    label: 'Collapse spaces',
    defaults: {},
    fields: [],
    summary: () => 'multiple spaces → one',
  },
};

function q(s) {
  return `“${s ?? ''}”`;
}

function flags(s) {
  const out = [];
  if (s.regex) out.push('regex');
  if (s.caseSensitive) out.push('Aa');
  if (s.applyTo && s.applyTo !== 'name') out.push(s.applyTo === 'ext' ? 'ext' : 'name+ext');
  return out.length ? ` · ${out.join(' · ')}` : '';
}

export function newStep(type) {
  return { type, active: true, description: '', ...structuredClone(STEP_DEFS[type].defaults) };
}
