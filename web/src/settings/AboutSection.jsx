import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { api } from '../api.js';
import { intlLocale, rich, t } from '../i18n/index.js';
import { Card } from './fields.jsx';
import content from './credits.json';

/* global __WEB_VERSION__ */
const WEB_VERSION = typeof __WEB_VERSION__ === 'undefined' ? {} : __WEB_VERSION__;
const AUTHOR = 'Gerry Dassi (DGSoft)';

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
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
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
  const author = about?.author ?? AUTHOR;

  return (
    <>
      <section className="set-card about-hero">
        <img src="/favicon.svg" alt="" width={52} height={52} />
        <div className="about-hero-text">
          <h2>HandBrake Queue</h2>
          <div className="muted small">
            {rich('settings.about.version', { version: app?.version ?? '…' })}
            {app?.date && <> · {t('settings.about.released', { date: released(app.date) })}</>}
            {' · '}{t('settings.about.by', { author })}
          </div>
          <p>{t('settings.about.summary')}</p>
          {about && (
            <div className="about-links">
              <External href={about.releaseNotesUrl}>{t('settings.about.releaseNotesFor', { version: app?.version })}</External>
              <External href={about.releasesUrl}>{t('settings.about.allReleases')}</External>
              <External href={about.repositoryUrl}>{t('settings.about.sourceCode')}</External>
            </div>
          )}
        </div>
      </section>

      <Card title={t('settings.about.releaseNotes')}>
        {!releases.length ? (
          <p className="set-hint">{about ? t('settings.about.noReleaseNotes') : t('common.loading')}</p>
        ) : (
          <div className="release-list">
            {releases.map((r, i) => (
              <details key={r.version} className="release" open={i === 0 || r === current || r === firstWithNotes}>
                <summary>
                  <strong>v{r.version}</strong>
                  {r.date && <span className="muted small"> · {released(r.date)}</span>}
                  {r === current && <span className="badge done">{t('settings.about.thisVersion')}</span>}
                </summary>
                {r.notes.length ? (
                  <ul>{r.notes.map((n, j) => <li key={j}>{n.replace(/^(feat|fix|chore|docs|refactor|perf|style|test)(\([^)]*\))?:\s*/i, '')}</li>)}</ul>
                ) : (
                  <p className="set-hint">{t('settings.about.versionOnly')}</p>
                )}
              </details>
            ))}
          </div>
        )}
      </Card>

      <Card title={t('settings.about.credits')}>
        <p>
          {rich('settings.about.developedBy', {
            author,
            claudeCode: <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Claude Code</a>,
          })}
        </p>
        <p className="set-hint">{t('settings.about.builtOn')}</p>
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

      <Card title={t('settings.about.licence')}>
        <p>{rich('settings.about.licenceText')}</p>
        {about?.licenseText && (
          <details className="set-details">
            <summary>{t('settings.about.readGpl')}</summary>
            <pre className="code-block license-text">{about.licenseText}</pre>
          </details>
        )}
      </Card>

      <Card title={t('settings.about.installation')}>
        <dl className="versions">
          <VersionRow label="HandBrake Queue" v={app} repo={about?.repositoryUrl} />
          <VersionRow label={t('settings.about.server')} v={about?.versions?.server} repo={about?.repositoryUrl} />
          <VersionRow label={t('settings.about.webUi')} v={WEB_VERSION} repo={about?.repositoryUrl} />
          <dt>HandBrakeCLI</dt>
          <dd>{hb?.error ? <span className="text-bad">{hb.error}</span> : hb?.version ?? '…'}</dd>
          <dt>Node.js</dt>
          <dd>
            {about
              ? about.runtime.docker
                ? t('settings.about.runtimeDocker', { node: about.runtime.node, os: about.runtime.os })
                : t('settings.about.runtime', { node: about.runtime.node, os: about.runtime.os })
              : '…'}
          </dd>
          <dt>{t('settings.about.dataFolder')}</dt>
          <dd className="mono">{about?.runtime.dataDir ?? '…'}</dd>
          <dt>{t('settings.about.serverClock')}</dt>
          <dd>{info?.time ? `${info.time.zone} (UTC${info.time.offset >= 0 ? '+' : '−'}${Math.abs(info.time.offset / 60)})` : '…'}</dd>
        </dl>
        {hb?.encoders?.length > 0 && (
          <>
            <span className="set-label">{t('settings.about.encoders')}</span>
            <div className="chip-list">{hb.encoders.map((e) => <code key={e} className="chip">{e}</code>)}</div>
          </>
        )}
      </Card>

      <p className="set-hint about-copy">{t('settings.about.copyright', { year, author })}</p>
    </>
  );
}
