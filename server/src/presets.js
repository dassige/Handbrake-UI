import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest, notFound, conflict } from './errors.js';
import { FALLBACK_CAPABILITIES, TEMPLATE, TEMPLATE_VERSION } from './presetDefaults.js';

const QUALITY_TYPES = { 0: 'target size', 1: 'avg bitrate', 2: 'constant quality' };

/** Flattens a HandBrake preset export (folders may nest) into plain presets. */
export function extractPresets(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.PresetList)) {
    throw badRequest('Not a HandBrake preset file: "PresetList" is missing');
  }
  const out = [];
  const walk = (list, category) => {
    for (const p of list) {
      if (!p || typeof p !== 'object') continue;
      if (p.Folder) walk(p.ChildrenArray ?? [], p.PresetName ?? category);
      else if (p.PresetName) out.push({ preset: p, category });
    }
  };
  walk(data.PresetList, null);
  if (!out.length) throw badRequest('The file contains no presets');
  return out;
}

export function summarize(p) {
  const audio = (p.AudioList ?? []).map((a) =>
    [a.AudioEncoder, a.AudioMixdown, a.AudioBitrate ? `${a.AudioBitrate}k` : null].filter(Boolean).join(' '),
  );
  let quality;
  if (p.VideoQualityType === 2) quality = `RF ${p.VideoQualitySlider}`;
  else if (p.VideoQualityType === 1) quality = `${p.VideoAvgBitrate} kbps`;
  else quality = QUALITY_TYPES[p.VideoQualityType] ?? null;
  return {
    format: p.FileFormat ?? 'av_mkv',
    videoEncoder: p.VideoEncoder,
    videoPreset: p.VideoPreset,
    quality,
    qualityType: QUALITY_TYPES[p.VideoQualityType] ?? null,
    multiPass: !!p.VideoMultiPass,
    maxSize: p.PictureWidth && p.PictureHeight ? `${p.PictureWidth}×${p.PictureHeight}` : null,
    framerate: p.VideoFramerate === 'auto' || !p.VideoFramerate
      ? 'same as source'
      : `${p.VideoFramerate} ${p.VideoFramerateMode === 'cfr' ? 'CFR' : p.VideoFramerateMode === 'pfr' ? 'peak' : 'VFR'}`,
    audio,
    audioTracks: p.AudioTrackSelectionBehavior,
    subtitles: p.SubtitleTrackSelectionBehavior,
  };
}

function rowToPreset(row, defaultId) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    fileName: row.file_name,
    summary: JSON.parse(row.summary),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
    isDefault: row.id === defaultId,
  };
}

const VERSION_KEYS = ['VersionMajor', 'VersionMinor', 'VersionMicro'];
const pickVersion = (data) => Object.fromEntries(VERSION_KEYS.filter((k) => Number.isInteger(data?.[k])).map((k) => [k, data[k]]));
/** The format version sent with settings from the editor (an import without one would run every upgrade). */
const editorVersion = (v) => (Number.isInteger(v?.VersionMajor) ? pickVersion(v) : { ...TEMPLATE_VERSION });

/** Name, category and description as stored: trimmed, an empty category or description as null. */
export function cleanProperties({ name, category, description } = {}) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) throw badRequest('The preset needs a name');
  if (n.length > 120) throw badRequest('The preset name is too long (120 characters at most)');
  if (/[/\\]/.test(n)) throw badRequest('The preset name cannot contain / or \\');
  const c = typeof category === 'string' ? category.trim() : '';
  const d = typeof description === 'string' ? description.trim() : '';
  return { name: n, category: c || null, description: d || null };
}

/** The preset as a user (not built-in) preset with these properties, like HandBrake's "Save New Preset". */
export function asUserPreset(preset, { name, description }) {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) throw badRequest('The preset must be a JSON object');
  const { ChildrenArray, ...rest } = preset;
  return {
    ...rest,
    PresetName: name,
    PresetDescription: description ?? '',
    Type: 1,
    Default: false,
    Folder: false,
    FolderOpen: false,
    PresetDisabled: false,
    ChildrenArray: [],
  };
}

/**
 * Without HandBrakeCLI: the preset with every template setting it lacks and without keys the
 * template doesn't know, as HandBrake's own import does (but older formats are not upgraded).
 */
export function mergeWithTemplate(preset) {
  const out = {};
  for (const [k, v] of Object.entries(TEMPLATE)) out[k] = k in preset ? preset[k] : structuredClone(v);
  const track = TEMPLATE.AudioList[0];
  if (Array.isArray(out.AudioList)) out.AudioList = out.AudioList.map((a) => ({ ...track, ...a }));
  return out;
}

/** A preset from get() without its JSON. */
function withoutJson(p) {
  const { json, ...rest } = p;
  return rest;
}

export class Presets {
  constructor({ db, settings, handbrake, tmpDir }) {
    this.db = db;
    this.settings = settings;
    this.handbrake = handbrake;
    this.tmpDir = tmpDir;
  }

  list() {
    const defaultId = this.settings.get('defaultPresetId');
    return this.db
      .prepare('SELECT * FROM presets ORDER BY category IS NOT NULL, category, name')
      .all()
      .map((r) => rowToPreset(r, defaultId));
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM presets WHERE id = ?').get(id);
    if (!row) throw notFound(`Preset ${id} not found`);
    return { ...rowToPreset(row, this.settings.get('defaultPresetId')), json: row.json };
  }

  /** What the editor can offer: the installed HandBrakeCLI's encoders and lists, or a fallback. */
  async capabilities() {
    return (await this.handbrake.capabilities()) ?? FALLBACK_CAPABILITIES;
  }

  /** HandBrake's built-in presets, to start a new preset from; null without HandBrakeCLI. */
  builtins() {
    return this.handbrake.builtinPresets();
  }

  tmpFile(kind) {
    this.tmpSeq = (this.tmpSeq ?? 0) + 1;
    return path.join(this.tmpDir, `${kind}-${process.pid}-${Date.now()}-${this.tmpSeq}.json`);
  }

  /**
   * The preset as HandBrake itself loads it: older formats upgraded, every setting filled in,
   * unknown keys dropped. Uses HandBrakeCLI's preset export; without the CLI, the template.
   * Returns { preset, version }.
   */
  async normalize(preset, version = {}) {
    if (!(await this.handbrake.available())) return { preset: mergeWithTemplate(preset), version: { ...TEMPLATE_VERSION } };
    const importFile = this.tmpFile('normalize-in');
    const outFile = this.tmpFile('normalize-out');
    // A unique temporary name, so --preset can't pick a built-in preset with the same name.
    const tmpName = path.basename(importFile, '.json');
    await fs.mkdir(this.tmpDir, { recursive: true });
    await fs.writeFile(importFile, JSON.stringify({ PresetList: [{ ...preset, PresetName: tmpName }], ...version }));
    try {
      const data = await this.handbrake.exportPreset({ name: tmpName, importFile, outFile });
      return { preset: { ...data.PresetList[0], PresetName: preset.PresetName }, version: pickVersion(data) };
    } catch (err) {
      throw badRequest(`HandBrake could not read the preset: ${err.message}`);
    } finally {
      await fs.rm(importFile, { force: true });
      await fs.rm(outFile, { force: true });
    }
  }

  /** A HandBrake built-in preset, exported by HandBrakeCLI. */
  async exportBuiltin(name) {
    const list = await this.builtins();
    if (!list) throw conflict('HandBrakeCLI is not installed, so its built-in presets are not available');
    if (!list.some((p) => p.name === name)) throw notFound(`HandBrake has no built-in preset "${name}"`);
    const outFile = this.tmpFile('builtin');
    await fs.mkdir(this.tmpDir, { recursive: true });
    try {
      const data = await this.handbrake.exportPreset({ name, outFile });
      return { preset: data.PresetList[0], version: pickVersion(data) };
    } catch (err) {
      throw badRequest(`HandBrake could not export "${name}": ${err.message}`);
    } finally {
      await fs.rm(outFile, { force: true });
    }
  }

  /** A stored preset ready for the editor, in the installed HandBrake's format. */
  async editable(id) {
    const p = this.get(id);
    const data = JSON.parse(p.json);
    const { preset, version } = await this.normalize(data.PresetList[0], pickVersion(data));
    return { ...withoutJson(p), preset, version };
  }

  assertUnique(name, category, exceptId = null) {
    const other = this.db
      .prepare('SELECT id FROM presets WHERE name = ? AND category IS ? AND id IS NOT ?')
      .get(name, category, exceptId);
    if (other) throw conflict(`There is already a preset called "${name}"${category ? ` in ${category}` : ''}`);
  }

  /** Normalises, checks and serialises a preset for storage. */
  async prepare(preset, props, version) {
    const { preset: normal, version: v } = await this.normalize(asUserPreset(preset, props), version);
    const final = asUserPreset(normal, props);
    const json = JSON.stringify({ PresetList: [final], ...v }, null, 2);
    const problem = await this.validate(json);
    if (problem) throw badRequest(`HandBrake rejected preset "${props.name}": ${problem}`);
    return { json, summary: JSON.stringify(summarize(final)) };
  }

  /**
   * Adds a preset made here, like HandBrake's "Save New Preset". Its settings come from
   * body.preset (the editor), body.builtin (a HandBrake built-in preset) or body.fromId (a copy).
   */
  async create(body = {}) {
    const props = cleanProperties(body);
    this.assertUnique(props.name, props.category);
    let base;
    let version = {};
    if (body.builtin != null) ({ preset: base, version } = await this.exportBuiltin(String(body.builtin)));
    else if (body.fromId != null) {
      const data = JSON.parse(this.get(Number(body.fromId)).json);
      base = data.PresetList[0];
      version = pickVersion(data);
    } else {
      base = body.preset;
      version = editorVersion(body.version);
    }
    const { json, summary } = await this.prepare(base, props, version);
    this.assertUnique(props.name, props.category); // again: another save may have won meanwhile
    const r = this.db
      .prepare('INSERT INTO presets (name, category, description, file_name, json, summary, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)')
      .run(props.name, props.category, props.description, json, summary, Date.now());
    const id = Number(r.lastInsertRowid);
    if (this.settings.get('defaultPresetId') == null) this.settings.set('defaultPresetId', id);
    return { id, name: props.name };
  }

  /** Saves changes from the editor: the settings (body.preset) and/or name, category and description. */
  async update(id, body = {}) {
    const current = this.get(id);
    const data = JSON.parse(current.json);
    const props = cleanProperties({
      name: body.name ?? current.name,
      category: body.category !== undefined ? body.category : current.category,
      description: body.description !== undefined ? body.description : current.description,
    });
    this.assertUnique(props.name, props.category, id);
    // The editor works on a normalised copy (editable()), which comes back with its format version.
    const base = body.preset ?? data.PresetList[0];
    const { json, summary } = await this.prepare(base, props, body.preset ? editorVersion(body.version) : pickVersion(data));
    this.assertUnique(props.name, props.category, id);
    this.db
      .prepare('UPDATE presets SET name = ?, category = ?, description = ?, json = ?, summary = ?, updated_at = ? WHERE id = ?')
      .run(props.name, props.category, props.description, json, summary, Date.now(), id);
    return { id, name: props.name };
  }

  /** The preset to use when none is chosen explicitly. */
  resolve(id) {
    const wanted = id ?? this.settings.get('defaultPresetId');
    if (wanted != null) return this.get(wanted);
    const first = this.db.prepare('SELECT id FROM presets ORDER BY id LIMIT 1').get();
    if (!first) throw conflict('Make or import a preset first (Presets page)');
    return this.get(first.id);
  }

  /**
   * Imports an exported preset file. A preset with the same name and category
   * as an existing one replaces it (queued jobs keep their own snapshot).
   */
  async import(data, fileName) {
    const found = extractPresets(data);
    const version = {
      VersionMajor: data.VersionMajor,
      VersionMinor: data.VersionMinor,
      VersionMicro: data.VersionMicro,
    };
    const results = [];
    for (const { preset, category } of found) {
      const json = JSON.stringify({ PresetList: [{ ...preset, Default: false }], ...version }, null, 2);
      const problem = await this.validate(json);
      if (problem) throw badRequest(`HandBrake rejected preset "${preset.PresetName}": ${problem}`);

      const summary = JSON.stringify(summarize(preset));
      const existing = this.db
        .prepare('SELECT id FROM presets WHERE name = ? AND category IS ?')
        .get(preset.PresetName, category);
      if (existing) {
        this.db
          .prepare('UPDATE presets SET description = ?, file_name = ?, json = ?, summary = ?, created_at = ?, updated_at = NULL WHERE id = ?')
          .run(preset.PresetDescription ?? null, fileName ?? null, json, summary, Date.now(), existing.id);
        results.push({ id: existing.id, name: preset.PresetName, action: 'updated' });
      } else {
        const r = this.db
          .prepare('INSERT INTO presets (name, category, description, file_name, json, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(preset.PresetName, category, preset.PresetDescription ?? null, fileName ?? null, json, summary, Date.now());
        results.push({ id: Number(r.lastInsertRowid), name: preset.PresetName, action: 'added' });
      }
    }
    if (this.settings.get('defaultPresetId') == null && results.length) {
      this.settings.set('defaultPresetId', results[0].id);
    }
    return results;
  }

  async validate(json) {
    const file = this.tmpFile('validate');
    await fs.mkdir(this.tmpDir, { recursive: true });
    await fs.writeFile(file, json);
    try {
      return await this.handbrake.validatePresetFile(file);
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  setDefault(id) {
    this.get(id);
    this.settings.set('defaultPresetId', id);
  }

  delete(id) {
    this.get(id);
    this.db.prepare('DELETE FROM presets WHERE id = ?').run(id);
    if (this.settings.get('defaultPresetId') === id) {
      const first = this.db.prepare('SELECT id FROM presets ORDER BY id LIMIT 1').get();
      this.settings.set('defaultPresetId', first?.id ?? null);
    }
  }
}
