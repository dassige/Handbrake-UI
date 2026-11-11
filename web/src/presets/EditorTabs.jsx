// The preset editor's Summary, Dimensions, Filters and Video tabs, laid out like the
// HandBrake desktop app. Each tab gets the draft preset `p`, `set(key, value)` and
// `setMany(patch)`; the Video tab also gets `caps` (what the server's HandBrakeCLI offers).
import { useState } from 'react';
import { Card, Check } from '../settings/fields.jsx';
import { rich, t } from '../i18n/index.js';
import { Num, Radios, Sel, Text } from './editorFields.jsx';
import {
  CHROMA_SMOOTH, CHROMA_SMOOTH_TUNES, COLORSPACE, COLOR_RANGE, COMB_DETECT, CONTAINERS, CROP_MODES, DEBLOCK, DEBLOCK_TUNES,
  DEINTERLACE, DEINTERLACE_PRESETS, DENOISE, DENOISE_PRESETS, DETELECINE, FRAMERATES, HDR_METADATA, NLMEANS_TUNES,
  PAD_COLORS, PAD_MODES, PAR_MODES, RESOLUTION_LIMITS, ROTATIONS, SHARPEN, SHARPEN_PRESETS, SHARPEN_TUNES, TUNE_FLAGS,
  VIDEO_ENCODERS, defaultEncoderPreset, formatRotate, isH264, joinTune, muxer, optionLabel, opts, parseRotate, qualityLimits,
  resolutionLimit, splitTune, supportsTurbo, usesTuneFlags, videoMuxers,
} from './hbOptions.js';

const MUXER_NAME = { mp4: 'MP4', mkv: 'MKV', webm: 'WebM', mov: 'MOV' };

// ------------------------------------------------------------------ Summary
export function SummaryTab({ p, set, caps }) {
  const mux = muxer(p.FileFormat);
  const containers = (caps.containers?.length ? caps.containers : ['av_mp4', 'av_mkv', 'av_webm']).map((c) => ({
    value: c,
    label: CONTAINERS[c] ?? c,
    disabled: !videoMuxers(p.VideoEncoder).includes(muxer(c)),
  }));
  return (
    <>
      <Card title={t('presets.summary.format')}>
        <div className="pe-grid">
          <Sel label={t('presets.summary.container')} value={p.FileFormat} options={containers} onChange={(v) => set('FileFormat', v)} unknownLabel={(v) => CONTAINERS[v] ?? v} />
        </div>
        <Check checked={p.Optimize} disabled={mux !== 'mp4' && mux !== 'mov'} onChange={(v) => set('Optimize', v)} hint={t('presets.summary.webOptimisedHint')}>
          {t('presets.summary.webOptimised')}
        </Check>
        <Check checked={p.Mp4iPodCompatible} disabled={mux !== 'mp4' || !isH264(p.VideoEncoder)} onChange={(v) => set('Mp4iPodCompatible', v)} hint={t('presets.summary.ipodHint')}>
          {t('presets.summary.ipod')}
        </Check>
        <Check checked={p.AlignAVStart} onChange={(v) => set('AlignAVStart', v)} hint={t('presets.summary.alignAVHint')}>
          {t('presets.summary.alignAV')}
        </Check>
        <Check checked={p.MetadataPassthru} onChange={(v) => set('MetadataPassthru', v)} hint={t('presets.summary.metadataHint')}>
          {t('presets.summary.metadata')}
        </Check>
        <Check checked={p.InlineParameterSets} onChange={(v) => set('InlineParameterSets', v)} hint={t('presets.summary.inlineParamsHint')}>
          {t('presets.summary.inlineParams')}
        </Check>
      </Card>
      <Card title={t('presets.summary.chapters')}>
        <Check checked={p.ChapterMarkers} onChange={(v) => set('ChapterMarkers', v)} hint={t('presets.summary.chapterMarkersHint')}>
          {t('presets.summary.chapterMarkers')}
        </Check>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Dimensions
// side: the part of the preset key ("PictureTopCrop", "PicturePadTop").
const SIDES = [
  { side: 'Top', labelKey: 'presets.dimensions.top' },
  { side: 'Bottom', labelKey: 'presets.dimensions.bottom' },
  { side: 'Left', labelKey: 'presets.dimensions.left' },
  { side: 'Right', labelKey: 'presets.dimensions.right' },
];

function Sides({ prefix, p, set, disabled }) {
  return (
    <div className="pe-grid pe-grid-4">
      {SIDES.map(({ side, labelKey }) => (
        <Num key={side} label={t(labelKey)} value={p[`${prefix}${side}${prefix === 'Picture' ? 'Crop' : ''}`]} min={0} max={4096} disabled={disabled}
          onChange={(v) => set(`${prefix}${side}${prefix === 'Picture' ? 'Crop' : ''}`, v)} suffix="px" />
      ))}
    </div>
  );
}

export function DimensionsTab({ p, set, setMany }) {
  const rot = parseRotate(p.PictureRotate);
  // 'Custom' stays chosen while the typed size happens to match a standard limit.
  const [customLimit, setCustomLimit] = useState(false);
  const limit = customLimit ? 'custom' : resolutionLimit(p);
  const par = PAR_MODES.filter((o) => !['loose', 'strict'].includes(o.value) || o.value === p.PicturePAR);
  return (
    <>
      <Card title={t('presets.dimensions.orientation')}>
        <div className="pe-grid">
          <Sel label={t('presets.dimensions.rotation')} value={rot.angle} options={opts(ROTATIONS)} onChange={(angle) => set('PictureRotate', formatRotate({ ...rot, angle }))} />
          <Sel label={t('presets.dimensions.cropping')} value={p.PictureCropMode} options={opts(CROP_MODES)} onChange={(v) => set('PictureCropMode', v)}
            hint={p.PictureCropMode === 1 ? t('presets.dimensions.cropConservativeHint') : p.PictureCropMode === 0 ? t('presets.dimensions.cropAutomaticHint') : null} />
        </div>
        <Check checked={rot.hflip} onChange={(hflip) => set('PictureRotate', formatRotate({ ...rot, hflip }))}>{t('presets.dimensions.flip')}</Check>
        {p.PictureCropMode === 3 && <Sides prefix="Picture" p={p} set={set} />}
      </Card>

      <Card title={t('presets.dimensions.scaling')}>
        <div className="pe-grid">
          <Sel
            label={t('presets.dimensions.resolutionLimit')}
            value={limit}
            options={[
              ...RESOLUTION_LIMITS.map((r) => ({ value: r.value, label: r.width ? `${optionLabel(r)} (${r.width}×${r.height})` : optionLabel(r) })),
              { value: 'custom', label: t('presetOptions.custom') },
            ]}
            onChange={(id) => {
              const r = RESOLUTION_LIMITS.find((x) => x.value === id);
              setCustomLimit(!r);
              if (r) setMany({ PictureWidth: r.width, PictureHeight: r.height });
            }}
            hint={t('presets.dimensions.resolutionLimitHint')}
          />
          <Sel label={t('presets.dimensions.anamorphic')} value={p.PicturePAR} options={opts(par)} onChange={(v) => set('PicturePAR', v)}
            hint={p.PicturePAR === 'auto' ? t('presets.dimensions.anamorphicAutoHint') : p.PicturePAR === 'off' ? t('presets.dimensions.anamorphicOffHint') : null} />
        </div>
        {limit === 'custom' && (
          <div className="pe-grid">
            <Num label={t('presets.dimensions.maxWidth')} value={p.PictureWidth} min={0} max={8192} suffix="px" onChange={(v) => set('PictureWidth', v)} />
            <Num label={t('presets.dimensions.maxHeight')} value={p.PictureHeight} min={0} max={8192} suffix="px" onChange={(v) => set('PictureHeight', v)} />
          </div>
        )}
        {p.PicturePAR === 'custom' && (
          <div className="pe-grid">
            <Num label={t('presets.dimensions.parWidth')} value={p.PicturePARWidth} min={1} max={65535} onChange={(v) => set('PicturePARWidth', v)} />
            <Num label={t('presets.dimensions.parHeight')} value={p.PicturePARHeight} min={1} max={65535} onChange={(v) => set('PicturePARHeight', v)} />
          </div>
        )}
        <Check checked={p.PictureUseMaximumSize} onChange={(v) => set('PictureUseMaximumSize', v)} hint={t('presets.dimensions.optimalSizeHint')}>
          {t('presets.dimensions.optimalSize')}
        </Check>
        <Check checked={p.PictureAllowUpscaling} onChange={(v) => set('PictureAllowUpscaling', v)} hint={t('presets.dimensions.upscalingHint')}>
          {t('presets.dimensions.upscaling')}
        </Check>
        <Check checked={p.PictureKeepRatio} onChange={(v) => set('PictureKeepRatio', v)}>{t('presets.dimensions.keepRatio')}</Check>
      </Card>

      <Card title={t('presets.dimensions.borders')}>
        <div className="pe-grid">
          <Sel label={t('presets.dimensions.fill')} value={p.PicturePadMode} options={opts(PAD_MODES)} onChange={(v) => set('PicturePadMode', v)}
            hint={t('presets.dimensions.fillHint')} />
          <Sel label={t('presets.dimensions.colour')} value={p.PicturePadColor} options={opts(PAD_COLORS)} disabled={p.PicturePadMode === 'none'} onChange={(v) => set('PicturePadColor', v)} />
        </div>
        {p.PicturePadMode === 'custom' && <Sides prefix="PicturePad" p={p} set={set} />}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Filters
/** One filter line: the main choice, then preset/tune/custom settings when they apply. */
function FilterRow({ label, children, hint }) {
  return (
    <div className="pe-filter">
      <span className="pe-filter-label">{label}</span>
      <div className="pe-filter-fields">{children}</div>
      {hint && <span className="set-hint pe-filter-hint">{hint}</span>}
    </div>
  );
}

// The placeholder shows the syntax of HandBrake's custom filter settings: not translated.
const custom = (value, onChange) => (
  <Text className="grow" value={value} onChange={onChange} mono placeholder="key=value:key=value" />
);
/** Keeps a preset/tune valid when its filter changes. */
const keep = (value, list, fallback) => (list.some((o) => o.value === value) ? value : fallback);

export function FiltersTab({ p, set, setMany }) {
  const deintOn = p.PictureDeinterlaceFilter && p.PictureDeinterlaceFilter !== 'off';
  const deintPresets = DEINTERLACE_PRESETS[p.PictureDeinterlaceFilter] ?? [];
  const denoiseOn = p.PictureDenoiseFilter && p.PictureDenoiseFilter !== 'off';
  const sharpenOn = p.PictureSharpenFilter && p.PictureSharpenFilter !== 'off';
  const sharpenTunes = SHARPEN_TUNES[p.PictureSharpenFilter] ?? [];
  return (
    <Card title={t('presets.tabs.filters')} className="pe-filters">
      <FilterRow label={t('presets.filters.detelecine')} hint={t('presets.filters.detelecineHint')}>
        <Sel value={p.PictureDetelecine} options={opts(DETELECINE)} onChange={(v) => set('PictureDetelecine', v)} />
        {p.PictureDetelecine === 'custom' && custom(p.PictureDetelecineCustom, (v) => set('PictureDetelecineCustom', v))}
      </FilterRow>
      <FilterRow label={t('presets.filters.interlaceDetection')} hint={t('presets.filters.interlaceDetectionHint')}>
        <Sel value={p.PictureCombDetectPreset} options={opts(COMB_DETECT)} onChange={(v) => set('PictureCombDetectPreset', v)} />
        {p.PictureCombDetectPreset === 'custom' && custom(p.PictureCombDetectCustom, (v) => set('PictureCombDetectCustom', v))}
      </FilterRow>
      <FilterRow label={t('presets.filters.deinterlace')}>
        <Sel
          value={p.PictureDeinterlaceFilter}
          options={opts(DEINTERLACE)}
          onChange={(v) => setMany({ PictureDeinterlaceFilter: v, PictureDeinterlacePreset: keep(p.PictureDeinterlacePreset, DEINTERLACE_PRESETS[v] ?? [], 'default') })}
        />
        {deintOn && <Sel value={p.PictureDeinterlacePreset} options={opts(deintPresets)} onChange={(v) => set('PictureDeinterlacePreset', v)} />}
        {deintOn && p.PictureDeinterlacePreset === 'custom' && custom(p.PictureDeinterlaceCustom, (v) => set('PictureDeinterlaceCustom', v))}
      </FilterRow>
      <FilterRow label={t('presets.filters.deblock')} hint={t('presets.filters.deblockHint')}>
        <Sel value={p.PictureDeblockPreset} options={opts(DEBLOCK)} onChange={(v) => set('PictureDeblockPreset', v)} />
        {p.PictureDeblockPreset !== 'off' && p.PictureDeblockPreset !== 'custom' && (
          <Sel value={p.PictureDeblockTune} options={opts(DEBLOCK_TUNES)} onChange={(v) => set('PictureDeblockTune', v)} />
        )}
        {p.PictureDeblockPreset === 'custom' && custom(p.PictureDeblockCustom, (v) => set('PictureDeblockCustom', v))}
      </FilterRow>
      <FilterRow label={t('presets.filters.denoise')} hint={t('presets.filters.denoiseHint')}>
        <Sel value={p.PictureDenoiseFilter} options={opts(DENOISE)} onChange={(v) => set('PictureDenoiseFilter', v)} />
        {denoiseOn && <Sel value={p.PictureDenoisePreset} options={opts(DENOISE_PRESETS)} onChange={(v) => set('PictureDenoisePreset', v)} />}
        {denoiseOn && p.PictureDenoiseFilter === 'nlmeans' && p.PictureDenoisePreset !== 'custom' && (
          <Sel value={p.PictureDenoiseTune} options={opts(NLMEANS_TUNES)} onChange={(v) => set('PictureDenoiseTune', v)} />
        )}
        {denoiseOn && p.PictureDenoisePreset === 'custom' && custom(p.PictureDenoiseCustom, (v) => set('PictureDenoiseCustom', v))}
      </FilterRow>
      <FilterRow label={t('presets.filters.chromaSmooth')} hint={t('presets.filters.chromaSmoothHint')}>
        <Sel value={p.PictureChromaSmoothPreset} options={opts(CHROMA_SMOOTH)} onChange={(v) => set('PictureChromaSmoothPreset', v)} />
        {p.PictureChromaSmoothPreset !== 'off' && p.PictureChromaSmoothPreset !== 'custom' && (
          <Sel value={p.PictureChromaSmoothTune} options={opts(CHROMA_SMOOTH_TUNES)} onChange={(v) => set('PictureChromaSmoothTune', v)} />
        )}
        {p.PictureChromaSmoothPreset === 'custom' && custom(p.PictureChromaSmoothCustom, (v) => set('PictureChromaSmoothCustom', v))}
      </FilterRow>
      <FilterRow label={t('presets.filters.sharpen')}>
        <Sel
          value={p.PictureSharpenFilter}
          options={opts(SHARPEN)}
          onChange={(v) => setMany({ PictureSharpenFilter: v, PictureSharpenTune: keep(p.PictureSharpenTune, SHARPEN_TUNES[v] ?? [], 'none') })}
        />
        {sharpenOn && <Sel value={p.PictureSharpenPreset} options={opts(SHARPEN_PRESETS)} onChange={(v) => set('PictureSharpenPreset', v)} />}
        {sharpenOn && p.PictureSharpenPreset !== 'custom' && (
          <Sel value={p.PictureSharpenTune} options={opts(sharpenTunes)} onChange={(v) => set('PictureSharpenTune', v)} />
        )}
        {sharpenOn && p.PictureSharpenPreset === 'custom' && custom(p.PictureSharpenCustom, (v) => set('PictureSharpenCustom', v))}
      </FilterRow>
      <FilterRow label={t('presets.filters.colourspace')} hint={t('presets.filters.colourspaceHint')}>
        <Sel value={p.PictureColorspacePreset} options={opts(COLORSPACE)} onChange={(v) => set('PictureColorspacePreset', v)} />
        {p.PictureColorspacePreset === 'custom' && custom(p.PictureColorspaceCustom, (v) => set('PictureColorspaceCustom', v))}
      </FilterRow>
      <FilterRow label={t('presets.filters.greyscale')}>
        <Check checked={p.VideoGrayScale} onChange={(v) => set('VideoGrayScale', v)}>{t('presets.filters.blackAndWhite')}</Check>
      </FilterRow>
    </Card>
  );
}

// ------------------------------------------------------------------ Video
/** The server's lists for an encoder (empty lists when the server doesn't have it). */
export function encoderInfo(caps, name) {
  return caps.videoEncoders.find((e) => e.name === name) ?? { name, presets: [], tunes: [], profiles: [], levels: [], missing: true };
}

/** The settings to change with the encoder, so the preset stays valid (like the desktop app does). */
export function encoderChange(p, caps, enc) {
  const e = encoderInfo(caps, enc);
  const patch = { VideoEncoder: enc };
  if (e.presets.length && !e.presets.includes(p.VideoPreset)) patch.VideoPreset = defaultEncoderPreset(e.presets);
  const { tune, flags } = splitTune(p.VideoEncoder, p.VideoTune);
  const tuneOk = !tune || e.tunes.includes(tune);
  patch.VideoTune = joinTune(tuneOk ? tune : '', usesTuneFlags(enc) ? flags.filter((f) => e.tunes.includes(f)) : []);
  if (e.profiles.length && !e.profiles.includes(p.VideoProfile)) patch.VideoProfile = e.profiles.includes('auto') ? 'auto' : e.profiles[0];
  if (e.levels.length && !e.levels.includes(p.VideoLevel)) patch.VideoLevel = e.levels.includes('auto') ? 'auto' : e.levels[0];
  const q = qualityLimits(enc);
  if (!q) patch.VideoQualityType = 1;
  else patch.VideoQualitySlider = Math.min(q.high, Math.max(q.low, Number(p.VideoQualitySlider) || 0));
  if (!supportsTurbo(enc)) patch.VideoTurboMultiPass = false;
  return patch;
}

export function VideoTab({ p, set, setMany, caps }) {
  const mux = muxer(p.FileFormat);
  const e = encoderInfo(caps, p.VideoEncoder);
  const q = qualityLimits(p.VideoEncoder);
  const auto = !p.VideoFramerate || p.VideoFramerate === 'auto';
  const { tune, flags } = splitTune(p.VideoEncoder, p.VideoTune);
  const tuneFlags = usesTuneFlags(p.VideoEncoder) ? TUNE_FLAGS.filter((f) => e.tunes.includes(f.value)) : [];
  const tunes = e.tunes.filter((x) => x !== 'none' && !tuneFlags.some((f) => f.value === x));
  const presetIndex = Math.max(0, e.presets.indexOf(p.VideoPreset));
  const showPresets = e.presets.length > 1;
  const autoLabel = (x) => (x === 'auto' ? t('presetOptions.auto') : x);

  const encoders = caps.videoEncoders.map(({ name }) => {
    const fits = videoMuxers(name).includes(mux);
    const label = VIDEO_ENCODERS[name] ?? name;
    return { value: name, label: fits ? label : t('presets.editor.notInContainer', { name: label, container: MUXER_NAME[mux] }), disabled: !fits };
  });

  return (
    <>
      <Card title={t('presets.tabs.video')}>
        <div className="pe-grid">
          <Sel
            label={t('presets.video.encoder')}
            value={p.VideoEncoder}
            options={encoders}
            onChange={(v) => setMany(encoderChange(p, caps, v))}
            unknownLabel={(v) => t('presets.editor.notOnServer', { name: VIDEO_ENCODERS[v] ?? v })}
          />
          <Sel
            label={t('presets.video.framerate')}
            value={auto ? 'auto' : String(p.VideoFramerate)}
            options={[{ value: 'auto', label: t('presetOptions.sameAsSource') }, ...FRAMERATES.map((f) => ({ value: f, label: f }))]}
            onChange={(v) => {
              const mode = p.VideoFramerateMode;
              if (v === 'auto') setMany({ VideoFramerate: 'auto', VideoFramerateMode: mode === 'pfr' ? 'vfr' : mode });
              else setMany({ VideoFramerate: v, VideoFramerateMode: mode === 'vfr' ? 'pfr' : mode });
            }}
          />
        </div>
        <Radios
          value={p.VideoFramerateMode}
          onChange={(v) => set('VideoFramerateMode', v)}
          options={auto
            ? [{ value: 'vfr', label: t('presets.video.vfr') }, { value: 'cfr', label: t('presets.video.cfr') }]
            : [{ value: 'cfr', label: t('presets.video.cfr') }, { value: 'pfr', label: t('presets.video.pfr') }]}
        />
      </Card>

      <Card title={t('presets.video.quality')}>
        <Radios
          value={p.VideoQualityType}
          onChange={(v) => set('VideoQualityType', v)}
          options={[
            ...(q ? [{ value: 2, label: t('presets.video.constantQuality') }] : []),
            { value: 1, label: t('presets.video.averageBitrate') },
            ...(p.VideoQualityType === 0 ? [{ value: 0, label: t('presets.video.targetSize') }] : []),
          ]}
        />
        {p.VideoQualityType === 2 && q && (
          <div className="pe-quality">
            <input
              type="range"
              min={q.low}
              max={q.high}
              step={q.step < 0.5 ? 0.5 : q.step}
              value={Number(p.VideoQualitySlider) || 0}
              onChange={(ev) => set('VideoQualitySlider', Number(ev.target.value))}
              aria-label={t('presets.video.qualitySlider', { scale: q.label })}
            />
            <Num value={p.VideoQualitySlider} min={q.low} max={q.high} step={q.step} onChange={(v) => set('VideoQualitySlider', v)} suffix={q.label} />
            <span className="set-hint pe-quality-hint">
              {q.lowerIsBetter ? t('presets.video.lowerIsBetter') : t('presets.video.higherIsBetter')}
              {/^x26[45]/.test(p.VideoEncoder) ? ` ${t('presets.video.rfTip')}` : ''}
            </span>
          </div>
        )}
        {p.VideoQualityType !== 2 && (
          <>
            <div className="pe-grid">
              <Num label={t('presets.video.averageBitrate')} value={p.VideoAvgBitrate} min={1} max={500000} suffix="kbit/s" onChange={(v) => set('VideoAvgBitrate', v)} />
            </div>
            <Check checked={p.VideoMultiPass} onChange={(v) => set('VideoMultiPass', v)} hint={t('presets.video.multiPassHint')}>
              {t('presets.video.multiPass')}
            </Check>
            {supportsTurbo(p.VideoEncoder) && (
              <Check checked={p.VideoTurboMultiPass} disabled={!p.VideoMultiPass} onChange={(v) => set('VideoTurboMultiPass', v)} hint={t('presets.video.turboHint')}>
                {t('presets.video.turbo')}
              </Check>
            )}
          </>
        )}
      </Card>

      <Card title={t('presets.video.encoderOptions')}>
        {showPresets && (
          <div className="set-field">
            <span className="set-label">{rich('presets.video.encoderPresetValue', { preset: <strong className="pe-preset-name">{p.VideoPreset || '—'}</strong> })}</span>
            <input
              type="range"
              min={0}
              max={e.presets.length - 1}
              step={1}
              value={presetIndex}
              onChange={(ev) => set('VideoPreset', e.presets[Number(ev.target.value)])}
              aria-label={t('presets.video.encoderPreset')}
              aria-valuetext={p.VideoPreset}
            />
            <span className="pe-range-ends set-hint"><span>{t('presets.video.faster')}</span><span>{t('presets.video.slower')}</span></span>
          </div>
        )}
        <div className="pe-grid">
          {(tunes.length > 0 || tune) && (
            <Sel
              label={t('presets.video.tune')}
              value={tune}
              options={[{ value: '', label: t('common.none') }, ...tunes.map((x) => ({ value: x, label: x }))]}
              onChange={(v) => set('VideoTune', joinTune(v, flags))}
            />
          )}
          {(e.profiles.length > 1 || (p.VideoProfile && p.VideoProfile !== 'auto')) && (
            <Sel label={t('presets.video.profile')} value={p.VideoProfile} options={e.profiles.map((x) => ({ value: x, label: autoLabel(x) }))} onChange={(v) => set('VideoProfile', v)} />
          )}
          {(e.levels.length > 1 || (p.VideoLevel && p.VideoLevel !== 'auto')) && (
            <Sel label={t('presets.video.level')} value={p.VideoLevel} options={e.levels.map((x) => ({ value: x, label: autoLabel(x) }))} onChange={(v) => set('VideoLevel', v)} />
          )}
        </div>
        {tuneFlags.length > 0 && (
          <div className="pe-checks-row">
            {tuneFlags.map((f) => (
              <Check key={f.value} checked={flags.includes(f.value)} onChange={(on) => set('VideoTune', joinTune(tune, on ? [...flags, f.value] : flags.filter((x) => x !== f.value)))}>
                {optionLabel(f)}
              </Check>
            ))}
          </div>
        )}
        <Text
          label={t('presets.video.advanced')}
          value={p.VideoOptionExtra}
          onChange={(v) => set('VideoOptionExtra', v)}
          mono
          placeholder="option1=value1:option2=value2"
          hint={t('presets.video.advancedHint')}
        />
      </Card>

      <Card title={t('presets.video.colourHdr')}>
        <div className="pe-grid">
          <Sel label={t('presets.video.colourRange')} value={p.VideoColorRange} options={opts(COLOR_RANGE)} onChange={(v) => set('VideoColorRange', v)} />
          <Sel label={t('presets.video.hdrMetadata')} value={p.VideoPasshtruHDRDynamicMetadata} options={opts(HDR_METADATA)} onChange={(v) => set('VideoPasshtruHDRDynamicMetadata', v)}
            hint={t('presets.video.hdrMetadataHint')} />
        </div>
      </Card>
    </>
  );
}
