// Rename step types: labels, editable fields and defaults (mirrors server/src/rename/steps.js).
// Labels, help and option names are i18n keys (labelKey / helpKey), translated when rendering;
// summary() is only called while rendering, so it may use t().
import { t } from '../i18n/index.js';

const APPLY_TO = {
  k: 'applyTo',
  type: 'select',
  labelKey: 'rename.fields.applyTo',
  options: [
    { value: 'name', labelKey: 'rename.fields.applyToName' },
    { value: 'ext', labelKey: 'rename.fields.applyToExt' },
    { value: 'both', labelKey: 'rename.fields.applyToBoth' },
  ],
};
const REGEX = { k: 'regex', type: 'bool', labelKey: 'rename.fields.regex' };
const CASE_SENSITIVE = { k: 'caseSensitive', type: 'bool', labelKey: 'rename.fields.caseSensitive' };
const BACKWARDS = { k: 'backwards', type: 'bool', labelKey: 'rename.fields.backwards' };
const COUNT = { k: 'count', type: 'number', labelKey: 'rename.fields.count' };
const TEXT = { k: 'text', type: 'text', labelKey: 'rename.fields.text' };

// Template placeholders are syntax the server reads: they stay as they are in every language.
const TV_TOKENS = '{show} {season} {episode} {title} {year}';
const MOVIE_TOKENS = '{title} {year}';

export const STEP_DEFS = {
  smart: {
    labelKey: 'rename.steps.smart.label',
    helpKey: 'rename.steps.smart.help',
    defaults: {
      mode: 'auto', tvTemplate: '{show} S{season}e{episode}[ - {title}]', movieTemplate: '{title}[ ({year})]',
      titleCase: true, apostrophes: true, showYear: false, extraTags: [],
    },
    fields: [
      {
        k: 'mode',
        type: 'select',
        labelKey: 'rename.fields.type',
        options: [
          { value: 'auto', labelKey: 'rename.fields.typeAuto' },
          { value: 'tv', labelKey: 'rename.fields.typeTv' },
          { value: 'movie', labelKey: 'rename.fields.typeMovie' },
        ],
      },
      { k: 'tvTemplate', type: 'text', labelKey: 'rename.fields.tvTemplate', labelVars: { tokens: TV_TOKENS } },
      { k: 'movieTemplate', type: 'text', labelKey: 'rename.fields.movieTemplate', labelVars: { tokens: MOVIE_TOKENS } },
      { k: 'titleCase', type: 'bool', labelKey: 'rename.fields.titleCase' },
      { k: 'apostrophes', type: 'bool', labelKey: 'rename.fields.apostrophes' },
      { k: 'showYear', type: 'bool', labelKey: 'rename.fields.showYear' },
      { k: 'extraTags', type: 'list', labelKey: 'rename.fields.extraReleaseTags' },
    ],
    summary: (s) => {
      const mode = { auto: t('rename.steps.smart.modeAuto'), tv: t('rename.steps.smart.modeTv'), movie: t('rename.steps.smart.modeMovie') }[s.mode];
      return `${mode} · ${s.mode === 'movie' ? s.movieTemplate : s.mode === 'tv' ? s.tvTemplate : `${s.tvTemplate} | ${s.movieTemplate}`}`;
    },
  },
  cleanTags: {
    labelKey: 'rename.steps.cleanTags.label',
    helpKey: 'rename.steps.cleanTags.help',
    defaults: { extraTags: [] },
    fields: [{ k: 'extraTags', type: 'list', labelKey: 'rename.fields.extraTags' }],
    summary: (s) => (s.extraTags.length ? `+ ${s.extraTags.join(', ')}` : t('rename.steps.cleanTags.builtIn')),
  },
  replace: {
    labelKey: 'rename.steps.replace.label',
    defaults: { find: '', replaceWith: '', regex: false, caseSensitive: false, occurrence: 'all', applyTo: 'name' },
    fields: [
      { k: 'find', type: 'text', labelKey: 'rename.fields.find' },
      { k: 'replaceWith', type: 'text', labelKey: 'rename.fields.replaceWith' },
      REGEX,
      CASE_SENSITIVE,
      {
        k: 'occurrence',
        type: 'select',
        labelKey: 'rename.fields.occurrence',
        options: [
          { value: 'all', labelKey: 'rename.fields.occurrenceAll' },
          { value: 'first', labelKey: 'rename.fields.occurrenceFirst' },
          { value: 'last', labelKey: 'rename.fields.occurrenceLast' },
        ],
      },
      APPLY_TO,
    ],
    summary: (s) => {
      const occurrence = { first: t('rename.steps.replace.first'), last: t('rename.steps.replace.last') }[s.occurrence] ?? s.occurrence;
      return `${q(s.find)} → ${q(s.replaceWith)}${flags(s)}${s.occurrence !== 'all' ? ` · ${occurrence}` : ''}`;
    },
  },
  removePattern: {
    labelKey: 'rename.steps.removePattern.label',
    defaults: { pattern: '', regex: true, caseSensitive: false, applyTo: 'name' },
    fields: [{ k: 'pattern', type: 'text', labelKey: 'rename.fields.pattern' }, REGEX, CASE_SENSITIVE, APPLY_TO],
    summary: (s) => `${q(s.pattern)}${flags(s)}`,
  },
  removeAfter: {
    labelKey: 'rename.steps.removeAfter.label',
    defaults: { text: '', keepText: true },
    fields: [TEXT, { k: 'keepText', type: 'bool', labelKey: 'rename.fields.keepText' }],
    summary: (s) => t(s.keepText ? 'rename.steps.removeAfter.summary' : 'rename.steps.removeAfter.summaryInclusive', { text: q(s.text) }),
  },
  remove: {
    labelKey: 'rename.steps.remove.label',
    defaults: { start: 1, count: 1, backwards: false },
    fields: [{ k: 'start', type: 'number', labelKey: 'rename.fields.fromPosition' }, COUNT, BACKWARDS],
    summary: (s) => t(s.backwards ? 'rename.steps.remove.summaryFromEnd' : 'rename.steps.remove.summary', { count: s.count, start: s.start }),
  },
  add: {
    labelKey: 'rename.steps.add.label',
    defaults: { text: '', position: 0, backwards: false },
    fields: [TEXT, { k: 'position', type: 'number', labelKey: 'rename.fields.position' }, BACKWARDS],
    summary: (s) => t(s.backwards ? 'rename.steps.add.summaryFromEnd' : 'rename.steps.add.summary', { text: q(s.text), position: s.position }),
  },
  move: {
    labelKey: 'rename.steps.move.label',
    defaults: { from: 1, count: 1, to: 1, backwards: false },
    fields: [
      { k: 'from', type: 'number', labelKey: 'rename.fields.fromPosition' },
      COUNT,
      { k: 'to', type: 'number', labelKey: 'rename.fields.toPosition' },
      BACKWARDS,
    ],
    summary: (s) => t('rename.steps.move.summary', { count: s.count, from: s.from, to: s.to }),
  },
  trim: {
    labelKey: 'rename.steps.trim.label',
    defaults: { characters: ' .,_-' },
    fields: [{ k: 'characters', type: 'text', labelKey: 'rename.fields.characters' }],
    summary: (s) => q(s.characters),
  },
  case: {
    labelKey: 'rename.steps.case.label',
    defaults: { mode: 'title' },
    fields: [
      {
        k: 'mode',
        type: 'select',
        labelKey: 'rename.fields.case',
        options: [
          { value: 'title', labelKey: 'rename.fields.caseTitle' },
          { value: 'upper', labelKey: 'rename.fields.caseUpper' },
          { value: 'lower', labelKey: 'rename.fields.caseLower' },
          { value: 'sentence', labelKey: 'rename.fields.caseSentence' },
        ],
      },
    ],
    summary: (s) => ({
      title: t('rename.steps.case.title'),
      upper: t('rename.steps.case.upper'),
      lower: t('rename.steps.case.lower'),
      sentence: t('rename.steps.case.sentence'),
    })[s.mode] ?? s.mode,
  },
  apostrophes: {
    labelKey: 'rename.steps.apostrophes.label',
    helpKey: 'rename.steps.apostrophes.help',
    defaults: {},
    fields: [],
    summary: () => t('rename.steps.apostrophes.summary'),
  },
  collapseSpaces: {
    labelKey: 'rename.steps.collapseSpaces.label',
    defaults: {},
    fields: [],
    summary: () => t('rename.steps.collapseSpaces.summary'),
  },
};

function q(s) {
  return t('rename.quoted', { text: s ?? '' });
}

function flags(s) {
  const out = [];
  if (s.regex) out.push(t('rename.flags.regex'));
  if (s.caseSensitive) out.push('Aa');
  if (s.applyTo && s.applyTo !== 'name') out.push(s.applyTo === 'ext' ? t('rename.flags.ext') : t('rename.flags.nameExt'));
  return out.length ? ` · ${out.join(' · ')}` : '';
}

export function newStep(type) {
  return { type, active: true, description: '', ...structuredClone(STEP_DEFS[type].defaults) };
}
