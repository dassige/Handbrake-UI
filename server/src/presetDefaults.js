// Fallbacks for when HandBrakeCLI is not installed (development). With the CLI, presets are
// normalised by HandBrakeCLI itself and the options come from the installed build.
//
// TEMPLATE is HandBrake 1.11.2's preset/preset_template.json (preset format 72.0.0): every
// setting a preset has, with its default value.

export const TEMPLATE_VERSION = { VersionMajor: 72, VersionMinor: 0, VersionMicro: 0 };

export const TEMPLATE = {
  AlignAVStart: false,
  AudioAutomaticNamingBehavior: 'unnamed',
  AudioCopyMask: [
    'copy:aac',
    'copy:ac3',
    'copy:dts',
    'copy:dtshd',
    'copy:eac3',
    'copy:flac',
    'copy:mp3',
    'copy:truehd'
  ],
  AudioEncoderFallback: 'ac3',
  AudioLanguageList: [
    'any'
  ],
  AudioList: [
    {
      AudioBitrate: 192,
      AudioCompressionLevel: -1,
      AudioDitherMethod: 'auto',
      AudioEncoder: 'copy:ac3',
      AudioMixdown: 'dpl2',
      AudioNormalizeMixLevel: false,
      AudioSamplerate: 'auto',
      AudioTrackQualityEnable: false,
      AudioTrackQuality: -1,
      AudioTrackGainSlider: 0,
      AudioTrackDRCSlider: 0
    }
  ],
  AudioSecondaryEncoderMode: true,
  AudioTrackSelectionBehavior: 'first',
  AudioTrackNamePassthru: true,
  ChapterMarkers: true,
  ChildrenArray: [],
  Default: false,
  FileFormat: 'mp4',
  Folder: false,
  FolderOpen: false,
  InlineParameterSets: false,
  MetadataPassthru: true,
  Optimize: false,
  Mp4iPodCompatible: false,
  PictureAllowUpscaling: false,
  PictureUseMaximumSize: true,
  PictureAutoCrop: true,
  PictureCropMode: 0,
  PictureBottomCrop: 0,
  PictureLeftCrop: 0,
  PictureRightCrop: 0,
  PictureTopCrop: 0,
  PictureDARWidth: 0,
  PictureDeblockPreset: 'off',
  PictureDeblockTune: 'medium',
  PictureDeblockCustom: 'strength=strong:thresh=20:blocksize=8',
  PictureCombDetectCustom: '',
  PictureCombDetectPreset: 'off',
  PictureDeinterlaceCustom: '',
  PictureDeinterlaceFilter: 'off',
  PictureDeinterlacePreset: 'default',
  PictureDenoiseCustom: '',
  PictureDenoiseFilter: 'off',
  PictureDenoisePreset: 'medium',
  PictureDenoiseTune: 'none',
  PictureChromaSmoothCustom: '',
  PictureChromaSmoothPreset: 'off',
  PictureChromaSmoothTune: 'none',
  PictureColorspaceCustom: '',
  PictureColorspacePreset: 'off',
  PictureSharpenCustom: '',
  PictureSharpenFilter: 'off',
  PictureSharpenPreset: 'medium',
  PictureSharpenTune: 'none',
  PictureDetelecine: 'off',
  PictureDetelecineCustom: '',
  PictureItuPAR: false,
  PictureKeepRatio: true,
  PictureModulus: 2,
  PicturePadColor: 'black',
  PicturePadMode: 'none',
  PicturePadTop: 0,
  PicturePadBottom: 0,
  PicturePadLeft: 0,
  PicturePadRight: 0,
  PicturePAR: 'auto',
  PicturePARWidth: 853,
  PicturePARHeight: 720,
  PictureRotate: 'angle=0:hflip=0',
  PictureWidth: 0,
  PictureHeight: 0,
  PictureForceHeight: 0,
  PictureForceWidth: 0,
  PresetDescription: '',
  PresetDisabled: false,
  PresetName: 'Name Missing',
  Type: 1,
  UsesPictureFilters: true,
  SubtitleAddCC: false,
  SubtitleAddForeignAudioSearch: false,
  SubtitleAddForeignAudioSubtitle: false,
  SubtitleBurnBehavior: 'none',
  SubtitleBurnBDSub: false,
  SubtitleBurnDVDSub: false,
  SubtitleLanguageList: [],
  SubtitleTrackSelectionBehavior: 'none',
  SubtitleTrackNamePassthru: true,
  VideoAvgBitrate: 1800,
  VideoColorMatrixCodeOverride: 0,
  VideoColorRange: 'limited',
  VideoEncoder: 'x264',
  VideoFramerate: 'auto',
  VideoFramerateMode: 'vfr',
  VideoGrayScale: false,
  VideoScaler: 'swscale',
  VideoPreset: 'medium',
  VideoTune: '',
  VideoProfile: 'auto',
  VideoLevel: 'auto',
  VideoOptionExtra: '',
  VideoQualityType: 2,
  VideoQualitySlider: 20,
  VideoHWDecode: 0,
  VideoMultiPass: false,
  VideoTurboMultiPass: false,
  VideoPasshtruHDRDynamicMetadata: 'all',
  x264Option: '',
  x264UseAdvancedOptions: false
};

const X26X_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'];
const H264_LEVELS = ['auto', '1.0', '1b', '1.1', '1.2', '1.3', '2.0', '2.1', '2.2', '3.0', '3.1', '3.2', '4.0', '4.1', '4.2', '5.0', '5.1', '5.2', '6.0', '6.1', '6.2'];
const H265_LEVELS = ['auto', '1.0', '2.0', '2.1', '3.0', '3.1', '4.0', '4.1', '5.0', '5.1', '5.2', '6.0', '6.1', '6.2'];
const AV1_LEVELS = ['auto', '2.0', '2.1', '2.2', '2.3', '3.0', '3.1', '3.2', '3.3', '4.0', '4.1', '4.2', '4.3', '5.0', '5.1', '5.2', '5.3', '6.0', '6.1', '6.2', '6.3'];
const X264_TUNES = ['none', 'film', 'animation', 'grain', 'stillimage', 'psnr', 'ssim', 'fastdecode', 'zerolatency'];
const X265_TUNES = ['none', 'psnr', 'ssim', 'grain', 'zerolatency', 'fastdecode', 'animation'];
const SVT_AV1 = {
  presets: ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1', '0', '-1'],
  tunes: ['vq', 'psnr', 'ssim', 'iq', 'ms-ssim', 'fastdecode'],
  profiles: ['auto', 'main'],
  levels: AV1_LEVELS,
};
const VPX = { presets: ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'], profiles: ['auto'], levels: ['auto'] };
const PLAIN = { presets: ['auto'], tunes: ['none'], profiles: ['auto'], levels: ['auto'] };

/** The software encoders of a typical Linux build of HandBrakeCLI 1.11.2. */
export const FALLBACK_CAPABILITIES = {
  source: 'builtin',
  version: null,
  videoEncoders: [
    { name: 'svt_av1', ...SVT_AV1 },
    { name: 'svt_av1_10bit', ...SVT_AV1 },
    { name: 'ffv1', presets: ['default', 'preservation'], tunes: ['none'], profiles: ['auto'], levels: ['auto', '1', '3'] },
    { name: 'x264', presets: X26X_PRESETS, tunes: X264_TUNES, profiles: ['auto', 'baseline', 'main', 'high', 'high422', 'high444'], levels: H264_LEVELS },
    { name: 'x264_10bit', presets: X26X_PRESETS, tunes: X264_TUNES, profiles: ['auto', 'high10', 'high422', 'high444'], levels: H264_LEVELS },
    { name: 'x265', presets: X26X_PRESETS, tunes: X265_TUNES, profiles: ['auto', 'main', 'mainstillpicture', 'main444-8', 'main444-intra'], levels: H265_LEVELS },
    { name: 'x265_10bit', presets: X26X_PRESETS, tunes: X265_TUNES, profiles: ['auto', 'main10', 'main10-intra', 'main422-10', 'main422-10-intra', 'main444-10', 'main444-10-intra'], levels: H265_LEVELS },
    { name: 'x265_12bit', presets: X26X_PRESETS, tunes: X265_TUNES, profiles: ['auto', 'main12', 'main12-intra', 'main422-12', 'main422-12-intra', 'main444-12', 'main444-12-intra'], levels: H265_LEVELS },
    { name: 'mpeg4', ...PLAIN },
    { name: 'mpeg2', presets: ['auto'], tunes: ['none'], profiles: ['auto', 'simple', 'main', 'snr', 'ss', 'high', '422'], levels: ['auto', 'low', 'main', 'high', 'high1440'] },
    { name: 'VP8', ...VPX, tunes: ['none'] },
    { name: 'VP9', ...VPX, tunes: ['none', 'screen', 'film'] },
    { name: 'VP9_10bit', ...VPX, tunes: ['none', 'screen', 'film'] },
    { name: 'theora', ...PLAIN },
  ],
  audioEncoders: [
    'none', 'av_aac', 'copy:aac', 'ac3', 'copy:ac3', 'eac3', 'copy:eac3', 'truehd', 'copy:truehd', 'copy:dts', 'copy:dtshd',
    'copy:mp2', 'mp3', 'copy:mp3', 'opus', 'copy:opus', 'vorbis', 'copy:vorbis', 'flac16', 'flac24', 'copy:flac',
    'alac16', 'alac24', 'copy:alac', 'pcm16', 'pcm24', 'copy:pcm', 'copy',
  ],
  containers: ['av_mp4', 'av_mov', 'av_mkv', 'av_webm'],
  mixdowns: ['mono', 'left_only', 'right_only', 'stereo', 'dpl1', 'dpl2', '5point1', '6point1', '7point1', '5_2_lfe'],
};
