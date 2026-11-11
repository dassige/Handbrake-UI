import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '../api.js';
import { Card } from './fields.jsx';
import content from './credits.json';

/* global __WEB_VERSION__ */
const WEB_VERSION = typeof __WEB_VERSION__ === 'undefined' ? {} : __WEB_VERSION__;

const SUMMARY =
  'Turns a headless Linux box into a HandBrake conversion server: pick videos on the server (or upload them), queue them with HandBrake presets (made in its preset editor or imported from the desktop app), and get checked, renamed results. It runs the official HandBrakeCLI and is not affiliated with the HandBrake project.';

function External({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="ext-link">
      {children} <ExternalLink size={12} />
    </a>
  );
}

/** "2026/11/10 13:04" (DGS AutoVersion) → a readable date. */
function released(v) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(v ?? '');
  if (!m) return v ?? null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "1.2.0 · 10 Nov 2026 12:07 · 170ad19" */
function VersionRow({ label, v, repo }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {v?.version ?? '…'}
        {v?.date && <span className="muted"> · {v.date}</span>}
        {v?.commit && (
          <span className="muted">
            {' · '}
            {repo ? <a className="mono" href={`${repo}/commit/${v.commit}`} target="_blank" rel="noreferrer" title={v.commit}>{v.commit.slice(0, 7)}</a> : v.commit.slice(0, 7)}
          </span>
        )}
      </dd>
    </>
  );
}

export function AboutSection({ info, onError }) {
  const [about, setAbout] = useState(null);
  useEffect(() => {
    api.about().then(setAbout, onError);
  }, [onError]);

  const app = about?.versions?.app;
  const year = app?.date?.slice(0, 4) ?? String(new Date().getFullYear());
  const hb = about?.handbrake ?? info?.handbrake;
  const releases = about?.releases ?? [];
  const current = releases.find((r) => r.version === app?.version);
  // Open the newest release, and the newest one that has notes when that differs.
  const firstWithNotes = releases.find((r) => r.notes.length);

  return (
    <>
      <section className="set-card about-hero">
        <img src="/favicon.svg" alt="" width={52} height={52} />
        <div className="about-hero-text">
          <h2>HandBrake Queue</h2>
          <div className="muted small">
            Version <strong>{app?.version ?? '…'}</strong>
            {app?.date && <> · released {released(app.date)}</>}
            {' · '}by {about?.author ?? 'Gerry Dassi (DGSoft)'}
          </div>
          <p>{SUMMARY}</p>
          {about && (
            <div className="about-links">
              <External href={about.releaseNotesUrl}>Release notes for v{app?.version}</External>
              <External href={about.releasesUrl}>All releases</External>
              <External href={about.repositoryUrl}>Source code</External>
            </div>
          )}
        </div>
      </section>

      <Card title="Release notes">
        {!releases.length ? (
          <p className="set-hint">{about ? 'No release notes found.' : 'Loading…'}</p>
        ) : (
          <div className="release-list">
            {releases.map((r, i) => (
              <details key={r.version} className="release" open={i === 0 || r === current || r === firstWithNotes}>
                <summary>
                  <strong>v{r.version}</strong>
                  {r.date && <span className="muted small"> · {released(r.date)}</span>}
                  {r === current && <span className="badge done">this version</span>}
                </summary>
                {r.notes.length ? (
                  <ul>{r.notes.map((n, j) => <li key={j}>{n.replace(/^(feat|fix|chore|docs|refactor|perf|style|test)(\([^)]*\))?:\s*/i, '')}</li>)}</ul>
                ) : (
                  <p className="set-hint">Version number only, no notes.</p>
                )}
              </details>
            ))}
          </div>
        )}
      </Card>

      <Card title="Credits">
        <p>
          Developed by {about?.author ?? 'Gerry Dassi (DGSoft)'} with{' '}
          <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Claude Code</a>, Anthropic's AI coding
          assistant, which contributed to the code, tests and documentation.
        </p>
        <p className="set-hint">HandBrake Queue is built on these projects. Thank you to their authors.</p>
        <ul className="credits">
          {content.credits.map((c) => (
            <li key={c.name}>
              <span>
                <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a>
                <span className="muted">: {c.what}</span>
              </span>
              <span className="badge license">{c.license}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Licence">
        <p>
          HandBrake Queue is free software under the <strong>GNU General Public License, version 2</strong> (GPL-2.0-only).
          HandBrakeCLI, FFmpeg and MKVToolNix are separate programs with their own licences (GPL/LGPL); the app runs them,
          it does not include their code.
        </p>
        {about?.licenseText && (
          <details className="set-details">
            <summary>Read the GNU GPL, version 2</summary>
            <pre className="code-block license-text">{about.licenseText}</pre>
          </details>
        )}
      </Card>

      <Card title="This installation">
        <dl className="versions">
          <VersionRow label="HandBrake Queue" v={app} repo={about?.repositoryUrl} />
          <VersionRow label="Server" v={about?.versions?.server} repo={about?.repositoryUrl} />
          <VersionRow label="Web UI" v={WEB_VERSION} repo={about?.repositoryUrl} />
          <dt>HandBrakeCLI</dt>
          <dd>{hb?.error ? <span className="text-bad">{hb.error}</span> : hb?.version ?? '…'}</dd>
          <dt>Node.js</dt>
          <dd>{about ? `${about.runtime.node} on ${about.runtime.os}${about.runtime.docker ? ' · in Docker' : ''}` : '…'}</dd>
          <dt>Data folder</dt>
          <dd className="mono">{about?.runtime.dataDir ?? '…'}</dd>
          <dt>Server clock</dt>
          <dd>{info?.time ? `${info.time.zone} (UTC${info.time.offset >= 0 ? '+' : '−'}${Math.abs(info.time.offset / 60)})` : '…'}</dd>
        </dl>
        {hb?.encoders?.length > 0 && (
          <>
            <span className="set-label">Video encoders in this HandBrakeCLI</span>
            <div className="chip-list">{hb.encoders.map((e) => <code key={e} className="chip">{e}</code>)}</div>
          </>
        )}
      </Card>

      <p className="set-hint about-copy">© {year} {about?.author ?? 'Gerry Dassi (DGSoft)'}. Released under the GNU GPL, version 2.</p>
    </>
  );
}
