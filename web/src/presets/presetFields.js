// The HandBrake preset keys, grouped like the desktop app's tabs, for the read-only preset view.
//
// Each field: { key, label, options?: { value: label }, format?: (value, preset) => string,
// show?: (preset) => boolean }. The editor (PresetEditor.jsx) uses the same labels from hbOptions.js.
// Keys not listed here are shown under "Other settings", so nothing is hidden.

import {
  AUDIO_ENCODERS, BURN, CONTAINERS, CROP_MODE, FRAMERATE_MODE, MIXDOWNS, PAR, QUALITY_TYPE, TRACK_BEHAVIOR, VIDEO_ENCODERS,
  COMB_DETECT, DEINTERLACE, DENOISE, PAD_MODES, SHARPEN, muxer, parseRotate,
} from './hbOptions.js';

export { AUDIO_ENCODERS, CONTAINERS, MIXDOWNS, VIDEO_ENCODERS };

const yes = (v) => (v ? 'Yes' : 'No');
const list = (v) => (Array.isArray(v) && v.length ? v.join(', ') : '—');
const px = (v) => (v ? `${v} px` : 'source');
const named = (pairs) => Object.fromEntries(pairs);
const DEINTERLACE_LABEL = named(DEINTERLACE);
const COMB_LABEL = named(COMB_DETECT);
const PAD_LABEL = named(PAD_MODES);
const DENOISE_LABEL = named(DENOISE);
const SHARPEN_LABEL = named(SHARPEN);
const isMp4 = (p) => muxer(p.FileFormat) === 'mp4';
const OFF_DEFAULT = (v) => (v === 'off' || v === '' || v == null ? 'Off' : v === 'none' ? 'None' : String(v));
const rotate = (v) => {
  const r = parseRotate(v);
  return [r.angle ? `${r.angle}°` : null, r.hflip ? 'flipped' : null].filter(Boolean).join(', ') || 'None';
};

export const PRESET_SECTIONS = [
  {
    id: 'summary',
    title: 'Summary',
    fields: [
      { key: 'FileFormat', label: 'Container', options: CONTAINERS },
      { key: 'Optimize', label: 'Web optimised', format: yes, show: isMp4 },
      { key: 'Mp4iPodCompatible', label: 'iPod 5G support', format: yes, show: isMp4 },
      { key: 'AlignAVStart', label: 'Align A/V start', format: yes },
      { key: 'ChapterMarkers', label: 'Chapter markers', format: yes },
      { key: 'MetadataPassthru', label: 'Pass metadata through', format: yes },
    ],
  },
  {
    id: 'dimensions',
    title: 'Dimensions',
    fields: [
      { key: 'PictureWidth', label: 'Max width', format: px },
      { key: 'PictureHeight', label: 'Max height', format: px },
      { key: 'PictureUseMaximumSize', label: 'Use as maximum size', format: yes },
      { key: 'PictureAllowUpscaling', label: 'Allow upscaling', format: yes },
      { key: 'PictureKeepRatio', label: 'Keep aspect ratio', format: yes },
      { key: 'PicturePAR', label: 'Anamorphic', options: PAR },
      { key: 'PictureCropMode', label: 'Cropping', options: CROP_MODE },
      {
        key: 'PictureTopCrop', label: 'Crop (T/B/L/R)', show: (p) => p.PictureCropMode === 3,
        format: (_, p) => [p.PictureTopCrop, p.PictureBottomCrop, p.PictureLeftCrop, p.PictureRightCrop].join(' / '),
      },
      { key: 'PicturePadMode', label: 'Borders', format: (v) => PAD_LABEL[v] ?? OFF_DEFAULT(v) },
      { key: 'PictureRotate', label: 'Rotate / flip', format: rotate },
    ],
  },
  {
    id: 'filters',
    title: 'Filters',
    fields: [
      { key: 'PictureDetelecine', label: 'Detelecine', format: OFF_DEFAULT },
      { key: 'PictureDeinterlaceFilter', label: 'Deinterlace', options: DEINTERLACE_LABEL },
      { key: 'PictureDeinterlacePreset', label: 'Deinterlace preset', show: (p) => p.PictureDeinterlaceFilter && p.PictureDeinterlaceFilter !== 'off' },
      { key: 'PictureCombDetectPreset', label: 'Interlace detection', options: COMB_LABEL, show: (p) => p.PictureDeinterlaceFilter && p.PictureDeinterlaceFilter !== 'off' },
      { key: 'PictureDenoiseFilter', label: 'Denoise', options: DENOISE_LABEL },
      { key: 'PictureDenoisePreset', label: 'Denoise preset', show: (p) => p.PictureDenoiseFilter && p.PictureDenoiseFilter !== 'off' },
      { key: 'PictureDenoiseTune', label: 'Denoise tune', show: (p) => p.PictureDenoiseFilter && p.PictureDenoiseFilter !== 'off' },
      { key: 'PictureChromaSmoothPreset', label: 'Chroma smooth', format: OFF_DEFAULT },
      { key: 'PictureSharpenFilter', label: 'Sharpen', options: SHARPEN_LABEL },
      { key: 'PictureSharpenPreset', label: 'Sharpen preset', show: (p) => p.PictureSharpenFilter && p.PictureSharpenFilter !== 'off' },
      { key: 'PictureDeblockPreset', label: 'Deblock', format: OFF_DEFAULT },
      { key: 'PictureColorspacePreset', label: 'Colourspace', format: OFF_DEFAULT },
      { key: 'VideoGrayScale', label: 'Greyscale', format: yes },
    ],
  },
  {
    id: 'video',
    title: 'Video',
    fields: [
      { key: 'VideoEncoder', label: 'Encoder', options: VIDEO_ENCODERS },
      { key: 'VideoFramerate', label: 'Frame rate', format: (v) => (!v || v === 'auto' ? 'Same as source' : `${v} fps`) },
      { key: 'VideoFramerateMode', label: 'Frame rate mode', options: FRAMERATE_MODE },
      { key: 'VideoQualityType', label: 'Quality by', options: QUALITY_TYPE },
      { key: 'VideoQualitySlider', label: 'Constant quality (RF)', show: (p) => p.VideoQualityType === 2 },
      { key: 'VideoAvgBitrate', label: 'Average bitrate', format: (v) => `${v} kbps`, show: (p) => p.VideoQualityType === 1 },
      { key: 'VideoMultiPass', label: 'Multi-pass encoding', format: yes, show: (p) => p.VideoQualityType !== 2 },
      { key: 'VideoTurboMultiPass', label: 'Turbo first pass', format: yes, show: (p) => p.VideoQualityType !== 2 && p.VideoMultiPass },
      { key: 'VideoPreset', label: 'Encoder preset' },
      { key: 'VideoTune', label: 'Encoder tune', format: (v) => v || 'None' },
      { key: 'VideoProfile', label: 'Profile' },
      { key: 'VideoLevel', label: 'Level' },
      { key: 'VideoOptionExtra', label: 'Advanced options', format: (v) => v || '—' },
    ],
  },
  {
    id: 'audio',
    title: 'Audio',
    fields: [
      { key: 'AudioTrackSelectionBehavior', label: 'Tracks', options: TRACK_BEHAVIOR },
      { key: 'AudioLanguageList', label: 'Languages', format: list },
      { key: 'AudioSecondaryEncoderMode', label: 'Use only the first encoder for secondary tracks', format: yes },
      { key: 'AudioCopyMask', label: 'Allowed passthru', format: (v) => (Array.isArray(v) ? v.map((x) => AUDIO_ENCODERS[x] ?? x).join(', ') : '—') },
      { key: 'AudioEncoderFallback', label: 'Passthru fallback', options: AUDIO_ENCODERS },
    ],
    // AudioList is shown as a table of encoders.
    lists: ['AudioList'],
  },
  {
    id: 'subtitles',
    title: 'Subtitles',
    fields: [
      { key: 'SubtitleTrackSelectionBehavior', label: 'Tracks', options: TRACK_BEHAVIOR },
      { key: 'SubtitleLanguageList', label: 'Languages', format: list },
      { key: 'SubtitleAddForeignAudioSearch', label: 'Foreign audio scan', format: yes },
      { key: 'SubtitleAddForeignAudioSubtitle', label: 'Add foreign audio subtitle', format: yes },
      { key: 'SubtitleAddCC', label: 'Add closed captions', format: yes },
      { key: 'SubtitleBurnBehavior', label: 'Burn in', options: BURN },
      { key: 'SubtitleBurnBDSub', label: 'Burn Blu-ray subtitles', format: yes },
      { key: 'SubtitleBurnDVDSub', label: 'Burn DVD subtitles', format: yes },
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
  if (field.options) return field.options[v] ?? (v === '' || v == null ? '—' : String(v));
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
