import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest, notFound, conflict } from './errors.js';

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
    isDefault: row.id === defaultId,
  };
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

  /** The preset to use when none is chosen explicitly. */
  resolve(id) {
    const wanted = id ?? this.settings.get('defaultPresetId');
    if (wanted != null) return this.get(wanted);
    const first = this.db.prepare('SELECT id FROM presets ORDER BY id LIMIT 1').get();
    if (!first) throw conflict('Upload a HandBrake preset first');
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
          .prepare('UPDATE presets SET description = ?, file_name = ?, json = ?, summary = ?, created_at = ? WHERE id = ?')
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
    const file = path.join(this.tmpDir, `validate-${process.pid}-${Date.now()}.json`);
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
