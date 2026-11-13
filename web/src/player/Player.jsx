import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CirclePlay } from 'lucide-react';
import { api } from '../api.js';
import { Modal } from '../components/Modal.jsx';
import { Help } from '../help/Help.jsx';
import { t } from '../i18n/index.js';
import { errorText } from '../i18n/serverText.js';

// The video player (server/src/media.js): the file itself when the browser can play it, else a
// stream converted on the fly ("compatible"), which needs its own position bar to jump.

const PlayerContext = createContext(null);

/** Renders the player when open() is called: open({ title?, sources: [{ label?, path }], initial? }). */
export function PlayerProvider({ children }) {
  const [state, setState] = useState(null);
  const open = useCallback((s) => setState(s), []);
  return (
    <PlayerContext.Provider value={open}>
      {children}
      {state && <PlayerModal {...state} onClose={() => setState(null)} />}
    </PlayerContext.Provider>
  );
}

/** open({ sources, initial, title }), or null outside the app (e.g. in a test page). */
export const usePlayer = () => useContext(PlayerContext);

/** Whether a file name is a video by the extensions in Settings. */
export function isVideoName(settings, name) {
  const ext = /\.([^.]+)$/.exec(name ?? '')?.[1]?.toLowerCase();
  return !!ext && (settings?.videoExtensions ?? []).includes(ext);
}

/** A small round play button; stops the click so rows don't react to it. */
export function PlayButton({ onClick, title = t('player.playTitle'), className = '' }) {
  return (
    <button
      type="button"
      className={`icon-btn play-btn ${className}`}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <CirclePlay size={16} />
    </button>
  );
}

/** h:mm:ss / m:ss */
function clock(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** HEVC plays only where the browser and the hardware support it. */
function browserCanPlay(info) {
  if (info.video?.codec !== 'hevc') return true;
  const v = document.createElement('video');
  return v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== '' || v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') !== '';
}

/** A <video> that stops downloading (and so the server's conversion) when it goes away. */
function Video({ src, videoRef, ...rest }) {
  const own = useRef(null);
  useEffect(() => {
    const v = own.current;
    return () => {
      v.pause();
      v.removeAttribute('src');
      v.load();
    };
  }, []);
  return (
    <video
      ref={(el) => {
        own.current = el;
        videoRef.current = el;
      }}
      src={src}
      controls
      autoPlay
      playsInline
      {...rest}
    />
  );
}

function PlayerModal({ title, sources, initial = 0, onClose }) {
  const [index, setIndex] = useState(Math.min(initial, sources.length - 1));
  const source = sources[index];
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(null); // 'direct' | 'compat'
  const [fellBack, setFellBack] = useState(false);
  const [offset, setOffset] = useState(0); // compatible: where the stream starts
  const [current, setCurrent] = useState(0); // seconds played in the <video>
  const [dragging, setDragging] = useState(null);
  const [audio, setAudio] = useState(0);
  const videoRef = useRef(null);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setError(null);
    setMode(null);
    setFellBack(false);
    setOffset(0);
    setCurrent(0);
    setAudio(0);
    api.mediaInfo(source.path).then(
      (i) => {
        if (!live) return;
        setInfo(i);
        setMode(i.direct && browserCanPlay(i) ? 'direct' : 'compat');
      },
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [source.path]);

  const position = () => (mode === 'compat' ? offset : 0) + (videoRef.current?.currentTime ?? 0);

  /** Plays converted on the fly from where it is now (or from `at`). */
  function toCompat({ at = position(), track = audio, fallback = false } = {}) {
    setOffset(Math.floor(at));
    setCurrent(0);
    setAudio(track);
    setMode('compat');
    if (fallback) setFellBack(true);
  }

  function toDirect() {
    // Back to the file itself; the browser cannot start it at a position before it loads.
    const at = position();
    setMode('direct');
    setCurrent(0);
    setTimeout(() => {
      if (videoRef.current) videoRef.current.currentTime = at;
    }, 0);
  }

  function commitSeek() {
    if (dragging == null) return;
    setOffset(dragging);
    setCurrent(0);
    setDragging(null);
  }

  const url = mode === 'direct' ? api.mediaFileUrl(source.path) : mode === 'compat' ? api.mediaStreamUrl(source.path, offset, audio) : null;
  const duration = info?.duration ?? 0;
  const v = info?.video;

  return (
    <Modal
      title={
        <span className="player-title">
          {title ?? info?.name ?? source.path.split(/[\\/]/).pop()}
          <Help id="player" />
        </span>
      }
      ariaLabel={t('player.label')}
      onClose={onClose}
      wide
      className="player-overlay"
    >
      {sources.length > 1 && (
        <div className="filters player-sources">
          {sources.map((s, i) => (
            <button key={s.path} className={`chip ${i === index ? 'active' : ''}`} onClick={() => setIndex(i)} title={s.path}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <p className="text-bad">{error}</p>
      ) : !url ? (
        <p className="muted">{t('player.loading')}</p>
      ) : (
        <div className="player">
          <Video
            key={url}
            src={url}
            videoRef={videoRef}
            className={mode === 'compat' ? 'compat' : ''}
            onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              // A codec the browser does not decode can leave a video without picture.
              if (mode === 'direct' && v && e.currentTarget.videoWidth === 0) toCompat({ fallback: true });
            }}
            onError={() => {
              if (mode === 'direct') toCompat({ at: 0, fallback: true });
              else setError(t('player.failed'));
            }}
          />

          {mode === 'compat' && duration > 0 && (
            <div className="player-seek">
              <span className="mono small">{clock(dragging ?? offset + current)}</span>
              <input
                type="range"
                min={0}
                max={Math.floor(duration)}
                step={1}
                value={Math.min(Math.floor(duration), Math.floor(dragging ?? offset + current))}
                onChange={(e) => setDragging(Number(e.target.value))}
                onPointerUp={commitSeek}
                onKeyUp={commitSeek}
                onBlur={commitSeek}
                aria-label={t('player.position')}
              />
              <span className="mono small">{clock(duration)}</span>
            </div>
          )}

          <div className="player-bar">
            <span className="muted small">
              {[v && `${v.codec ?? '?'}${v.width ? ` ${v.width}×${v.height}` : ''}`, info?.audio?.map((a) => a.codec).join(', '), duration ? clock(duration) : null].filter(Boolean).join(' · ')}
            </span>
            <span className="spacer" />
            {info?.audio?.length > 1 && (
              <label className="field-inline small">
                {t('player.audio')}
                <select value={audio} onChange={(e) => toCompat({ track: Number(e.target.value) })}>
                  {info.audio.map((a, i) => (
                    <option key={i} value={i}>
                      {[a.language?.toUpperCase(), a.title, a.codec, a.channels ? `${a.channels}ch` : null].filter(Boolean).join(' · ') || t('player.track', { n: i + 1 })}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {info?.direct && (
              <label className="check small" title={t('player.compatTitle')}>
                <input type="checkbox" checked={mode === 'compat'} onChange={(e) => (e.target.checked ? toCompat() : toDirect())} />
                {t('player.compat')}
              </label>
            )}
          </div>
          {mode === 'compat' && <p className="set-hint">{fellBack ? t('player.fellBack') : t('player.compatHint')}</p>}
        </div>
      )}
    </Modal>
  );
}
