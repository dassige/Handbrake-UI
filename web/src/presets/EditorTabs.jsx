// The preset editor's Summary, Dimensions, Filters and Video tabs, laid out like the
// HandBrake desktop app. Each tab gets the draft preset `p`, `set(key, value)` and
// `setMany(patch)`; the Video tab also gets `caps` (what the server's HandBrakeCLI offers).
import { useState } from 'react';
import { Card, Check } from '../settings/fields.jsx';
import { Num, Radios, Sel, Text } from './editorFields.jsx';
import {
  CHROMA_SMOOTH, CHROMA_SMOOTH_TUNES, COLORSPACE, COLOR_RANGE, COMB_DETECT, CONTAINERS, CROP_MODES, DEBLOCK, DEBLOCK_TUNES,
  DEINTERLACE, DEINTERLACE_PRESETS, DENOISE, DENOISE_PRESETS, DETELECINE, FRAMERATES, HDR_METADATA, NLMEANS_TUNES,
  PAD_COLORS, PAD_MODES, PAR_MODES, RESOLUTION_LIMITS, ROTATIONS, SHARPEN, SHARPEN_PRESETS, SHARPEN_TUNES, TUNE_FLAGS,
  VIDEO_ENCODERS, defaultEncoderPreset, formatRotate, isH264, joinTune, muxer, opts, parseRotate, qualityLimits,
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
      <Card title="Format">
        <div className="pe-grid">
          <Sel label="Container" value={p.FileFormat} options={containers} onChange={(v) => set('FileFormat', v)} unknownLabel={(v) => CONTAINERS[v] ?? v} />
        </div>
        <Check checked={p.Optimize} disabled={mux !== 'mp4' && mux !== 'mov'} onChange={(v) => set('Optimize', v)} hint="Puts the index at the start of the file, so playback can start while it downloads. MP4 and MOV only.">
          Web optimised
        </Check>
        <Check checked={p.Mp4iPodCompatible} disabled={mux !== 'mp4' || !isH264(p.VideoEncoder)} onChange={(v) => set('Mp4iPodCompatible', v)} hint="For 5th-generation iPods. MP4 with H.264 only.">
          iPod 5G support
        </Check>
        <Check checked={p.AlignAVStart} onChange={(v) => set('AlignAVStart', v)} hint="Adds silence or black frames at the start so that audio and video start at exactly the same time.">
          Align A/V start
        </Check>
        <Check checked={p.MetadataPassthru} onChange={(v) => set('MetadataPassthru', v)} hint="Copies the source's title, date, description and similar tags.">
          Pass through common metadata
        </Check>
        <Check checked={p.InlineParameterSets} onChange={(v) => set('InlineParameterSets', v)} hint="Repeats the stream headers before every key frame, for adaptive streaming.">
          Inline parameter sets
        </Check>
      </Card>
      <Card title="Chapters">
        <Check checked={p.ChapterMarkers} onChange={(v) => set('ChapterMarkers', v)} hint="Keeps the source's chapters, so players can jump between them.">
          Chapter markers
        </Check>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Dimensions
function Sides({ prefix, p, set, disabled }) {
  return (
    <div className="pe-grid pe-grid-4">
      {['Top', 'Bottom', 'Left', 'Right'].map((side) => (
        <Num key={side} label={side} value={p[`${prefix}${side}${prefix === 'Picture' ? 'Crop' : ''}`]} min={0} max={4096} disabled={disabled}
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
  const par = PAR_MODES.filter(([v]) => !['loose', 'strict'].includes(v) || v === p.PicturePAR);
  return (
    <>
      <Card title="Orientation and cropping">
        <div className="pe-grid">
          <Sel label="Rotation" value={rot.angle} options={opts(ROTATIONS)} onChange={(angle) => set('PictureRotate', formatRotate({ ...rot, angle }))} />
          <Sel label="Cropping" value={p.PictureCropMode} options={opts(CROP_MODES)} onChange={(v) => set('PictureCropMode', v)}
            hint={p.PictureCropMode === 1 ? 'Removes only the black bars HandBrake is sure about.' : p.PictureCropMode === 0 ? 'Removes the black bars HandBrake finds.' : null} />
        </div>
        <Check checked={rot.hflip} onChange={(hflip) => set('PictureRotate', formatRotate({ ...rot, hflip }))}>Flip horizontally</Check>
        {p.PictureCropMode === 3 && <Sides prefix="Picture" p={p} set={set} />}
      </Card>

      <Card title="Resolution and scaling">
        <div className="pe-grid">
          <Sel
            label="Resolution limit"
            value={limit}
            options={[...RESOLUTION_LIMITS.map((r) => ({ value: r.id, label: r.width ? `${r.label} (${r.width}×${r.height})` : r.label })), { value: 'custom', label: 'Custom' }]}
            onChange={(id) => {
              const r = RESOLUTION_LIMITS.find((x) => x.id === id);
              setCustomLimit(!r);
              if (r) setMany({ PictureWidth: r.width, PictureHeight: r.height });
            }}
            hint="The largest size of the output: bigger sources are scaled down."
          />
          <Sel label="Anamorphic" value={p.PicturePAR} options={opts(par)} onChange={(v) => set('PicturePAR', v)}
            hint={p.PicturePAR === 'auto' ? 'Keeps the most resolution and stores the shape as a pixel aspect ratio.' : p.PicturePAR === 'off' ? 'Square pixels: the picture is resized to its display shape.' : null} />
        </div>
        {limit === 'custom' && (
          <div className="pe-grid">
            <Num label="Max width" value={p.PictureWidth} min={0} max={8192} suffix="px" onChange={(v) => set('PictureWidth', v)} />
            <Num label="Max height" value={p.PictureHeight} min={0} max={8192} suffix="px" onChange={(v) => set('PictureHeight', v)} />
          </div>
        )}
        {p.PicturePAR === 'custom' && (
          <div className="pe-grid">
            <Num label="Pixel aspect width" value={p.PicturePARWidth} min={1} max={65535} onChange={(v) => set('PicturePARWidth', v)} />
            <Num label="Pixel aspect height" value={p.PicturePARHeight} min={1} max={65535} onChange={(v) => set('PicturePARHeight', v)} />
          </div>
        )}
        <Check checked={p.PictureUseMaximumSize} onChange={(v) => set('PictureUseMaximumSize', v)} hint="Scales to the biggest size that fits the limit. Off: the source size is kept when it fits.">
          Optimal size
        </Check>
        <Check checked={p.PictureAllowUpscaling} onChange={(v) => set('PictureAllowUpscaling', v)} hint="Lets smaller sources be scaled up to the limit.">
          Allow upscaling
        </Check>
        <Check checked={p.PictureKeepRatio} onChange={(v) => set('PictureKeepRatio', v)}>Keep aspect ratio</Check>
      </Card>

      <Card title="Borders">
        <div className="pe-grid">
          <Sel label="Fill" value={p.PicturePadMode} options={opts(PAD_MODES)} onChange={(v) => set('PicturePadMode', v)}
            hint="Adds bars so the output is exactly the limit's size." />
          <Sel label="Colour" value={p.PicturePadColor} options={opts(PAD_COLORS)} disabled={p.PicturePadMode === 'none'} onChange={(v) => set('PicturePadColor', v)} />
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

const custom = (value, onChange) => (
  <Text className="grow" value={value} onChange={onChange} mono placeholder="key=value:key=value" />
);
/** Keeps a preset/tune valid when its filter changes. */
const keep = (value, list, fallback) => (list.some(([v]) => v === value) ? value : fallback);

export function FiltersTab({ p, set, setMany }) {
  const deintOn = p.PictureDeinterlaceFilter && p.PictureDeinterlaceFilter !== 'off';
  const deintPresets = DEINTERLACE_PRESETS[p.PictureDeinterlaceFilter] ?? [];
  const denoiseOn = p.PictureDenoiseFilter && p.PictureDenoiseFilter !== 'off';
  const sharpenOn = p.PictureSharpenFilter && p.PictureSharpenFilter !== 'off';
  const sharpenTunes = SHARPEN_TUNES[p.PictureSharpenFilter] ?? [];
  return (
    <Card title="Filters" className="pe-filters">
      <FilterRow label="Detelecine" hint="Undoes 3:2 pulldown (film shown at 29.97 fps). Drops duplicate frames.">
        <Sel value={p.PictureDetelecine} options={opts(DETELECINE)} onChange={(v) => set('PictureDetelecine', v)} />
        {p.PictureDetelecine === 'custom' && custom(p.PictureDetelecineCustom, (v) => set('PictureDetelecineCustom', v))}
      </FilterRow>
      <FilterRow label="Interlace detection" hint="With a deinterlace filter, only frames found to be interlaced are deinterlaced.">
        <Sel value={p.PictureCombDetectPreset} options={opts(COMB_DETECT)} onChange={(v) => set('PictureCombDetectPreset', v)} />
        {p.PictureCombDetectPreset === 'custom' && custom(p.PictureCombDetectCustom, (v) => set('PictureCombDetectCustom', v))}
      </FilterRow>
      <FilterRow label="Deinterlace">
        <Sel
          value={p.PictureDeinterlaceFilter}
          options={opts(DEINTERLACE)}
          onChange={(v) => setMany({ PictureDeinterlaceFilter: v, PictureDeinterlacePreset: keep(p.PictureDeinterlacePreset, DEINTERLACE_PRESETS[v] ?? [], 'default') })}
        />
        {deintOn && <Sel value={p.PictureDeinterlacePreset} options={opts(deintPresets)} onChange={(v) => set('PictureDeinterlacePreset', v)} />}
        {deintOn && p.PictureDeinterlacePreset === 'custom' && custom(p.PictureDeinterlaceCustom, (v) => set('PictureDeinterlaceCustom', v))}
      </FilterRow>
      <FilterRow label="Deblock" hint="Smooths the blocks of heavily compressed sources.">
        <Sel value={p.PictureDeblockPreset} options={opts(DEBLOCK)} onChange={(v) => set('PictureDeblockPreset', v)} />
        {p.PictureDeblockPreset !== 'off' && p.PictureDeblockPreset !== 'custom' && (
          <Sel value={p.PictureDeblockTune} options={opts(DEBLOCK_TUNES)} onChange={(v) => set('PictureDeblockTune', v)} />
        )}
        {p.PictureDeblockPreset === 'custom' && custom(p.PictureDeblockCustom, (v) => set('PictureDeblockCustom', v))}
      </FilterRow>
      <FilterRow label="Denoise" hint="Removes grain and noise: smaller files, softer picture.">
        <Sel value={p.PictureDenoiseFilter} options={opts(DENOISE)} onChange={(v) => set('PictureDenoiseFilter', v)} />
        {denoiseOn && <Sel value={p.PictureDenoisePreset} options={opts(DENOISE_PRESETS)} onChange={(v) => set('PictureDenoisePreset', v)} />}
        {denoiseOn && p.PictureDenoiseFilter === 'nlmeans' && p.PictureDenoisePreset !== 'custom' && (
          <Sel value={p.PictureDenoiseTune} options={opts(NLMEANS_TUNES)} onChange={(v) => set('PictureDenoiseTune', v)} />
        )}
        {denoiseOn && p.PictureDenoisePreset === 'custom' && custom(p.PictureDenoiseCustom, (v) => set('PictureDenoiseCustom', v))}
      </FilterRow>
      <FilterRow label="Chroma smooth" hint="Softens colour noise and colour bleeding.">
        <Sel value={p.PictureChromaSmoothPreset} options={opts(CHROMA_SMOOTH)} onChange={(v) => set('PictureChromaSmoothPreset', v)} />
        {p.PictureChromaSmoothPreset !== 'off' && p.PictureChromaSmoothPreset !== 'custom' && (
          <Sel value={p.PictureChromaSmoothTune} options={opts(CHROMA_SMOOTH_TUNES)} onChange={(v) => set('PictureChromaSmoothTune', v)} />
        )}
        {p.PictureChromaSmoothPreset === 'custom' && custom(p.PictureChromaSmoothCustom, (v) => set('PictureChromaSmoothCustom', v))}
      </FilterRow>
      <FilterRow label="Sharpen">
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
      <FilterRow label="Colourspace" hint="Converts the colours to another standard, e.g. HDR (BT.2020) to SDR (BT.709).">
        <Sel value={p.PictureColorspacePreset} options={opts(COLORSPACE)} onChange={(v) => set('PictureColorspacePreset', v)} />
        {p.PictureColorspacePreset === 'custom' && custom(p.PictureColorspaceCustom, (v) => set('PictureColorspaceCustom', v))}
      </FilterRow>
      <FilterRow label="Greyscale">
        <Check checked={p.VideoGrayScale} onChange={(v) => set('VideoGrayScale', v)}>Black and white</Check>
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
  const tuneFlags = usesTuneFlags(p.VideoEncoder) ? TUNE_FLAGS.filter(([f]) => e.tunes.includes(f)) : [];
  const tunes = e.tunes.filter((t) => t !== 'none' && !tuneFlags.some(([f]) => f === t));
  const presetIndex = Math.max(0, e.presets.indexOf(p.VideoPreset));
  const showPresets = e.presets.length > 1;

  const encoders = caps.videoEncoders.map(({ name }) => {
    const fits = videoMuxers(name).includes(mux);
    return { value: name, label: `${VIDEO_ENCODERS[name] ?? name}${fits ? '' : ` (not in ${MUXER_NAME[mux]})`}`, disabled: !fits };
  });

  return (
    <>
      <Card title="Video">
        <div className="pe-grid">
          <Sel
            label="Video encoder"
            value={p.VideoEncoder}
            options={encoders}
            onChange={(v) => setMany(encoderChange(p, caps, v))}
            unknownLabel={(v) => `${VIDEO_ENCODERS[v] ?? v} (not on this server)`}
          />
          <Sel
            label="Frame rate (fps)"
            value={auto ? 'auto' : String(p.VideoFramerate)}
            options={[{ value: 'auto', label: 'Same as source' }, ...FRAMERATES.map((f) => ({ value: f, label: f }))]}
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
            ? [{ value: 'vfr', label: 'Variable frame rate' }, { value: 'cfr', label: 'Constant frame rate' }]
            : [{ value: 'cfr', label: 'Constant frame rate' }, { value: 'pfr', label: 'Peak frame rate' }]}
        />
      </Card>

      <Card title="Quality">
        <Radios
          value={p.VideoQualityType}
          onChange={(v) => set('VideoQualityType', v)}
          options={[
            ...(q ? [{ value: 2, label: 'Constant quality' }] : []),
            { value: 1, label: 'Average bitrate' },
            ...(p.VideoQualityType === 0 ? [{ value: 0, label: 'Target size (older presets)' }] : []),
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
              aria-label={`Constant quality (${q.label})`}
            />
            <Num value={p.VideoQualitySlider} min={q.low} max={q.high} step={q.step} onChange={(v) => set('VideoQualitySlider', v)} suffix={q.label} />
            <span className="set-hint pe-quality-hint">
              {q.lowerIsBetter ? 'Lower values give better quality and bigger files.' : 'Higher values give better quality and bigger files.'}
              {/^x26[45]/.test(p.VideoEncoder) ? ' RF 18–22 suits most HD video with x264, 20–24 with x265.' : ''}
            </span>
          </div>
        )}
        {p.VideoQualityType !== 2 && (
          <>
            <div className="pe-grid">
              <Num label="Average bitrate" value={p.VideoAvgBitrate} min={1} max={500000} suffix="kbit/s" onChange={(v) => set('VideoAvgBitrate', v)} />
            </div>
            <Check checked={p.VideoMultiPass} onChange={(v) => set('VideoMultiPass', v)} hint="Analyses the video first so the bitrate goes where it is needed. About twice as slow.">
              Multi-pass encoding
            </Check>
            {supportsTurbo(p.VideoEncoder) && (
              <Check checked={p.VideoTurboMultiPass} disabled={!p.VideoMultiPass} onChange={(v) => set('VideoTurboMultiPass', v)} hint="A faster first pass, with almost the same result.">
                Turbo analysis pass
              </Check>
            )}
          </>
        )}
      </Card>

      <Card title="Encoder options">
        {showPresets && (
          <div className="set-field">
            <span className="set-label">Encoder preset: <strong className="pe-preset-name">{p.VideoPreset || '—'}</strong></span>
            <input
              type="range"
              min={0}
              max={e.presets.length - 1}
              step={1}
              value={presetIndex}
              onChange={(ev) => set('VideoPreset', e.presets[Number(ev.target.value)])}
              aria-label="Encoder preset"
              aria-valuetext={p.VideoPreset}
            />
            <span className="pe-range-ends set-hint"><span>Faster</span><span>Slower, smaller files</span></span>
          </div>
        )}
        <div className="pe-grid">
          {(tunes.length > 0 || tune) && (
            <Sel
              label="Tune"
              value={tune}
              options={[{ value: '', label: 'None' }, ...tunes.map((t) => ({ value: t, label: t }))]}
              onChange={(v) => set('VideoTune', joinTune(v, flags))}
            />
          )}
          {(e.profiles.length > 1 || (p.VideoProfile && p.VideoProfile !== 'auto')) && (
            <Sel label="Profile" value={p.VideoProfile} options={e.profiles.map((x) => ({ value: x, label: x === 'auto' ? 'Auto' : x }))} onChange={(v) => set('VideoProfile', v)} />
          )}
          {(e.levels.length > 1 || (p.VideoLevel && p.VideoLevel !== 'auto')) && (
            <Sel label="Level" value={p.VideoLevel} options={e.levels.map((x) => ({ value: x, label: x === 'auto' ? 'Auto' : x }))} onChange={(v) => set('VideoLevel', v)} />
          )}
        </div>
        {tuneFlags.length > 0 && (
          <div className="pe-checks-row">
            {tuneFlags.map(([f, label]) => (
              <Check key={f} checked={flags.includes(f)} onChange={(on) => set('VideoTune', joinTune(tune, on ? [...flags, f] : flags.filter((x) => x !== f)))}>
                {label}
              </Check>
            ))}
          </div>
        )}
        <Text
          label="Advanced options"
          value={p.VideoOptionExtra}
          onChange={(v) => set('VideoOptionExtra', v)}
          mono
          placeholder="option1=value1:option2=value2"
          hint="Passed to the encoder as they are (x264/x265 option names)."
        />
      </Card>

      <Card title="Colour and HDR">
        <div className="pe-grid">
          <Sel label="Colour range" value={p.VideoColorRange} options={opts(COLOR_RANGE)} onChange={(v) => set('VideoColorRange', v)} />
          <Sel label="HDR dynamic metadata" value={p.VideoPasshtruHDRDynamicMetadata} options={opts(HDR_METADATA)} onChange={(v) => set('VideoPasshtruHDRDynamicMetadata', v)}
            hint="HDR10+ and Dolby Vision data copied from the source." />
        </div>
      </Card>
    </>
  );
}
