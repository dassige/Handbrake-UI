// The HandBrake preset keys, grouped like the desktop app's tabs.
//
// Each field: { key, label, options?: { value: label }, format?: (value, preset) => string,
// show?: (preset) => boolean }. Today they drive the read-only preset view; `options`
// lists the valid choices so the same table can drive an editor later.
// Keys not listed here are shown under "Other settings", so nothing is hidden.

const yes = (v) => (v ? 'Yes' : 'No');
const list = (v) => (Array.isArray(v) && v.length ? v.join(', ') : '—');
const px = (v) => (v ? `${v} px` : 'source');

export const CONTAINERS = { av_mkv: 'MKV', av_mp4: 'MP4', av_webm: 'WebM' };

export const VIDEO_ENCODERS = {
  x264: 'H.264 (x264)',
  x264_10bit: 'H.264 10-bit (x264)',
  x265: 'H.265 (x265)',
  x265_10bit: 'H.265 10-bit (x265)',
  x265_12bit: 'H.265 12-bit (x265)',
  qsv_h264: 'H.264 (Intel Quick Sync)',
  qsv_h265: 'H.265 (Intel Quick Sync)',
  qsv_h265_10bit: 'H.265 10-bit (Intel Quick Sync)',
  qsv_av1: 'AV1 (Intel Quick Sync)',
  qsv_av1_10bit: 'AV1 10-bit (Intel Quick Sync)',
  nvenc_h264: 'H.264 (NVIDIA NVENC)',
  nvenc_h265: 'H.265 (NVIDIA NVENC)',
  nvenc_av1: 'AV1 (NVIDIA NVENC)',
  vce_h264: 'H.264 (AMD VCE)',
  vce_h265: 'H.265 (AMD VCE)',
  svt_av1: 'AV1 (SVT-AV1)',
  svt_av1_10bit: 'AV1 10-bit (SVT-AV1)',
  mpeg4: 'MPEG-4 (FFmpeg)',
  mpeg2: 'MPEG-2 (FFmpeg)',
  VP8: 'VP8',
  VP9: 'VP9',
  theora: 'Theora',
};

export const AUDIO_ENCODERS = {
  av_aac: 'AAC (FFmpeg)',
  ca_aac: 'AAC (Core Audio)',
  ca_haac: 'HE-AAC (Core Audio)',
  fdk_aac: 'AAC (FDK)',
  fdk_haac: 'HE-AAC (FDK)',
  ac3: 'AC3',
  eac3: 'E-AC3',
  mp3: 'MP3',
  vorbis: 'Vorbis',
  opus: 'Opus',
  flac16: 'FLAC 16-bit',
  flac24: 'FLAC 24-bit',
  'copy:aac': 'AAC passthru',
  'copy:ac3': 'AC3 passthru',
  'copy:eac3': 'E-AC3 passthru',
  'copy:dts': 'DTS passthru',
  'copy:dtshd': 'DTS-HD passthru',
  'copy:truehd': 'TrueHD passthru',
  'copy:mp3': 'MP3 passthru',
  'copy:flac': 'FLAC passthru',
  'copy:opus': 'Opus passthru',
  copy: 'Auto passthru',
  none: 'None',
};

export const MIXDOWNS = {
  none: 'None', mono: 'Mono', left_only: 'Mono (left only)', right_only: 'Mono (right only)', stereo: 'Stereo',
  dpl1: 'Dolby Surround', dpl2: 'Dolby Pro Logic II', '5point1': '5.1 channels', '6point1': '6.1 channels',
  '7point1': '7.1 channels', '5_2_liss': '7.1 (5F/2R/LFE)',
};

const QUALITY_TYPE = { 0: 'Target size', 1: 'Average bitrate', 2: 'Constant quality' };
const FRAMERATE_MODE = { vfr: 'Variable', cfr: 'Constant', pfr: 'Peak' };
const CROP_MODE = { 0: 'Automatic', 1: 'Conservative', 2: 'None', 3: 'Custom' };
const PAR = { auto: 'Automatic', loose: 'Loose', none: 'None (square pixels)', custom: 'Custom' };
const TRACK_BEHAVIOR = { none: 'None', first: 'First matching language', all: 'All matching languages' };
const BURN = { none: 'None', foreign: 'Foreign audio track', first: 'First track', 'foreign_first': 'Foreign audio, then first track' };
const DEINTERLACE = { off: 'Off', yadif: 'Yadif', bwdif: 'Bwdif', decomb: 'Decomb' };
const DENOISE = { off: 'Off', nlmeans: 'NLMeans', hqdn3d: 'HQDN3D' };
const SHARPEN = { off: 'Off', unsharp: 'Unsharp', lapsharp: 'Lapsharp' };
const OFF_DEFAULT = (v) => (v === 'off' || v === '' || v == null ? 'Off' : v === 'none' ? 'None' : String(v));

export const PRESET_SECTIONS = [
  {
    id: 'summary',
    title: 'Summary',
    fields: [
      { key: 'FileFormat', label: 'Container', options: CONTAINERS },
      { key: 'Optimize', label: 'Web optimised', format: yes, show: (p) => p.FileFormat === 'av_mp4' },
      { key: 'Mp4iPodCompatible', label: 'iPod 5G support', format: yes, show: (p) => p.FileFormat === 'av_mp4' },
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
      { key: 'PicturePadMode', label: 'Borders', format: OFF_DEFAULT },
      { key: 'PictureRotate', label: 'Rotate / flip', format: (v) => v || 'None' },
    ],
  },
  {
    id: 'filters',
    title: 'Filters',
    fields: [
      { key: 'PictureDetelecine', label: 'Detelecine', format: OFF_DEFAULT },
      { key: 'PictureDeinterlaceFilter', label: 'Deinterlace', options: DEINTERLACE },
      { key: 'PictureDeinterlacePreset', label: 'Deinterlace preset', show: (p) => p.PictureDeinterlaceFilter && p.PictureDeinterlaceFilter !== 'off' },
      { key: 'PictureCombDetectPreset', label: 'Interlace detection', show: (p) => p.PictureDeinterlaceFilter && p.PictureDeinterlaceFilter !== 'off' },
      { key: 'PictureDenoiseFilter', label: 'Denoise', options: DENOISE },
      { key: 'PictureDenoisePreset', label: 'Denoise preset', show: (p) => p.PictureDenoiseFilter && p.PictureDenoiseFilter !== 'off' },
      { key: 'PictureDenoiseTune', label: 'Denoise tune', show: (p) => p.PictureDenoiseFilter && p.PictureDenoiseFilter !== 'off' },
      { key: 'PictureChromaSmoothPreset', label: 'Chroma smooth', format: OFF_DEFAULT },
      { key: 'PictureSharpenFilter', label: 'Sharpen', options: SHARPEN },
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
