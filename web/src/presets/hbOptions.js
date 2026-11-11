// What HandBrake (1.11) offers for each preset setting, taken from libhb and the desktop app:
// labels, filter presets and tunes, which encoders fit which container, quality ranges.
// The encoders themselves, and their presets/tunes/profiles/levels, come from the server
// (GET /api/presets/options asks the installed HandBrakeCLI).

/** [value, label] pairs as <option>s. */
export const opts = (pairs) => pairs.map(([value, label]) => ({ value, label }));
const labels = (pairs) => Object.fromEntries(pairs);

// ------------------------------------------------------------------ containers
const CONTAINER_PAIRS = [['av_mp4', 'MP4'], ['av_mkv', 'MKV'], ['av_webm', 'WebM'], ['av_mov', 'MOV']];
export const CONTAINERS = {
  ...labels(CONTAINER_PAIRS),
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
  const q = (low, high, step, lowerIsBetter = true, label = 'RF') => ({ low, high, step, lowerIsBetter, label });
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
  if (enc === 'theora') return q(0, 63, 1, false, 'Quality');
  if (/^(vt_|mf_)/.test(enc)) return q(0, 100, 1, false, 'Quality');
  return q(1, 31, 1, true, 'QP'); // mpeg2, mpeg4
}

/** HandBrake desktop's x264/x265 tune extras, shown as checkboxes instead of in the tune list. */
export const TUNE_FLAGS = [['fastdecode', 'Fast decode'], ['zerolatency', 'Zero latency']];

/** Splits VideoTune ("film,fastdecode") into the main tune and the extra flags. */
export function splitTune(enc, value) {
  const parts = String(value ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'none');
  if (!isX26x(enc)) return { tune: parts.join(','), flags: [] };
  const flags = parts.filter((p) => TUNE_FLAGS.some(([f]) => f === p));
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

export const FRAMERATE_MODE = labels([['vfr', 'Variable'], ['cfr', 'Constant'], ['pfr', 'Peak']]);
export const QUALITY_TYPE = labels([[0, 'Target size'], [1, 'Average bitrate'], [2, 'Constant quality']]);
export const COLOR_RANGE = [['auto', 'Same as source'], ['limited', 'Limited'], ['full', 'Full']];
export const HDR_METADATA = [['all', 'All'], ['hdr10plus', 'HDR10+ only'], ['dolbyvision', 'Dolby Vision only'], ['off', 'Off']];

// ------------------------------------------------------------------ dimensions
export const CROP_MODES = [[0, 'Automatic'], [1, 'Conservative'], [2, 'None'], [3, 'Custom']];
export const CROP_MODE = labels(CROP_MODES);
export const RESOLUTION_LIMITS = [
  { id: '4320p', label: '4320p 8K Ultra HD', width: 7680, height: 4320 },
  { id: '2160p', label: '2160p 4K Ultra HD', width: 3840, height: 2160 },
  { id: '1440p', label: '1440p 2.5K Quad HD', width: 2560, height: 1440 },
  { id: '1080p', label: '1080p Full HD', width: 1920, height: 1080 },
  { id: '720p', label: '720p HD', width: 1280, height: 720 },
  { id: '576p', label: '576p PAL', width: 720, height: 576 },
  { id: '480p', label: '480p NTSC', width: 720, height: 480 },
  { id: 'none', label: 'None', width: 0, height: 0 },
];
/** The resolution-limit choice for a preset's PictureWidth/PictureHeight ('custom' when none matches). */
export function resolutionLimit(p) {
  const w = Number(p.PictureWidth) || 0;
  const h = Number(p.PictureHeight) || 0;
  return RESOLUTION_LIMITS.find((r) => r.width === w && r.height === h)?.id ?? 'custom';
}
export const PAR_MODES = [['auto', 'Automatic'], ['off', 'None'], ['custom', 'Custom'], ['loose', 'Loose (older presets)'], ['strict', 'Strict (older presets)']];
export const PAR = { ...labels(PAR_MODES), none: 'None' };
export const PAD_MODES = [['none', 'None'], ['letterbox', 'Height (letterbox)'], ['pillarbox', 'Width (pillarbox)'], ['fill', 'Width & height'], ['custom', 'Custom']];
export const PAD_COLORS = [['black', 'Black'], ['darkslategray', 'Dark grey'], ['slategray', 'Grey'], ['white', 'White']];
export const ROTATIONS = [[0, 'None'], [90, '90°'], [180, '180°'], [270, '270°']];

/** PictureRotate "angle=90:hflip=1" as { angle, hflip }. */
export function parseRotate(v) {
  const s = String(v ?? '');
  return { angle: Number(/angle=(\d+)/.exec(s)?.[1] ?? 0), hflip: /hflip=1/.test(s) };
}
export const formatRotate = ({ angle, hflip }) => `angle=${angle}:hflip=${hflip ? 1 : 0}`;

// ------------------------------------------------------------------ filters (libhb/param.c)
const STRENGTHS = [['ultralight', 'Ultralight'], ['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong'], ['stronger', 'Stronger'], ['verystrong', 'Very strong']];
export const DETELECINE = [['off', 'Off'], ['default', 'Default'], ['custom', 'Custom']];
export const COMB_DETECT = [['off', 'Off'], ['default', 'Default'], ['permissive', 'Less sensitive'], ['fast', 'Fast'], ['custom', 'Custom']];
export const DEINTERLACE = [['off', 'Off'], ['decomb', 'Decomb'], ['deinterlace', 'Yadif'], ['bwdif', 'Bwdif']];
export const DEINTERLACE_PRESETS = {
  decomb: [['default', 'Default'], ['bob', 'Bob'], ['eedi2', 'EEDI2'], ['eedi2bob', 'EEDI2 Bob'], ['custom', 'Custom']],
  deinterlace: [['default', 'Default'], ['skip-spatial', 'Skip spatial check'], ['bob', 'Bob'], ['custom', 'Custom']],
  bwdif: [['default', 'Default'], ['bob', 'Bob'], ['custom', 'Custom']],
};
export const DEBLOCK = [['off', 'Off'], ...STRENGTHS, ['custom', 'Custom']];
export const DEBLOCK_TUNES = [['small', 'Small (4×4)'], ['medium', 'Medium (8×8)'], ['large', 'Large (16×16)']];
export const DENOISE = [['off', 'Off'], ['nlmeans', 'NLMeans'], ['hqdn3d', 'HQDN3D']];
export const DENOISE_PRESETS = [['ultralight', 'Ultralight'], ['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong'], ['custom', 'Custom']];
export const NLMEANS_TUNES = [['none', 'None'], ['film', 'Film'], ['grain', 'Grain'], ['highmotion', 'High motion'], ['animation', 'Animation'], ['tape', 'Tape'], ['sprite', 'Sprite']];
export const CHROMA_SMOOTH = [['off', 'Off'], ...STRENGTHS, ['custom', 'Custom']];
export const CHROMA_SMOOTH_TUNES = [['none', 'None'], ['tiny', 'Tiny'], ['small', 'Small'], ['medium', 'Medium'], ['wide', 'Wide'], ['verywide', 'Very wide']];
export const SHARPEN = [['off', 'Off'], ['unsharp', 'Unsharp'], ['lapsharp', 'Lapsharp']];
export const SHARPEN_PRESETS = [...STRENGTHS, ['custom', 'Custom']];
export const SHARPEN_TUNES = {
  unsharp: [['none', 'None'], ['ultrafine', 'Ultrafine'], ['fine', 'Fine'], ['medium', 'Medium'], ['coarse', 'Coarse'], ['verycoarse', 'Very coarse']],
  lapsharp: [['none', 'None'], ['film', 'Film'], ['grain', 'Grain'], ['animation', 'Animation'], ['sprite', 'Sprite']],
};
export const COLORSPACE = [['off', 'Off'], ['bt2020', 'BT.2020'], ['bt709', 'BT.709'], ['bt601-6-525', 'BT.601 SMPTE-C'], ['bt601-6-625', 'BT.601 EBU'], ['custom', 'Custom']];

// ------------------------------------------------------------------ audio
export const AUDIO_ENCODERS = {
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
  'copy:aac': 'AAC passthru',
  'copy:ac3': 'AC3 passthru',
  'copy:eac3': 'E-AC3 passthru',
  'copy:truehd': 'TrueHD passthru',
  'copy:dts': 'DTS passthru',
  'copy:dtshd': 'DTS-HD passthru',
  'copy:mp2': 'MP2 passthru',
  'copy:mp3': 'MP3 passthru',
  'copy:opus': 'Opus passthru',
  'copy:vorbis': 'Vorbis passthru',
  'copy:flac': 'FLAC passthru',
  'copy:alac': 'ALAC passthru',
  'copy:pcm': 'PCM passthru',
  copy: 'Auto passthru',
  none: 'None',
};

export const isPassthru = (enc) => String(enc ?? '').startsWith('copy');

/** The containers an audio encoder can be written to. */
export function audioMuxers(enc = '') {
  if (enc === 'none') return ['mp4', 'mkv', 'webm', 'mov'];
  if (/opus|vorbis/.test(enc)) return enc.includes('vorbis') ? ['webm', 'mkv'] : ['mp4', 'webm', 'mkv'];
  if (enc === 'copy:mp2') return ['mkv'];
  if (/truehd|dts|flac/.test(enc)) return ['mp4', 'mkv'];
  return ['mp4', 'mov', 'mkv'];
}

export const MIXDOWNS = {
  none: 'None', mono: 'Mono', left_only: 'Mono (left only)', right_only: 'Mono (right only)', stereo: 'Stereo',
  dpl1: 'Dolby Surround', dpl2: 'Dolby Pro Logic II', '5point1': '5.1 channels', '6point1': '6.1 channels',
  '7point1': '7.1 channels', '5_2_lfe': '7.1 (5F/2R/LFE)',
};
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

export const TRACK_BEHAVIORS = [['none', 'None'], ['first', 'First matching selected language'], ['all', 'All matching selected languages']];
export const TRACK_BEHAVIOR = { ...labels(TRACK_BEHAVIORS), first: 'First matching language', all: 'All matching languages' };
export const BURN_BEHAVIORS = [['none', 'None'], ['foreign', 'Foreign audio subtitle track'], ['first', 'First selected track'], ['foreign_first', 'Foreign audio, then first selected track']];
export const BURN = labels(BURN_BEHAVIORS);
export const AUDIO_NAMING = [['none', 'None'], ['unnamed', 'Unnamed tracks only'], ['all', 'All tracks']];
