import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArchiveRestore, Bell, CalendarClock, Cpu, FolderOpen, FolderSearch, FolderTree, Gauge, Info, ListPlus, Wand2,
} from 'lucide-react';
import { api } from '../api.js';
import {
  AddingSection, EncodingSection, FoldersSection, OutputSection, QualitySection, RenamingSection,
} from './GeneralSections.jsx';
import { ScheduleSection } from './ScheduleSection.jsx';
import { WatchSection } from './WatchSection.jsx';
import { NotificationsSection } from './NotificationsSection.jsx';
import { BackupSection } from './BackupSection.jsx';
import { AboutSection } from './AboutSection.jsx';

// keys: the settings a section edits (for its "unsaved" dot and for saving only what changed).
export const SECTIONS = [
  {
    group: 'General',
    items: [
      { id: 'folders', label: 'Folders', icon: FolderOpen, keys: ['sourceRoots', 'sourceNames', 'protectedRoots', 'targetRoot'], Component: FoldersSection },
      { id: 'adding', label: 'Adding files', icon: ListPlus, keys: ['recursive', 'skipConverted', 'videoExtensions', 'excludePatterns'], Component: AddingSection },
      { id: 'output', label: 'Output layout', icon: FolderTree, keys: ['outputLayout'], Component: OutputSection },
    ],
  },
  {
    group: 'Converting',
    items: [
      { id: 'encoding', label: 'Encoding and check', icon: Cpu, keys: ['niceLevel', 'verifyMode'], Component: EncodingSection },
      { id: 'schedule', label: 'Conversion window', icon: CalendarClock, keys: ['schedule'], Component: ScheduleSection },
      { id: 'watch', label: 'Watch folders', icon: FolderSearch, keys: ['watch'], Component: WatchSection },
      { id: 'notifications', label: 'Notifications', icon: Bell, keys: ['notifications'], Component: NotificationsSection },
    ],
  },
  {
    group: 'Tools',
    items: [
      { id: 'quality', label: 'Quality check', icon: Gauge, keys: ['quality'], Component: QualitySection },
      { id: 'renaming', label: 'Renaming', icon: Wand2, keys: ['autoRename', 'autoRenameRuleId', 'renameSeparator'], Component: RenamingSection },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'backup', label: 'Backup and restore', icon: ArchiveRestore, keys: ['backupSchedule'], Component: BackupSection },
      { id: 'about', label: 'About', icon: Info, keys: [] },
    ],
  },
];
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
  settings, info, presets, renameRules, watchStatus, backupStatus, section, onSection, run, onSaved, onError, onNotice, onDirtyChange,
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const changedKeys = useMemo(() => EDITABLE.filter((k) => !same(draft[k], settings[k])), [draft, settings]);
  const dirty = changedKeys.length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Follow changes saved elsewhere (another tab, a restore) unless there are unsaved edits.
  useEffect(() => {
    if (!dirtyRef.current) setDraft(settings);
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
    const r = await run(() => api.saveSettings(patch), 'Settings saved');
    setSaving(false);
    if (r) {
      onSaved(r);
      setDraft(r);
    }
  }

  const props = { draft, set, base: settings, info, presets, renameRules, run, onError, onNotice, liveStatus: watchStatus, backupStatus, dirty };
  const Body = current.Component;

  return (
    <main className="page settings-page">
      <nav ref={navRef} className="page-nav" aria-label="Settings sections">
        <h2 className="page-nav-title">Settings</h2>
        {SECTIONS.map((g) => (
          <div key={g.group} className="page-nav-group">
            <span className="page-nav-label">{g.group}</span>
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
                  <span>{s.label}</span>
                  {unsaved && <span className="unsaved-dot" title="Unsaved changes" />}
                  {s.id === 'schedule' && settings.schedule.enabled && !unsaved && <span className="nav-on">on</span>}
                  {s.id === 'watch' && settings.watch.enabled && !unsaved && <span className="nav-on">on</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <form className="page-body" onSubmit={save}>
        <div className="page-content">
          <header className="page-head">
            <h1>{current.label}</h1>
          </header>
          {Body && <Body {...props} />}
          {current.id === 'about' && <AboutSection info={info} onError={onError} />}
        </div>
        {dirty && (
          <div className="save-bar" role="region" aria-label="Unsaved changes">
            <span>
              Unsaved changes in{' '}
              {ALL.filter((s) => s.keys.some((k) => changedKeys.includes(k))).map((s, i, list) => (
                <span key={s.id}>
                  <button type="button" className="link" onClick={() => onSection(s.id)}>{s.label}</button>
                  {i < list.length - 1 ? ', ' : ''}
                </span>
              ))}
            </span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setDraft(settings)} disabled={saving}>Discard</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        )}
      </form>
    </main>
  );
}
