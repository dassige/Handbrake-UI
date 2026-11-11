// The HandBrake preset keys, grouped like the desktop app's tabs, for the read-only preset view.
//
// Each field: { key, labelKey, options?: { value: name } or an hbOptions.js option table,
// format?: (value, preset) => string, show?: (preset) => boolean }; each section has a titleKey.
// Labels are translated when shown. Keys not listed here are shown under "Other settings",
// so nothing is hidden.

import { t } from '../i18n/index.js';
import {
  BURN_BEHAVIORS, CONTAINERS, CROP_MODES, FRAMERATE_MODES, MIXDOWNS, PAR, QUALITY_TYPES, TRACK_BEHAVIORS_SHORT, VIDEO_ENCODERS,
  COMB_DETECT, DEINTERLACE, DENOISE, PAD_MODES, SHARPEN, audioEncoderLabel, labelOf, muxer, parseRotate,
} from './hbOptions.js';

export { CONTAINERS, MIXDOWNS, VIDEO_ENCODERS };

const yes = (v) => t(v ? 'common.yes' : 'common.no');
const list = (v) => (Array.isArray(v) && v.length ? v.join(', ') : '—');
const px = (v) => (v ? `${v} px` : t('presets.view.source'));
const isMp4 = (p) => muxer(p.FileFormat) === 'mp4';
const OFF_DEFAULT = (v) => (v === 'off' || v === '' || v == null ? t('common.off') : v === 'none' ? t('common.none') : String(v));
const rotate = (v) => {
  const r = parseRotate(v);
  return [r.angle ? `${r.angle}°` : null, r.hflip ? t('presets.view.flipped') : null].filter(Boolean).join(', ') || t('common.none');
};

export const PRESET_SECTIONS = [
  {
    id: 'summary',
    titleKey: 'presets.tabs.summary',
    fields: [
      { key: 'FileFormat', labelKey: 'presets.view.field.container', options: CONTAINERS },
      { key: 'Optimize', labelKey: 'presets.view.field.optimize', format: yes, show: isMp4 },
      { key: 'Mp4iPodCompatible', labelKey: 'presets.view.field.ipod', format: yes, show: isMp4 },
      { key: 'AlignAVStart', labelKey: 'presets.view.field.alignAV', format: yes },
      { key: 'ChapterMarkers', labelKey: 'presets.view.field.chapterMarkers', format: yes },
      { key: 'MetadataPassthru', labelKey: 'presets.view.field.metadata', format: yes },
    ],
  },
  {
    id: 'dimensions',
    titleKey: 'presets.tabs.dimensions',
    fields: [
      { key: 'PictureWidth', labelKey: 'presets.view.field.maxWidth', format: px },
      { key: 'PictureHeight', labelKey: 'presets.view.field.maxHeight', format: px },
      { key: 'PictureUseMaximumSize', labelKey: 'presets.view.field.useMaxSize', format: yes },
      { key: 'PictureAllowUpscaling', labelKey: 'presets.view.field.upscaling', format: yes },
      { key: 'PictureKeepRatio', labelKey: 'presets.view.field.keepRatio', format: yes },
      { key: 'PicturePAR', labelKey: 'presets.view.field.anamorphic', options: PAR },
      { key: 'PictureCropMode', labelKey: 'presets.view.field.cropping', options: CROP_MODES },
      {
        key: 'PictureTopCrop', labelKey: 'presets.view.field.crop', show: (p) => p.PictureCropMode === 3,
        format: (_, p) => [p.PictureTopCrop, p.PictureBottomCrop, p.PictureLeftCrop, p.PictureRightCrop].join(' / '),
      },
      { key: 'PicturePadMode', labelKey: 'presets.view.field.borders', format: (v) => labelOf(PAD_MODES, v) ?? OFF_DEFAULT(v) },
      { key: 'PictureRotate', labelKey: 'presets.view.field.rotate', format: rotate },
    ],
  },
  {
    id: 'filters',
    titleKey: 'presets.tabs.filters',
    fields: [
      { key: 'PictureDetelecine', labelKey: 'presets.view.field.detelecine', format: OFF_DEFAULT },
      { key: 'PictureDeinterlaceFilter', labelKey: 'presets.view.field.deinterlace', options: DEINTERLACE },
      { key: 'PictureDeinterlacePreset', labelKey: 'presets.view.field.deinterlacePreset', show: (p) => p.PictureDeinterlaceFilter && p.PictureDeinterlaceFilter !== 'off' },
      { key: 'PictureCombDetectPreset', labelKey: 'presets.view.field.interlaceDetection', options: COMB_DETECT, show: (p) => p.PictureDeinterlaceFilter && p.PictureDeinterlaceFilter !== 'off' },
      { key: 'PictureDenoiseFilter', labelKey: 'presets.view.field.denoise', options: DENOISE },
      { key: 'PictureDenoisePreset', labelKey: 'presets.view.field.denoisePreset', show: (p) => p.PictureDenoiseFilter && p.PictureDenoiseFilter !== 'off' },
      { key: 'PictureDenoiseTune', labelKey: 'presets.view.field.denoiseTune', show: (p) => p.PictureDenoiseFilter && p.PictureDenoiseFilter !== 'off' },
      { key: 'PictureChromaSmoothPreset', labelKey: 'presets.view.field.chromaSmooth', format: OFF_DEFAULT },
      { key: 'PictureSharpenFilter', labelKey: 'presets.view.field.sharpen', options: SHARPEN },
      { key: 'PictureSharpenPreset', labelKey: 'presets.view.field.sharpenPreset', show: (p) => p.PictureSharpenFilter && p.PictureSharpenFilter !== 'off' },
      { key: 'PictureDeblockPreset', labelKey: 'presets.view.field.deblock', format: OFF_DEFAULT },
      { key: 'PictureColorspacePreset', labelKey: 'presets.view.field.colourspace', format: OFF_DEFAULT },
      { key: 'VideoGrayScale', labelKey: 'presets.view.field.greyscale', format: yes },
    ],
  },
  {
    id: 'video',
    titleKey: 'presets.tabs.video',
    fields: [
      { key: 'VideoEncoder', labelKey: 'presets.view.field.encoder', options: VIDEO_ENCODERS },
      { key: 'VideoFramerate', labelKey: 'presets.view.field.framerate', format: (v) => (!v || v === 'auto' ? t('presetOptions.sameAsSource') : `${v} fps`) },
      { key: 'VideoFramerateMode', labelKey: 'presets.view.field.framerateMode', options: FRAMERATE_MODES },
      { key: 'VideoQualityType', labelKey: 'presets.view.field.qualityBy', options: QUALITY_TYPES },
      { key: 'VideoQualitySlider', labelKey: 'presets.view.field.constantQuality', show: (p) => p.VideoQualityType === 2 },
      { key: 'VideoAvgBitrate', labelKey: 'presets.view.field.averageBitrate', format: (v) => `${v} kbps`, show: (p) => p.VideoQualityType === 1 },
      { key: 'VideoMultiPass', labelKey: 'presets.view.field.multiPass', format: yes, show: (p) => p.VideoQualityType !== 2 },
      { key: 'VideoTurboMultiPass', labelKey: 'presets.view.field.turbo', format: yes, show: (p) => p.VideoQualityType !== 2 && p.VideoMultiPass },
      { key: 'VideoPreset', labelKey: 'presets.view.field.encoderPreset' },
      { key: 'VideoTune', labelKey: 'presets.view.field.encoderTune', format: (v) => v || t('common.none') },
      { key: 'VideoProfile', labelKey: 'presets.view.field.profile' },
      { key: 'VideoLevel', labelKey: 'presets.view.field.level' },
      { key: 'VideoOptionExtra', labelKey: 'presets.view.field.advanced', format: (v) => v || '—' },
    ],
  },
  {
    id: 'audio',
    titleKey: 'presets.tabs.audio',
    fields: [
      { key: 'AudioTrackSelectionBehavior', labelKey: 'presets.view.field.tracks', options: TRACK_BEHAVIORS_SHORT },
      { key: 'AudioLanguageList', labelKey: 'presets.view.field.languages', format: list },
      { key: 'AudioSecondaryEncoderMode', labelKey: 'presets.view.field.secondary', format: yes },
      { key: 'AudioCopyMask', labelKey: 'presets.view.field.copyMask', format: (v) => (Array.isArray(v) ? v.map(audioEncoderLabel).join(', ') : '—') },
      { key: 'AudioEncoderFallback', labelKey: 'presets.view.field.fallback', format: (v) => (v ? audioEncoderLabel(v) : '—') },
    ],
    // AudioList is shown as a table of encoders.
    lists: ['AudioList'],
  },
  {
    id: 'subtitles',
    titleKey: 'presets.tabs.subtitles',
    fields: [
      { key: 'SubtitleTrackSelectionBehavior', labelKey: 'presets.view.field.tracks', options: TRACK_BEHAVIORS_SHORT },
      { key: 'SubtitleLanguageList', labelKey: 'presets.view.field.languages', format: list },
      { key: 'SubtitleAddForeignAudioSearch', labelKey: 'presets.view.field.foreignScan', format: yes },
      { key: 'SubtitleAddForeignAudioSubtitle', labelKey: 'presets.view.field.foreignSubtitle', format: yes },
      { key: 'SubtitleAddCC', labelKey: 'presets.view.field.closedCaptions', format: yes },
      { key: 'SubtitleBurnBehavior', labelKey: 'presets.view.field.burnIn', options: BURN_BEHAVIORS },
      { key: 'SubtitleBurnBDSub', labelKey: 'presets.view.field.burnBD', format: yes },
      { key: 'SubtitleBurnDVDSub', labelKey: 'presets.view.field.burnDVD', format: yes },
    ],
  },
];

// Keys that are described elsewhere or mean nothing to the user.
const HIDDEN = new Set([
  'PresetName', 'PresetDescription', 'Type', 'Default', 'Folder', 'FolderOpen', 'ChildrenArray', 'PresetDisabled',
  'PictureBottomCrop', 'PictureLeftCrop', 'PictureRightCrop', 'AudioList',
]);
const KNOWN = new Set(PRESET_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)));

/** Preset keys this file does not describe, for the "Other settings" list. */
export function otherKeys(preset) {
  return Object.keys(preset).filter((k) => !KNOWN.has(k) && !HIDDEN.has(k)).sort();
}

export function formatValue(field, preset) {
  const v = preset[field.key];
  if (field.format) return field.format(v, preset);
  if (field.options) {
    const label = Array.isArray(field.options) ? labelOf(field.options, v) : field.options[v];
    return label ?? (v === '' || v == null ? '—' : String(v));
  }
  if (v === '' || v == null) return '—';
  if (typeof v === 'boolean') return yes(v);
  if (Array.isArray(v)) return list(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function rawValue(v) {
  if (v === '' || v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
