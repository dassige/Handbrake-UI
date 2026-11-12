import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveRestore, Bell, CalendarClock, Captions, Cpu, FolderOpen, FolderSearch, FolderTree, Gauge, Info, Languages, ListPlus, ShieldCheck, Wand2,
} from 'lucide-react';
import { api } from '../api.js';
import { t } from '../i18n/index.js';
import {
  AddingSection, EncodingSection, FoldersSection, OutputSection, QualitySection, RenamingSection,
} from './GeneralSections.jsx';
import { ScheduleSection } from './ScheduleSection.jsx';
import { WatchSection } from './WatchSection.jsx';
import { NotificationsSection } from './NotificationsSection.jsx';
import { BackupSection } from './BackupSection.jsx';
import { AboutSection } from './AboutSection.jsx';
import { LanguageSection } from './LanguageSection.jsx';
import { SubtitlesSection } from './SubtitlesSection.jsx';
import { SecuritySection } from './SecuritySection.jsx';

// keys: the settings a section edits (for its "unsaved" dot and for saving only what changed).
// Labels are translated when rendering: settings.nav.<id> and settings.nav.group.<group>.
export const SECTIONS = [
  {
    group: 'general',
    items: [
      { id: 'folders', icon: FolderOpen, keys: ['sourceRoots', 'sourceNames', 'protectedRoots', 'targetRoot'], Component: FoldersSection },
      { id: 'adding', icon: ListPlus, keys: ['recursive', 'skipConverted', 'videoExtensions', 'excludePatterns'], Component: AddingSection },
      { id: 'output', icon: FolderTree, keys: ['outputLayout'], Component: OutputSection },
      { id: 'language', icon: Languages, keys: ['language'], Component: LanguageSection },
    ],
  },
  {
    group: 'converting',
    items: [
      { id: 'encoding', icon: Cpu, keys: ['niceLevel', 'verifyMode'], Component: EncodingSection },
      { id: 'subtitles', icon: Captions, keys: ['subtitleEmbed', 'subtitleCopy', 'subtitleExtensions', 'subtitleCodeset'], Component: SubtitlesSection },
      { id: 'schedule', icon: CalendarClock, keys: ['schedule'], Component: ScheduleSection },
      { id: 'watch', icon: FolderSearch, keys: ['watch'], Component: WatchSection },
      { id: 'notifications', icon: Bell, keys: ['notifications'], Component: NotificationsSection },
    ],
  },
  {
    group: 'tools',
    items: [
      { id: 'quality', icon: Gauge, keys: ['quality'], Component: QualitySection },
      { id: 'renaming', icon: Wand2, keys: ['autoRename', 'autoRenameRuleId', 'renameSeparator'], Component: RenamingSection },
    ],
  },
  {
    group: 'system',
    items: [
      // Saved at once, not through this form (server/src/auth.js).
      { id: 'security', icon: ShieldCheck, keys: [], Component: SecuritySection },
      { id: 'backup', icon: ArchiveRestore, keys: ['backupSchedule'], Component: BackupSection },
      { id: 'about', icon: Info, keys: [] },
    ],
  },
];
const sectionLabel = (id) => t(`settings.nav.${id}`);
const ALL = SECTIONS.flatMap((g) => g.items);
const EDITABLE = ALL.flatMap((s) => s.keys);
export const SECTION_IDS = ALL.map((s) => s.id);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Tidies the draft for the server: blank rows dropped, paths trimmed, the browser-only password flag removed. */
function clean(key, value) {
  switch (key) {
    case 'sourceRoots':
    case 'protectedRoots':
      return value.map((p) => p.trim()).filter(Boolean);
    case 'targetRoot':
      return value.trim();
    case 'sourceNames':
      return Object.fromEntries(Object.entries(value ?? {}).map(([k, v]) => [k.trim(), v.trim()]).filter(([k, v]) => k && v));
    case 'watch':
      return { ...value, folders: value.folders.filter((f) => f.path.trim()).map((f) => ({ ...f, path: f.path.trim() })) };
    case 'notifications': {
      const { hasPassword, ...email } = value.email;
      return { ...value, email };
    }
    default:
      return value;
  }
}

/**
 * Settings as a page: sections on the left, one at a time on the right. Every section
 * edits the same draft; the bar at the bottom saves (only what changed) or discards it.
 */
export function SettingsPage({
  settings, info, presets, renameRules, watchStatus, backupStatus, section, onSection, run, onSaved, onError, onNotice, onDirtyChange, auth, onAuthChange,
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const changedKeys = useMemo(() => EDITABLE.filter((k) => !same(draft[k], settings[k])), [draft, settings]);
  const dirty = changedKeys.length > 0;

  // Follow changes saved elsewhere (another browser, a restore), keeping the settings edited here.
  // Edited = different from the settings before this update (comparing with the new ones would
  // make every key changed elsewhere look edited, and show a false "unsaved changes" bar).
  const prevSettings = useRef(settings);
  useEffect(() => {
    const prev = prevSettings.current;
    prevSettings.current = settings;
    setDraft((d) => {
      const edited = EDITABLE.filter((k) => !same(d[k], prev[k]));
      return { ...settings, ...Object.fromEntries(edited.map((k) => [k, d[k]])) };
    });
  }, [settings]);
  // Braces: an effect may only return a cleanup function (returning the boolean crashed on leaving the page).
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = (key, value) => setDraft((d) => ({ ...d, [key]: typeof value === 'function' ? value(d[key]) : value }));
  const current = ALL.find((s) => s.id === section) ?? ALL[0];

  // On a phone the section list is a horizontal strip: keep the chosen one in view.
  const navRef = useRef(null);
  useEffect(() => {
    navRef.current?.querySelector('.page-nav-item.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [current.id]);

  async function save(e) {
    e?.preventDefault();
    setSaving(true);
    const patch = Object.fromEntries(changedKeys.map((k) => [k, clean(k, draft[k])]));
    const r = await run(() => api.saveSettings(patch), t('settings.saved'));
    setSaving(false);
    if (r) {
      onSaved(r);
      setDraft(r);
    }
  }

  const props = { draft, set, base: settings, info, presets, renameRules, run, onError, onNotice, liveStatus: watchStatus, backupStatus, dirty, auth, onAuthChange };
  const Body = current.Component;

  return (
    <main className="page settings-page">
      <nav ref={navRef} className="page-nav" aria-label={t('settings.sections')}>
        <h2 className="page-nav-title">{t('settings.title')}</h2>
        {SECTIONS.map((g) => (
          <div key={g.group} className="page-nav-group">
            <span className="page-nav-label">{t(`settings.nav.group.${g.group}`)}</span>
            {g.items.map((s) => {
              const Icon = s.icon;
              const unsaved = s.keys.some((k) => changedKeys.includes(k));
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`page-nav-item ${s.id === current.id ? 'active' : ''}`}
                  aria-current={s.id === current.id ? 'page' : undefined}
                  onClick={() => onSection(s.id)}
                >
                  <Icon size={16} />
                  <span>{sectionLabel(s.id)}</span>
                  {unsaved && <span className="unsaved-dot" title={t('common.unsavedChanges')} />}
                  {s.id === 'schedule' && settings.schedule.enabled && !unsaved && <span className="nav-on">{t('settings.navOn')}</span>}
                  {s.id === 'watch' && settings.watch.enabled && !unsaved && <span className="nav-on">{t('settings.navOn')}</span>}
                  {s.id === 'security' && auth?.enabled && <span className="nav-on">{t('settings.navOn')}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <form className="page-body" onSubmit={save}>
        <div className="page-content">
          <header className="page-head">
            <h1>{sectionLabel(current.id)}</h1>
          </header>
          {Body && <Body {...props} />}
          {current.id === 'about' && <AboutSection info={info} onError={onError} />}
        </div>
        {dirty && (
          <div className="save-bar" role="region" aria-label={t('common.unsavedChanges')}>
            <span>
              {t('settings.unsavedIn')}{' '}
              {ALL.filter((s) => s.keys.some((k) => changedKeys.includes(k))).map((s, i, list) => (
                <span key={s.id}>
                  <button type="button" className="link" onClick={() => onSection(s.id)}>{sectionLabel(s.id)}</button>
                  {i < list.length - 1 ? ', ' : ''}
                </span>
              ))}
            </span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setDraft(settings)} disabled={saving}>{t('common.discard')}</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? t('common.saving') : t('common.saveChanges')}</button>
          </div>
        )}
      </form>
    </main>
  );
}
