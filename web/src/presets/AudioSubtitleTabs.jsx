// The preset editor's Audio and Subtitles tabs: HandBrake desktop's "Selection Behavior"
// settings, which decide which source tracks are kept and how audio is encoded.
import { ArrowDown, ArrowUp, ChevronLeft, Plus, Trash2, X } from 'lucide-react';
import { Card, Check } from '../settings/fields.jsx';
import { rich, t } from '../i18n/index.js';
import { Num, Sel } from './editorFields.jsx';
import { language, languageList } from './languages.js';
import {
  AUDIO_BITRATES, AUDIO_ENCODERS, AUDIO_NAMING, BURN_BEHAVIORS, MIXDOWNS, NEW_AUDIO_TRACK, SAMPLERATES, TRACK_BEHAVIORS,
  audioEncoderLabel, audioMuxers, audioQualityLimits, isLossless, isPassthru, muxer, opts, passthruFormat,
} from './hbOptions.js';

/** Ordered list of ISO 639-2 codes; the first is preferred. "any" matches every language. */
export function LanguagePicker({ value = [], onChange, disabled, label }) {
  const chosen = new Set(value);
  const move = (i) => onChange(value.map((c, j) => (j === i - 1 ? value[i] : j === i ? value[i - 1] : c)));
  return (
    <div className="set-field">
      <span className="set-label">{label}</span>
      <div className={`pe-langs ${disabled ? 'disabled' : ''}`}>
        {value.length === 0 && <span className="muted small">{t('presets.languages.none')}</span>}
        {value.map((code, i) => {
          const l = language(code);
          const name = l?.name ?? code;
          return (
            <span key={code} className="chip pe-lang" title={l?.native ? `${name} · ${l.native}` : name}>
              {i > 0 && (
                <button type="button" className="pe-chip-btn" onClick={() => move(i)} disabled={disabled} aria-label={t('presets.languages.moveUp', { language: name })}>
                  <ChevronLeft size={12} />
                </button>
              )}
              <span>{name}</span>
              <code className="muted">{code}</code>
              <button type="button" className="pe-chip-btn" onClick={() => onChange(value.filter((c) => c !== code))} disabled={disabled} aria-label={t('presets.languages.remove', { language: name })}>
                <X size={12} />
              </button>
            </span>
          );
        })}
      </div>
      <select
        className="pe-lang-add"
        value=""
        disabled={disabled}
        aria-label={t('presets.languages.addTo', { list: label })}
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
      >
        <option value="">{t('presets.languages.add')}</option>
        {!chosen.has('any') && <option value="any">{t('presets.languages.anyLanguage')}</option>}
        {languageList().filter((l) => !chosen.has(l.code)).map(({ code, name, native }) => (
          <option key={code} value={code}>
            {name}{native ? ` (${native})` : ''} · {code}
          </option>
        ))}
      </select>
      <span className="set-hint">{t('presets.languages.hint')}</span>
    </div>
  );
}

function AudioTrackRow({ track, index, count, encoders, mux, onChange, onRemove, onMove }) {
  const enc = track.AudioEncoder;
  const pass = isPassthru(enc) || enc === 'none';
  const q = audioQualityLimits(enc);
  const useQuality = !!q && track.AudioTrackQualityEnable;
  const set = (patch) => onChange({ ...track, ...patch });
  const fits = audioMuxers(enc).includes(mux);
  return (
    <div className={`pe-track ${fits ? '' : 'bad'}`}>
      <div className="pe-track-head">
        <span className="pe-track-num">{index + 1}</span>
        <Sel
          className="grow"
          value={enc}
          options={encoders}
          onChange={(v) => {
            const nq = audioQualityLimits(v);
            set({ AudioEncoder: v, AudioTrackQualityEnable: !!nq && track.AudioTrackQualityEnable, AudioTrackQuality: nq ? nq.def : -1 });
          }}
          unknownLabel={(v) => t('presets.editor.notOnServer', { name: audioEncoderLabel(v) })}
        />
        <button type="button" className="icon-btn" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t('presets.audio.moveUp')}><ArrowUp size={15} /></button>
        <button type="button" className="icon-btn" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={t('presets.audio.moveDown')}><ArrowDown size={15} /></button>
        <button type="button" className="icon-btn danger" onClick={onRemove} aria-label={t('presets.audio.remove')}><Trash2 size={15} /></button>
      </div>
      {pass ? (
        <p className="set-hint">
          {enc === 'none' ? t('presets.audio.noAudio') : t('presets.audio.passthruHint')}
        </p>
      ) : (
        <div className="pe-grid pe-track-fields">
          <Sel label={t('presets.audio.mixdown')} value={track.AudioMixdown} options={opts(MIXDOWNS.filter((o) => o.value !== 'none'))}
            onChange={(v) => set({ AudioMixdown: v })} />
          <Sel label={t('presets.audio.sampleRate')} value={String(track.AudioSamplerate ?? 'auto')}
            options={[{ value: 'auto', label: t('presetOptions.auto') }, ...SAMPLERATES.map((s) => ({ value: s, label: `${s} kHz` }))]}
            onChange={(v) => set({ AudioSamplerate: v })} />
          {q && (
            <Sel label={t('presets.audio.rateControl')} value={useQuality ? 'q' : 'b'} options={[{ value: 'b', label: t('presets.audio.bitrate') }, { value: 'q', label: t('presets.audio.quality') }]}
              onChange={(v) => set({ AudioTrackQualityEnable: v === 'q', AudioTrackQuality: v === 'q' && track.AudioTrackQuality < q.low ? q.def : track.AudioTrackQuality })} />
          )}
          {useQuality ? (
            <Num label={q.lowerIsBetter ? t('presets.audio.qualityLowerIsBetter') : t('presets.audio.quality')} value={track.AudioTrackQuality} min={q.low} max={q.high} step={q.step} onChange={(v) => set({ AudioTrackQuality: v })} />
          ) : !isLossless(enc) ? (
            <Sel label={t('presets.audio.bitrate')} value={Number(track.AudioBitrate)} options={AUDIO_BITRATES.map((b) => ({ value: b, label: `${b} kbit/s` }))}
              onChange={(v) => set({ AudioBitrate: v })} unknownLabel={(v) => (v > 0 ? `${v} kbit/s` : t('presetOptions.auto'))} />
          ) : null}
          <Num label={t('presets.audio.gain')} value={track.AudioTrackGainSlider} min={-20} max={20} step={1} suffix="dB" onChange={(v) => set({ AudioTrackGainSlider: v })} />
          <Num label={t('presets.audio.drc')} value={track.AudioTrackDRCSlider} min={0} max={4} step={0.1} onChange={(v) => set({ AudioTrackDRCSlider: v })}
            hint={t('presets.audio.drcHint')} />
        </div>
      )}
    </div>
  );
}

export function AudioTab({ p, set, caps }) {
  const mux = muxer(p.FileFormat);
  const tracks = p.AudioList ?? [];
  const available = caps.audioEncoders?.length ? caps.audioEncoders : AUDIO_ENCODERS;
  const encoders = available.map((e) => {
    const fits = audioMuxers(e).includes(mux);
    const name = audioEncoderLabel(e);
    return { value: e, label: fits ? name : t('presets.editor.notInThisContainer', { name }), disabled: !fits };
  });
  const passthrus = available.filter((e) => isPassthru(e) && e !== 'copy');
  const fallbacks = available.filter((e) => !isPassthru(e)).map((e) => ({ value: e, label: audioEncoderLabel(e), disabled: !audioMuxers(e).includes(mux) }));
  const mask = new Set(p.AudioCopyMask ?? []);
  const setTracks = (list) => set('AudioList', list);

  return (
    <>
      <Card title={t('presets.tracks.selection')}>
        <div className="pe-grid">
          <Sel label={t('presets.tracks.sourceTracks')} value={p.AudioTrackSelectionBehavior} options={opts(TRACK_BEHAVIORS)} onChange={(v) => set('AudioTrackSelectionBehavior', v)} />
        </div>
        <LanguagePicker label={t('presets.tracks.languages')} value={p.AudioLanguageList} onChange={(v) => set('AudioLanguageList', v)} disabled={p.AudioTrackSelectionBehavior === 'none'} />
        <Check checked={p.AudioSecondaryEncoderMode} onChange={(v) => set('AudioSecondaryEncoderMode', v)}
          hint={t('presets.audio.secondaryHint')}>
          {t('presets.audio.secondary')}
        </Check>
      </Card>

      <Card title={t('presets.audio.encoders')} aside={<button type="button" className="btn small" onClick={() => setTracks([...tracks, { ...NEW_AUDIO_TRACK }])}><Plus size={14} /> {t('presets.audio.addEncoder')}</button>}>
        <p className="set-hint">{t('presets.audio.encodersHint')}</p>
        {tracks.length === 0 && <p className="muted small">{t('presets.audio.noEncoders')}</p>}
        {tracks.map((tr, i) => (
          <AudioTrackRow
            key={i}
            track={tr}
            index={i}
            count={tracks.length}
            encoders={encoders}
            mux={mux}
            onChange={(nt) => setTracks(tracks.map((x, j) => (j === i ? nt : x)))}
            onRemove={() => setTracks(tracks.filter((_, j) => j !== i))}
            onMove={(d) => {
              const list = [...tracks];
              [list[i], list[i + d]] = [list[i + d], list[i]];
              setTracks(list);
            }}
          />
        ))}
      </Card>

      <Card title={t('presetOptions.audioEncoder.autoPassthru')}>
        <p className="set-hint">{rich('presets.audio.autoPassthruHint')}</p>
        <div className="pe-checks-grid">
          {passthrus.map((e) => (
            <Check key={e} checked={mask.has(e)} onChange={(on) => set('AudioCopyMask', on ? [...mask, e] : [...mask].filter((x) => x !== e))}>
              {passthruFormat(e)}
            </Check>
          ))}
        </div>
        <div className="pe-grid">
          <Sel label={t('presets.audio.passthruFallback')} value={p.AudioEncoderFallback} options={fallbacks} onChange={(v) => set('AudioEncoderFallback', v)} unknownLabel={audioEncoderLabel} />
        </div>
      </Card>

      <Card title={t('presets.audio.trackNames')}>
        <div className="pe-grid">
          <Sel label={t('presets.audio.automaticNames')} value={p.AudioAutomaticNamingBehavior} options={opts(AUDIO_NAMING)} onChange={(v) => set('AudioAutomaticNamingBehavior', v)}
            hint={t('presets.audio.automaticNamesHint')} />
        </div>
        <Check checked={p.AudioTrackNamePassthru} onChange={(v) => set('AudioTrackNamePassthru', v)}>{t('presets.tracks.keepNames')}</Check>
      </Card>
    </>
  );
}

export function SubtitlesTab({ p, set }) {
  const none = p.SubtitleTrackSelectionBehavior === 'none';
  return (
    <>
      <Card title={t('presets.tracks.selection')}>
        <div className="pe-grid">
          <Sel label={t('presets.tracks.sourceTracks')} value={p.SubtitleTrackSelectionBehavior} options={opts(TRACK_BEHAVIORS)} onChange={(v) => set('SubtitleTrackSelectionBehavior', v)} />
        </div>
        <LanguagePicker label={t('presets.tracks.languages')} value={p.SubtitleLanguageList} onChange={(v) => set('SubtitleLanguageList', v)} disabled={none} />
        <Check checked={p.SubtitleAddForeignAudioSearch} onChange={(v) => set('SubtitleAddForeignAudioSearch', v)}
          hint={t('presets.subtitles.foreignScanHint')}>
          {t('presets.subtitles.foreignScan')}
        </Check>
        <Check checked={p.SubtitleAddForeignAudioSubtitle} onChange={(v) => set('SubtitleAddForeignAudioSubtitle', v)}
          hint={t('presets.subtitles.foreignSubtitleHint')}>
          {t('presets.subtitles.foreignSubtitle')}
        </Check>
        <Check checked={p.SubtitleAddCC} onChange={(v) => set('SubtitleAddCC', v)}>{t('presets.subtitles.closedCaptions')}</Check>
        <Check checked={p.SubtitleTrackNamePassthru} onChange={(v) => set('SubtitleTrackNamePassthru', v)}>{t('presets.tracks.keepNames')}</Check>
      </Card>
      <Card title={t('presets.subtitles.burnIn')}>
        <p className="set-hint">{t('presets.subtitles.burnInHint')}</p>
        <div className="pe-grid">
          <Sel label={t('presets.subtitles.burnBehaviour')} value={p.SubtitleBurnBehavior} options={opts(BURN_BEHAVIORS)} onChange={(v) => set('SubtitleBurnBehavior', v)} />
        </div>
        <Check checked={p.SubtitleBurnDVDSub} onChange={(v) => set('SubtitleBurnDVDSub', v)}>{t('presets.subtitles.burnDVD')}</Check>
        <Check checked={p.SubtitleBurnBDSub} onChange={(v) => set('SubtitleBurnBDSub', v)}
          hint={t('presets.subtitles.burnBDHint')}>
          {t('presets.subtitles.burnBD')}
        </Check>
      </Card>
    </>
  );
}
