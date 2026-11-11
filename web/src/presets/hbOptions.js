// What HandBrake (1.11) offers for each preset setting, taken from libhb and the desktop app:
// labels, filter presets and tunes, which encoders fit which container, quality ranges.
// The encoders themselves, and their presets/tunes/profiles/levels, come from the server
// (GET /api/presets/options asks the installed HandBrakeCLI).
//
// Option tables are lists of { value, labelKey, vars? } (translated when shown) or
// { value, label } (a technical name that stays as it is, e.g. "NLMeans", "BT.709").
import { t } from '../i18n/index.js';

const OFF = { value: 'off', labelKey: 'common.off' };
const NONE = { value: 'none', labelKey: 'common.none' };
const DEFAULT = { value: 'default', labelKey: 'presetOptions.default' };
const CUSTOM = { value: 'custom', labelKey: 'presetOptions.custom' };

/** The label of an option-table entry, in the current language. */
export const optionLabel = (o) => (o.labelKey ? t(o.labelKey, o.vars) : o.label);
/** An option table as <option>s: [{ value, label }]. */
export const opts = (list) => list.map((o) => ({ value: o.value, label: optionLabel(o) }));
/** The label of a value in an option table (undefined when the table doesn't have it). */
export function labelOf(list, value) {
  const o = list.find((x) => x.value === value);
  return o ? optionLabel(o) : undefined;
}

// ------------------------------------------------------------------ containers
export const CONTAINERS = {
  av_mp4: 'MP4', av_mkv: 'MKV', av_webm: 'WebM', av_mov: 'MOV',
  mp4: 'MP4', m4v: 'M4V', mp4v2: 'MP4', mkv: 'MKV', libmkv: 'MKV', webm: 'WebM', mov: 'MOV',
};

/** The muxer family of a FileFormat value: mp4 | mkv | webm | mov. */
export function muxer(format) {
  if (/mkv/.test(format ?? '')) return 'mkv';
  if (/webm/.test(format ?? '')) return 'webm';
  if (/mov/.test(format ?? '')) return 'mov';
  if (/mp4|m4v/.test(format ?? '')) return 'mp4';
  return 'mkv';
}

// ------------------------------------------------------------------ video encoders
export const VIDEO_ENCODERS = {
  x264: 'H.264 (x264)',
  x264_10bit: 'H.264 10-bit (x264)',
  x265: 'H.265 (x265)',
  x265_10bit: 'H.265 10-bit (x265)',
  x265_12bit: 'H.265 12-bit (x265)',
  x265_16bit: 'H.265 16-bit (x265)',
  svt_av1: 'AV1 (SVT)',
  svt_av1_10bit: 'AV1 10-bit (SVT)',
  qsv_h264: 'H.264 (Intel QSV)',
  qsv_h265: 'H.265 (Intel QSV)',
  qsv_h265_10bit: 'H.265 10-bit (Intel QSV)',
  qsv_av1: 'AV1 (Intel QSV)',
  qsv_av1_10bit: 'AV1 10-bit (Intel QSV)',
  nvenc_h264: 'H.264 (NVEnc)',
  nvenc_h265: 'H.265 (NVEnc)',
  nvenc_h265_10bit: 'H.265 10-bit (NVEnc)',
  nvenc_av1: 'AV1 (NVEnc)',
  nvenc_av1_10bit: 'AV1 10-bit (NVEnc)',
  vce_h264: 'H.264 (AMD VCE)',
  vce_h265: 'H.265 (AMD VCE)',
  vce_h265_10bit: 'H.265 10-bit (AMD VCE)',
  vce_av1: 'AV1 (AMD VCE)',
  vce_av1_10bit: 'AV1 10-bit (AMD VCE)',
  mf_h264: 'H.264 (MediaFoundation)',
  mf_h265: 'H.265 (MediaFoundation)',
  mf_av1: 'AV1 (MediaFoundation)',
  vt_h264: 'H.264 (VideoToolbox)',
  vt_h265: 'H.265 (VideoToolbox)',
  vt_h265_10bit: 'H.265 10-bit (VideoToolbox)',
  vt_prores: 'ProRes (VideoToolbox)',
  ffv1: 'FFV1',
  mpeg4: 'MPEG-4',
  mpeg2: 'MPEG-2',
  VP8: 'VP8',
  VP9: 'VP9',
  VP9_10bit: 'VP9 10-bit',
  dnxhr: 'DNxHR',
  dnxhr_10bit: 'DNxHR 10-bit',
  ff_prores: 'ProRes',
  theora: 'Theora',
};

/** The containers a video encoder can be written to (libhb's muxer masks). */
export function videoMuxers(enc = '') {
  if (/av1/.test(enc)) return ['mp4', 'webm', 'mkv'];
  if (enc === 'VP8') return ['webm', 'mkv'];
  if (/^VP9/.test(enc)) return ['mp4', 'webm', 'mkv'];
  if (enc === 'ffv1') return ['mp4', 'mkv'];
  if (/dnxhr|prores/.test(enc)) return ['mov', 'mkv'];
  if (enc === 'theora') return ['mkv'];
  return ['mp4', 'mov', 'mkv'];
}

const isX264 = (enc) => /^x264/.test(enc ?? '');
const isX26x = (enc) => /^x26[45]/.test(enc ?? '');

/** Turbo first pass only exists for x264 and x265. */
export const supportsTurbo = isX26x;
/** iPod 5G atom: MP4 with H.264. */
export const isH264 = (enc) => /h264|x264/.test(enc ?? '');

/**
 * Constant-quality range of an encoder (hb_video_quality_get_limits): { low, high, step,
 * lowerIsBetter, label }, or null when the encoder has no quality mode (FFV1, DNxHR, ProRes).
 */
export function qualityLimits(enc = '') {
  const q = (low, high, step, lowerIsBetter = true, label = 'RF') => ({ low, high, step, lowerIsBetter, label: label ?? t('presetOptions.qualityScale') });
  if (/^qsv_/.test(enc)) return q(0, 51, 1, true, 'ICQ');
  if (/^(ffv1|dnxhr|ff_prores|vt_prores)/.test(enc)) return null;
  if (enc === 'x264_10bit' || enc === 'x265_10bit') return q(-12, 51, 0.1);
  if (enc === 'x265_12bit') return q(-24, 51, 0.1);
  if (enc === 'x265_16bit') return q(-48, 51, 0.1);
  if (/^(x264|x265|vce_h26)/.test(enc)) return q(0, 51, 0.1, true, /^vce/.test(enc) ? 'QP' : 'RF');
  if (/^nvenc_av1/.test(enc)) return q(1, 63, 0.1, true, 'CQ');
  if (/^nvenc_/.test(enc)) return q(1, 51, 0.1, true, 'CQ');
  if (/^vce_av1/.test(enc)) return q(0, 255, 1, true, 'QP');
  if (/^svt_av1/.test(enc)) return q(0, 70, 0.25);
  if (/^VP[89]/.test(enc)) return q(0, 63, 1, true, 'CQ');
  if (enc === 'theora') return q(0, 63, 1, false, null);
  if (/^(vt_|mf_)/.test(enc)) return q(0, 100, 1, false, null);
  return q(1, 31, 1, true, 'QP'); // mpeg2, mpeg4
}

/** HandBrake desktop's x264/x265 tune extras, shown as checkboxes instead of in the tune list. */
export const TUNE_FLAGS = [
  { value: 'fastdecode', labelKey: 'presetOptions.tuneFlag.fastDecode' },
  { value: 'zerolatency', labelKey: 'presetOptions.tuneFlag.zeroLatency' },
];

/** Splits VideoTune ("film,fastdecode") into the main tune and the extra flags. */
export function splitTune(enc, value) {
  const parts = String(value ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'none');
  if (!isX26x(enc)) return { tune: parts.join(','), flags: [] };
  const flags = parts.filter((p) => TUNE_FLAGS.some((f) => f.value === p));
  return { tune: parts.find((p) => !flags.includes(p)) ?? '', flags };
}

export function joinTune(tune, flags) {
  return [tune && tune !== 'none' ? tune : null, ...flags].filter(Boolean).join(',');
}

/** Whether the tune list should show the fast-decode / zero-latency extras as checkboxes. */
export const usesTuneFlags = isX26x;

/** The encoder preset to fall back on when switching encoders (desktop picks the encoder's default). */
export function defaultEncoderPreset(list) {
  if (!list?.length) return '';
  for (const pick of ['medium', 'balanced', 'default', '6']) if (list.includes(pick)) return pick;
  return list[Math.floor(list.length / 2)];
}

export const FRAMERATES = ['5', '10', '12', '15', '20', '23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60', '72', '75', '90', '100', '120'];

export const FRAMERATE_MODES = [
  { value: 'vfr', labelKey: 'presetOptions.framerateMode.variable' },
  { value: 'cfr', labelKey: 'presetOptions.framerateMode.constant' },
  { value: 'pfr', labelKey: 'presetOptions.framerateMode.peak' },
];
export const QUALITY_TYPES = [
  { value: 0, labelKey: 'presetOptions.qualityType.targetSize' },
  { value: 1, labelKey: 'presetOptions.qualityType.averageBitrate' },
  { value: 2, labelKey: 'presetOptions.qualityType.constantQuality' },
];
export const COLOR_RANGE = [
  { value: 'auto', labelKey: 'presetOptions.sameAsSource' },
  { value: 'limited', labelKey: 'presetOptions.colorRange.limited' },
  { value: 'full', labelKey: 'presetOptions.colorRange.full' },
];
export const HDR_METADATA = [
  { value: 'all', labelKey: 'presetOptions.hdrMetadata.all' },
  { value: 'hdr10plus', labelKey: 'presetOptions.hdrMetadata.hdr10plus' },
  { value: 'dolbyvision', labelKey: 'presetOptions.hdrMetadata.dolbyVision' },
  OFF,
];

// ------------------------------------------------------------------ dimensions
export const CROP_MODES = [
  { value: 0, labelKey: 'presetOptions.automatic' },
  { value: 1, labelKey: 'presetOptions.cropMode.conservative' },
  { value: 2, labelKey: 'common.none' },
  { value: 3, labelKey: 'presetOptions.custom' },
];
export const RESOLUTION_LIMITS = [
  { value: '4320p', label: '4320p 8K Ultra HD', width: 7680, height: 4320 },
  { value: '2160p', label: '2160p 4K Ultra HD', width: 3840, height: 2160 },
  { value: '1440p', label: '1440p 2.5K Quad HD', width: 2560, height: 1440 },
  { value: '1080p', label: '1080p Full HD', width: 1920, height: 1080 },
  { value: '720p', label: '720p HD', width: 1280, height: 720 },
  { value: '576p', label: '576p PAL', width: 720, height: 576 },
  { value: '480p', label: '480p NTSC', width: 720, height: 480 },
  { value: 'none', labelKey: 'common.none', width: 0, height: 0 },
];
/** The resolution-limit choice for a preset's PictureWidth/PictureHeight ('custom' when none matches). */
export function resolutionLimit(p) {
  const w = Number(p.PictureWidth) || 0;
  const h = Number(p.PictureHeight) || 0;
  return RESOLUTION_LIMITS.find((r) => r.width === w && r.height === h)?.value ?? 'custom';
}
export const PAR_MODES = [
  { value: 'auto', labelKey: 'presetOptions.automatic' },
  { value: 'off', labelKey: 'common.none' },
  CUSTOM,
  { value: 'loose', labelKey: 'presetOptions.par.loose' },
  { value: 'strict', labelKey: 'presetOptions.par.strict' },
];
/** PAR_MODES plus the old 'none' value, for showing a preset. */
export const PAR = [...PAR_MODES, NONE];
export const PAD_MODES = [
  NONE,
  { value: 'letterbox', labelKey: 'presetOptions.padMode.letterbox' },
  { value: 'pillarbox', labelKey: 'presetOptions.padMode.pillarbox' },
  { value: 'fill', labelKey: 'presetOptions.padMode.fill' },
  CUSTOM,
];
export const PAD_COLORS = [
  { value: 'black', labelKey: 'presetOptions.padColor.black' },
  { value: 'darkslategray', labelKey: 'presetOptions.padColor.darkGrey' },
  { value: 'slategray', labelKey: 'presetOptions.padColor.grey' },
  { value: 'white', labelKey: 'presetOptions.padColor.white' },
];
export const ROTATIONS = [{ value: 0, labelKey: 'common.none' }, { value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }];

/** PictureRotate "angle=90:hflip=1" as { angle, hflip }. */
export function parseRotate(v) {
  const s = String(v ?? '');
  return { angle: Number(/angle=(\d+)/.exec(s)?.[1] ?? 0), hflip: /hflip=1/.test(s) };
}
export const formatRotate = ({ angle, hflip }) => `angle=${angle}:hflip=${hflip ? 1 : 0}`;

// ------------------------------------------------------------------ filters (libhb/param.c)
const STRENGTHS = [
  { value: 'ultralight', labelKey: 'presetOptions.strength.ultralight' },
  { value: 'light', labelKey: 'presetOptions.strength.light' },
  { value: 'medium', labelKey: 'presetOptions.strength.medium' },
  { value: 'strong', labelKey: 'presetOptions.strength.strong' },
  { value: 'stronger', labelKey: 'presetOptions.strength.stronger' },
  { value: 'verystrong', labelKey: 'presetOptions.strength.veryStrong' },
];
export const DETELECINE = [OFF, DEFAULT, CUSTOM];
export const COMB_DETECT = [
  OFF,
  DEFAULT,
  { value: 'permissive', labelKey: 'presetOptions.combDetect.lessSensitive' },
  { value: 'fast', labelKey: 'presetOptions.combDetect.fast' },
  CUSTOM,
];
export const DEINTERLACE = [OFF, { value: 'decomb', label: 'Decomb' }, { value: 'deinterlace', label: 'Yadif' }, { value: 'bwdif', label: 'Bwdif' }];
const BOB = { value: 'bob', label: 'Bob' };
export const DEINTERLACE_PRESETS = {
  decomb: [DEFAULT, BOB, { value: 'eedi2', label: 'EEDI2' }, { value: 'eedi2bob', label: 'EEDI2 Bob' }, CUSTOM],
  deinterlace: [DEFAULT, { value: 'skip-spatial', labelKey: 'presetOptions.deinterlacePreset.skipSpatial' }, BOB, CUSTOM],
  bwdif: [DEFAULT, BOB, CUSTOM],
};
export const DEBLOCK = [OFF, ...STRENGTHS, CUSTOM];
export const DEBLOCK_TUNES = [
  { value: 'small', labelKey: 'presetOptions.deblockTune.small' },
  { value: 'medium', labelKey: 'presetOptions.deblockTune.medium' },
  { value: 'large', labelKey: 'presetOptions.deblockTune.large' },
];
export const DENOISE = [OFF, { value: 'nlmeans', label: 'NLMeans' }, { value: 'hqdn3d', label: 'HQDN3D' }];
export const DENOISE_PRESETS = [...STRENGTHS.slice(0, 4), CUSTOM];
const FILM = { value: 'film', labelKey: 'presetOptions.filterTune.film' };
const GRAIN = { value: 'grain', labelKey: 'presetOptions.filterTune.grain' };
const ANIMATION = { value: 'animation', labelKey: 'presetOptions.filterTune.animation' };
const SPRITE = { value: 'sprite', labelKey: 'presetOptions.filterTune.sprite' };
export const NLMEANS_TUNES = [
  NONE,
  FILM,
  GRAIN,
  { value: 'highmotion', labelKey: 'presetOptions.filterTune.highMotion' },
  ANIMATION,
  { value: 'tape', labelKey: 'presetOptions.filterTune.tape' },
  SPRITE,
];
export const CHROMA_SMOOTH = [OFF, ...STRENGTHS, CUSTOM];
export const CHROMA_SMOOTH_TUNES = [
  NONE,
  { value: 'tiny', labelKey: 'presetOptions.chromaSmoothTune.tiny' },
  { value: 'small', labelKey: 'presetOptions.chromaSmoothTune.small' },
  { value: 'medium', labelKey: 'presetOptions.chromaSmoothTune.medium' },
  { value: 'wide', labelKey: 'presetOptions.chromaSmoothTune.wide' },
  { value: 'verywide', labelKey: 'presetOptions.chromaSmoothTune.veryWide' },
];
export const SHARPEN = [OFF, { value: 'unsharp', label: 'Unsharp' }, { value: 'lapsharp', label: 'Lapsharp' }];
export const SHARPEN_PRESETS = [...STRENGTHS, CUSTOM];
export const SHARPEN_TUNES = {
  unsharp: [
    NONE,
    { value: 'ultrafine', labelKey: 'presetOptions.unsharpTune.ultrafine' },
    { value: 'fine', labelKey: 'presetOptions.unsharpTune.fine' },
    { value: 'medium', labelKey: 'presetOptions.unsharpTune.medium' },
    { value: 'coarse', labelKey: 'presetOptions.unsharpTune.coarse' },
    { value: 'verycoarse', labelKey: 'presetOptions.unsharpTune.veryCoarse' },
  ],
  lapsharp: [NONE, FILM, GRAIN, ANIMATION, SPRITE],
};
export const COLORSPACE = [
  OFF,
  { value: 'bt2020', label: 'BT.2020' },
  { value: 'bt709', label: 'BT.709' },
  { value: 'bt601-6-525', label: 'BT.601 SMPTE-C' },
  { value: 'bt601-6-625', label: 'BT.601 EBU' },
  CUSTOM,
];

// ------------------------------------------------------------------ audio
// Encoder names stay as they are; passthru names are built from the format ("AC3 passthru").
const AUDIO_ENCODER_NAMES = {
  av_aac: 'AAC (avcodec)',
  ca_aac: 'AAC (CoreAudio)',
  ca_haac: 'HE-AAC (CoreAudio)',
  fdk_aac: 'AAC (FDK)',
  fdk_haac: 'HE-AAC (FDK)',
  ac3: 'AC3',
  eac3: 'E-AC3',
  truehd: 'TrueHD',
  mp3: 'MP3',
  opus: 'Opus',
  vorbis: 'Vorbis',
  flac16: 'FLAC 16-bit',
  flac24: 'FLAC 24-bit',
  alac16: 'ALAC 16-bit',
  alac24: 'ALAC 24-bit',
  pcm16: 'PCM 16-bit',
  pcm24: 'PCM 24-bit',
};
const PASSTHRU_FORMATS = {
  'copy:aac': 'AAC',
  'copy:ac3': 'AC3',
  'copy:eac3': 'E-AC3',
  'copy:truehd': 'TrueHD',
  'copy:dts': 'DTS',
  'copy:dtshd': 'DTS-HD',
  'copy:mp2': 'MP2',
  'copy:mp3': 'MP3',
  'copy:opus': 'Opus',
  'copy:vorbis': 'Vorbis',
  'copy:flac': 'FLAC',
  'copy:alac': 'ALAC',
  'copy:pcm': 'PCM',
};
/** Every audio encoder HandBrake can have (used when the server's list is unknown). */
export const AUDIO_ENCODERS = [...Object.keys(AUDIO_ENCODER_NAMES), ...Object.keys(PASSTHRU_FORMATS), 'copy', 'none'];

export const isPassthru = (enc) => String(enc ?? '').startsWith('copy');

/** The format a passthru encoder copies: 'copy:ac3' → "AC3". */
export const passthruFormat = (enc) => PASSTHRU_FORMATS[enc] ?? enc;

/** An audio encoder as shown: "AAC (avcodec)", "AC3 passthru", "Auto passthru", "None". */
export function audioEncoderLabel(enc) {
  if (Object.hasOwn(PASSTHRU_FORMATS, enc)) return t('presetOptions.audioEncoder.passthru', { format: PASSTHRU_FORMATS[enc] });
  if (enc === 'copy') return t('presetOptions.audioEncoder.autoPassthru');
  if (enc === 'none') return t('common.none');
  return AUDIO_ENCODER_NAMES[enc] ?? enc;
}

/** The containers an audio encoder can be written to. */
export function audioMuxers(enc = '') {
  if (enc === 'none') return ['mp4', 'mkv', 'webm', 'mov'];
  if (/opus|vorbis/.test(enc)) return enc.includes('vorbis') ? ['webm', 'mkv'] : ['mp4', 'webm', 'mkv'];
  if (enc === 'copy:mp2') return ['mkv'];
  if (/truehd|dts|flac/.test(enc)) return ['mp4', 'mkv'];
  return ['mp4', 'mov', 'mkv'];
}

export const MIXDOWNS = [
  NONE,
  { value: 'mono', labelKey: 'presetOptions.mixdown.mono' },
  { value: 'left_only', labelKey: 'presetOptions.mixdown.leftOnly' },
  { value: 'right_only', labelKey: 'presetOptions.mixdown.rightOnly' },
  { value: 'stereo', labelKey: 'presetOptions.mixdown.stereo' },
  { value: 'dpl1', label: 'Dolby Surround' },
  { value: 'dpl2', label: 'Dolby Pro Logic II' },
  { value: '5point1', labelKey: 'presetOptions.mixdown.channels', vars: { layout: '5.1' } },
  { value: '6point1', labelKey: 'presetOptions.mixdown.channels', vars: { layout: '6.1' } },
  { value: '7point1', labelKey: 'presetOptions.mixdown.channels', vars: { layout: '7.1' } },
  { value: '5_2_lfe', label: '7.1 (5F/2R/LFE)' },
];
export const SAMPLERATES = ['8', '11.025', '12', '16', '22.05', '24', '32', '44.1', '48', '88.2', '96', '176.4', '192'];
export const AUDIO_BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640, 768, 960, 1152, 1344, 1536];
/** Encoders without a bitrate (lossless). */
export const isLossless = (enc) => /^(flac|alac|pcm|truehd)/.test(enc ?? '');

/** Audio quality (VBR) range: hb_audio_quality_get_limits. */
export function audioQualityLimits(enc) {
  switch (enc) {
    case 'av_aac':
    case 'fdk_aac':
    case 'fdk_haac':
      return { low: 1, high: 5, step: 1, def: 3 };
    case 'mp3':
      return { low: 0, high: 10, step: 0.5, def: 2, lowerIsBetter: true };
    case 'vorbis':
      return { low: -2, high: 10, step: 0.5, def: 5 };
    case 'ca_aac':
      return { low: 1, high: 127, step: 9, def: 91 };
    default:
      return null;
  }
}

/** A new audio encoder row, like the desktop app's "Add" in Audio Defaults. */
export const NEW_AUDIO_TRACK = {
  AudioBitrate: 160,
  AudioCompressionLevel: -1,
  AudioDitherMethod: 'auto',
  AudioEncoder: 'av_aac',
  AudioMixdown: 'stereo',
  AudioNormalizeMixLevel: false,
  AudioSamplerate: 'auto',
  AudioTrackQualityEnable: false,
  AudioTrackQuality: -1,
  AudioTrackGainSlider: 0,
  AudioTrackDRCSlider: 0,
};

export const TRACK_BEHAVIORS = [
  NONE,
  { value: 'first', labelKey: 'presetOptions.trackBehavior.first' },
  { value: 'all', labelKey: 'presetOptions.trackBehavior.all' },
];
/** Shorter labels, for showing a preset. */
export const TRACK_BEHAVIORS_SHORT = [
  NONE,
  { value: 'first', labelKey: 'presetOptions.trackBehavior.firstShort' },
  { value: 'all', labelKey: 'presetOptions.trackBehavior.allShort' },
];
export const BURN_BEHAVIORS = [
  NONE,
  { value: 'foreign', labelKey: 'presetOptions.burnBehavior.foreign' },
  { value: 'first', labelKey: 'presetOptions.burnBehavior.first' },
  { value: 'foreign_first', labelKey: 'presetOptions.burnBehavior.foreignFirst' },
];
export const AUDIO_NAMING = [
  NONE,
  { value: 'unnamed', labelKey: 'presetOptions.audioNaming.unnamed' },
  { value: 'all', labelKey: 'presetOptions.audioNaming.all' },
];
