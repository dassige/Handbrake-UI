// The preset editor's Audio and Subtitles tabs: HandBrake desktop's "Selection Behavior"
// settings, which decide which source tracks are kept and how audio is encoded.
import { ArrowDown, ArrowUp, ChevronLeft, Plus, Trash2, X } from 'lucide-react';
import { Card, Check } from '../settings/fields.jsx';
import { Num, Sel } from './editorFields.jsx';
import { LANGUAGES, language } from './languages.js';
import {
  AUDIO_BITRATES, AUDIO_ENCODERS, AUDIO_NAMING, BURN_BEHAVIORS, MIXDOWNS, NEW_AUDIO_TRACK, SAMPLERATES, TRACK_BEHAVIORS,
  audioMuxers, audioQualityLimits, isLossless, isPassthru, muxer, opts,
} from './hbOptions.js';

/** Ordered list of ISO 639-2 codes; the first is preferred. "any" matches every language. */
export function LanguagePicker({ value = [], onChange, disabled, label }) {
  const chosen = new Set(value);
  const move = (i) => onChange(value.map((c, j) => (j === i - 1 ? value[i] : j === i ? value[i - 1] : c)));
  return (
    <div className="set-field">
      <span className="set-label">{label}</span>
      <div className={`pe-langs ${disabled ? 'disabled' : ''}`}>
        {value.length === 0 && <span className="muted small">No languages: only tracks with no language match.</span>}
        {value.map((code, i) => {
          const l = language(code);
          return (
            <span key={code} className="chip pe-lang" title={l?.native ? `${l.name} · ${l.native}` : l?.name ?? code}>
              {i > 0 && (
                <button type="button" className="pe-chip-btn" onClick={() => move(i)} disabled={disabled} aria-label={`Move ${l?.name ?? code} up`}>
                  <ChevronLeft size={12} />
                </button>
              )}
              <span>{l?.name ?? code}</span>
              <code className="muted">{code}</code>
              <button type="button" className="pe-chip-btn" onClick={() => onChange(value.filter((c) => c !== code))} disabled={disabled} aria-label={`Remove ${l?.name ?? code}`}>
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
        aria-label={`Add a language to ${label}`}
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
      >
        <option value="">Add a language…</option>
        {!chosen.has('any') && <option value="any">Any language</option>}
        {LANGUAGES.filter(([code]) => !chosen.has(code)).map(([code, name, native]) => (
          <option key={code} value={code}>
            {name}{native ? ` (${native})` : ''} · {code}
          </option>
        ))}
      </select>
      <span className="set-hint">The order matters: the first language is preferred. “Any” matches every language.</span>
    </div>
  );
}

const label = (enc) => AUDIO_ENCODERS[enc] ?? enc;

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
          unknownLabel={(v) => `${label(v)} (not on this server)`}
        />
        <button type="button" className="icon-btn" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp size={15} /></button>
        <button type="button" className="icon-btn" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down"><ArrowDown size={15} /></button>
        <button type="button" className="icon-btn danger" onClick={onRemove} aria-label="Remove this encoder"><Trash2 size={15} /></button>
      </div>
      {pass ? (
        <p className="set-hint">
          {enc === 'none' ? 'No audio for these tracks.' : 'The source audio is copied unchanged when it is in this format; otherwise the passthru fallback is used.'}
        </p>
      ) : (
        <div className="pe-grid pe-track-fields">
          <Sel label="Mixdown" value={track.AudioMixdown} options={Object.entries(MIXDOWNS).filter(([v]) => v !== 'none').map(([value, l]) => ({ value, label: l }))}
            onChange={(v) => set({ AudioMixdown: v })} />
          <Sel label="Sample rate" value={String(track.AudioSamplerate ?? 'auto')}
            options={[{ value: 'auto', label: 'Auto' }, ...SAMPLERATES.map((s) => ({ value: s, label: `${s} kHz` }))]}
            onChange={(v) => set({ AudioSamplerate: v })} />
          {q && (
            <Sel label="Rate control" value={useQuality ? 'q' : 'b'} options={[{ value: 'b', label: 'Bitrate' }, { value: 'q', label: 'Quality' }]}
              onChange={(v) => set({ AudioTrackQualityEnable: v === 'q', AudioTrackQuality: v === 'q' && track.AudioTrackQuality < q.low ? q.def : track.AudioTrackQuality })} />
          )}
          {useQuality ? (
            <Num label={q.lowerIsBetter ? 'Quality (lower is better)' : 'Quality'} value={track.AudioTrackQuality} min={q.low} max={q.high} step={q.step} onChange={(v) => set({ AudioTrackQuality: v })} />
          ) : !isLossless(enc) ? (
            <Sel label="Bitrate" value={Number(track.AudioBitrate)} options={AUDIO_BITRATES.map((b) => ({ value: b, label: `${b} kbit/s` }))}
              onChange={(v) => set({ AudioBitrate: v })} unknownLabel={(v) => (v > 0 ? `${v} kbit/s` : 'Auto')} />
          ) : null}
          <Num label="Gain" value={track.AudioTrackGainSlider} min={-20} max={20} step={1} suffix="dB" onChange={(v) => set({ AudioTrackGainSlider: v })} />
          <Num label="DRC" value={track.AudioTrackDRCSlider} min={0} max={4} step={0.1} onChange={(v) => set({ AudioTrackDRCSlider: v })}
            hint="0 = off; 1.5–2.5 makes quiet parts louder." />
        </div>
      )}
    </div>
  );
}

export function AudioTab({ p, set, caps }) {
  const mux = muxer(p.FileFormat);
  const tracks = p.AudioList ?? [];
  const available = caps.audioEncoders?.length ? caps.audioEncoders : Object.keys(AUDIO_ENCODERS);
  const encoders = available.map((e) => {
    const fits = audioMuxers(e).includes(mux);
    return { value: e, label: `${label(e)}${fits ? '' : ' (not in this container)'}`, disabled: !fits };
  });
  const passthrus = available.filter((e) => isPassthru(e) && e !== 'copy');
  const fallbacks = available.filter((e) => !isPassthru(e)).map((e) => ({ value: e, label: label(e), disabled: !audioMuxers(e).includes(mux) }));
  const mask = new Set(p.AudioCopyMask ?? []);
  const setTracks = (list) => set('AudioList', list);

  return (
    <>
      <Card title="Track selection">
        <div className="pe-grid">
          <Sel label="Source tracks" value={p.AudioTrackSelectionBehavior} options={opts(TRACK_BEHAVIORS)} onChange={(v) => set('AudioTrackSelectionBehavior', v)} />
        </div>
        <LanguagePicker label="Languages" value={p.AudioLanguageList} onChange={(v) => set('AudioLanguageList', v)} disabled={p.AudioTrackSelectionBehavior === 'none'} />
        <Check checked={p.AudioSecondaryEncoderMode} onChange={(v) => set('AudioSecondaryEncoderMode', v)}
          hint="The first source track gets every encoder below; the other tracks get only the first one.">
          Use only the first encoder for secondary audio
        </Check>
      </Card>

      <Card title="Encoders" aside={<button type="button" className="btn small" onClick={() => setTracks([...tracks, { ...NEW_AUDIO_TRACK }])}><Plus size={14} /> Add encoder</button>}>
        <p className="set-hint">Each selected source track is converted with these encoders, one output track per encoder.</p>
        {tracks.length === 0 && <p className="muted small">No encoders: the output will have no audio.</p>}
        {tracks.map((t, i) => (
          <AudioTrackRow
            key={i}
            track={t}
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

      <Card title="Auto passthru">
        <p className="set-hint">With the <strong>Auto passthru</strong> encoder, source audio in these formats is copied unchanged; anything else is converted with the fallback encoder.</p>
        <div className="pe-checks-grid">
          {passthrus.map((e) => (
            <Check key={e} checked={mask.has(e)} onChange={(on) => set('AudioCopyMask', on ? [...mask, e] : [...mask].filter((x) => x !== e))}>
              {label(e).replace(/ passthru$/i, '')}
            </Check>
          ))}
        </div>
        <div className="pe-grid">
          <Sel label="Passthru fallback" value={p.AudioEncoderFallback} options={fallbacks} onChange={(v) => set('AudioEncoderFallback', v)} unknownLabel={label} />
        </div>
      </Card>

      <Card title="Track names">
        <div className="pe-grid">
          <Sel label="Automatic names" value={p.AudioAutomaticNamingBehavior} options={opts(AUDIO_NAMING)} onChange={(v) => set('AudioAutomaticNamingBehavior', v)}
            hint="Names tracks after their channels, e.g. “Stereo” or “Surround 5.1”." />
        </div>
        <Check checked={p.AudioTrackNamePassthru} onChange={(v) => set('AudioTrackNamePassthru', v)}>Keep the source track names</Check>
      </Card>
    </>
  );
}

export function SubtitlesTab({ p, set }) {
  const none = p.SubtitleTrackSelectionBehavior === 'none';
  return (
    <>
      <Card title="Track selection">
        <div className="pe-grid">
          <Sel label="Source tracks" value={p.SubtitleTrackSelectionBehavior} options={opts(TRACK_BEHAVIORS)} onChange={(v) => set('SubtitleTrackSelectionBehavior', v)} />
        </div>
        <LanguagePicker label="Languages" value={p.SubtitleLanguageList} onChange={(v) => set('SubtitleLanguageList', v)} disabled={none} />
        <Check checked={p.SubtitleAddForeignAudioSearch} onChange={(v) => set('SubtitleAddForeignAudioSearch', v)}
          hint="Looks for subtitles that appear only when people speak another language, and adds them as a forced track.">
          Foreign audio scan
        </Check>
        <Check checked={p.SubtitleAddForeignAudioSubtitle} onChange={(v) => set('SubtitleAddForeignAudioSubtitle', v)}
          hint="When the audio isn’t in the first language of the list, adds a subtitle track in that language.">
          Add subtitles when the audio is in a foreign language
        </Check>
        <Check checked={p.SubtitleAddCC} onChange={(v) => set('SubtitleAddCC', v)}>Add closed captions when available</Check>
        <Check checked={p.SubtitleTrackNamePassthru} onChange={(v) => set('SubtitleTrackNamePassthru', v)}>Keep the source track names</Check>
      </Card>
      <Card title="Burn in">
        <p className="set-hint">A burned-in subtitle becomes part of the picture: always visible, can’t be turned off. Only one track can be burned in.</p>
        <div className="pe-grid">
          <Sel label="Burn-in behaviour" value={p.SubtitleBurnBehavior} options={opts(BURN_BEHAVIORS)} onChange={(v) => set('SubtitleBurnBehavior', v)} />
        </div>
        <Check checked={p.SubtitleBurnDVDSub} onChange={(v) => set('SubtitleBurnDVDSub', v)}>Burn in DVD subtitles</Check>
        <Check checked={p.SubtitleBurnBDSub} onChange={(v) => set('SubtitleBurnBDSub', v)}
          hint="MP4 can’t hold picture-based (DVD and Blu-ray) subtitles: burning them in is the only way to keep them.">
          Burn in Blu-ray subtitles
        </Check>
      </Card>
    </>
  );
}
