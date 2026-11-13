import { t } from './i18n/index.js';

/**
 * Fired on window when the sign-in state may have changed (a request answered 401, the
 * server said login settings changed, the event stream was cut): AuthGate checks again.
 */
export const AUTH_EVENT = 'encforge:auth';
export const authChanged = () => window.dispatchEvent(new Event(AUTH_EVENT));

/** An Error with the server's message, plus its status and code (e.g. 'wrongPassword'). */
function apiError(status, statusText, data, url) {
  // A 401 means the session ended (signed out elsewhere, password changed, login turned on).
  if (status === 401 && !url.startsWith('/api/auth/')) authChanged();
  const err = new Error(data?.error || (typeof data === 'string' && data) || `${status} ${statusText}`);
  err.status = status;
  if (data?.code) err.code = data.code;
  return err;
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw apiError(res.status, res.statusText, data, url);
  return data;
}

const get = (url) => request('GET', url);
const post = (url, body = {}) => request('POST', url, body);

export const api = {
  // Login and API keys (server/src/auth.js)
  authStatus: () => get('/api/auth/status'),
  login: (password) => post('/api/auth/login', { password }),
  logout: () => post('/api/auth/logout'),
  setPassword: (current, password) => request('PUT', '/api/auth/password', { current, password }),
  setLoginRequired: (enabled) => request('PUT', '/api/auth/settings', { enabled }),
  authSessions: () => get('/api/auth/sessions'),
  signOutOthers: () => request('DELETE', '/api/auth/sessions'),
  apiKeys: () => get('/api/auth/keys'),
  // scope: read | queue | admin → { key, token }
  createApiKey: (name, scope) => post('/api/auth/keys', { name, scope }),
  deleteApiKey: (id) => request('DELETE', `/api/auth/keys/${id}`),

  info: () => get('/api/info'),
  about: () => get('/api/about'),
  settings: () => get('/api/settings'),
  saveSettings: (s) => request('PUT', '/api/settings', s),
  browse: (root, path) =>
    get(`/api/browse?root=${root}${path ? `&path=${encodeURIComponent(path)}` : ''}`),

  presets: () => get('/api/presets'),
  preset: (id) => get(`/api/presets/${id}`),
  uploadPreset: (fileName, content) => post('/api/presets', { fileName, content }),
  setDefaultPreset: (id) => post(`/api/presets/${id}/default`),
  deletePreset: (id) => request('DELETE', `/api/presets/${id}`),
  presetExportUrl: (id) => `/api/presets/${id}/export`,
  presetOptions: () => get('/api/presets/options'),
  builtinPresets: () => get('/api/presets/builtin'),
  editablePreset: (id) => get(`/api/presets/${id}/editable`),
  // body: { name, category, description, preset | builtin | fromId, version }
  createPreset: (body) => post('/api/presets/new', body),
  // body: { preset, version, name, category, description }
  updatePreset: (id, body) => request('PUT', `/api/presets/${id}`, body),

  jobs: () => get('/api/jobs'),
  // origin 'quality': added from the quality check, to replace the original once converted.
  addJobs: (paths, presetId, position, origin) => post('/api/jobs', { paths, presetId, position, origin }),
  updateJob: (id, patch) => request('PATCH', `/api/jobs/${id}`, patch),
  jobLog: (id) => get(`/api/jobs/${id}/log`),
  jobAction: (id, action, body) => post(`/api/jobs/${id}/${action}`, body),
  reorder: (ids) => post('/api/jobs/reorder', { ids }),
  removeJobs: (ids) => post('/api/jobs/remove', { ids }),
  clearJobs: (statuses) => post('/api/jobs/clear', { statuses }),
  // Sidecar subtitles of a job (see server/src/subtitles/).
  jobSubtitles: (id) => get(`/api/jobs/${id}/subtitles`),
  // patch: { embed?, copy? (null: follow the queue/Settings), files?: [{ path, include?, lang?, forced?, sdh?, edits? }] }
  updateJobSubtitles: (id, patch) => request('PATCH', `/api/jobs/${id}/subtitles`, patch),
  detectJobSubtitles: (id) => post(`/api/jobs/${id}/subtitles/detect`),
  previewJobSubtitle: (id, path, edits) => post(`/api/jobs/${id}/subtitles/preview`, { path, edits }),
  writeJobSubtitles: (id) => post(`/api/jobs/${id}/subtitles/write`),
  // now: start even outside the conversion window
  startQueue: (now = false) => post('/api/queue/start', { now }),
  stopQueue: () => post('/api/queue/stop'),

  merges: () => get('/api/merge'),
  mergeInspect: (body) => post('/api/merge/inspect', body),
  mergeStart: (body) => post('/api/merge', body),
  mergeCancel: (id) => post(`/api/merge/${id}/cancel`),
  mergeRemove: (id) => request('DELETE', `/api/merge/${id}`),

  uploadCheck: (dir, files) => post('/api/upload/check', { dir, files }),
  uploadDiscard: (dir, name, size) => post('/api/upload/discard', { dir, name, size }),
  makeFolder: (parent, name) => post('/api/folders', { parent, name }),
  deletePreview: (paths) => post('/api/files/delete/preview', { paths }),
  deleteFiles: (paths) => post('/api/files/delete', { paths }),

  downloadUrl: (path) => `/api/download?path=${encodeURIComponent(path)}`,
  // The player (server/src/media.js)
  mediaInfo: (path) => get(`/api/media/info?path=${encodeURIComponent(path)}`),
  mediaFileUrl: (path) => `/api/media/file?path=${encodeURIComponent(path)}`,
  mediaStreamUrl: (path, t = 0, audio = 0) => `/api/media/stream?path=${encodeURIComponent(path)}&t=${t}&audio=${audio}`,
  prepareZip: (paths, name, withSubtitles = false) => post('/api/download/zip', { paths, name, withSubtitles }),
  // { files: { video: [subtitle paths] }, count }
  downloadSubtitles: (paths) => post('/api/download/subtitles', { paths }),
  zipUrl: (id) => `/api/download/zip/${id}`,

  backupUrl: (logs) => `/api/backup${logs ? '' : '?logs=0'}`,
  backupSnapshots: () => get('/api/backup/snapshots'),
  saveBackupSnapshot: (logs) => post('/api/backup/snapshots', { logs }),
  backupSnapshotUrl: (name) => `/api/backup/snapshots/${encodeURIComponent(name)}`,
  deleteBackupSnapshot: (name) => request('DELETE', `/api/backup/snapshots/${encodeURIComponent(name)}`),
  inspectBackupSnapshot: (name) => post('/api/backup/inspect', { source: `snapshot:${name}` }),
  inspectBackupFile: async (file) => {
    const res = await fetch('/api/backup/inspect', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw apiError(res.status, res.statusText, data, '/api/backup/inspect');
    return data;
  },
  restoreBackup: (source, scope) => post('/api/backup/restore', { source, scope }),
  backupScheduled: () => get('/api/backup/scheduled'),
  runScheduledBackup: () => post('/api/backup/scheduled/run'),
  scheduledBackupUrl: (name) => `/api/backup/scheduled/${encodeURIComponent(name)}`,
  deleteScheduledBackup: (name) => request('DELETE', `/api/backup/scheduled/${encodeURIComponent(name)}`),
  inspectScheduledBackup: (name) => post('/api/backup/inspect', { source: `scheduled:${name}` }),

  stats: (days) => get(`/api/stats?days=${days}`),
  watchStatus: () => get('/api/watch'),
  watchScan: () => post('/api/watch/scan'),
  recentNotifications: () => get('/api/notifications/recent'),
  testNotification: (channel, notifications) => post('/api/notifications/test', { channel, notifications }),

  qualityScans: () => get('/api/quality/scans'),
  qualityScan: (id) => get(`/api/quality/scans/${id}`),
  startQualityScan: (paths) => post('/api/quality/scans', { paths }),
  recheckQuality: (id, paths) => post(`/api/quality/scans/${id}/recheck`, { paths }),
  cancelQualityScan: (id) => post(`/api/quality/scans/${id}/cancel`),
  removeQualityScan: (id) => request('DELETE', `/api/quality/scans/${id}`),

  renameRules: () => get('/api/rename/rules'),
  createRenameRule: (rule) => post('/api/rename/rules', rule),
  updateRenameRule: (id, rule) => request('PUT', `/api/rename/rules/${id}`, rule),
  deleteRenameRule: (id) => request('DELETE', `/api/rename/rules/${id}`),
  importRenameRule: (fileName, content) => post('/api/rename/rules/import', { fileName, content }),
  exportRenameRuleUrl: (id) => `/api/rename/rules/${id}/export`,
  testRename: (steps, names, showOverride) => post('/api/rename/test', { steps, names, showOverride }),
  previewRename: (body) => post('/api/rename/preview', body),
  namingChecks: () => get('/api/naming/checks'),
  namingCheck: (id) => get(`/api/naming/checks/${id}`),
  runNamingCheck: (paths, ruleId) => post('/api/naming/checks', { paths, ruleId }),
  removeNamingCheck: (id) => request('DELETE', `/api/naming/checks/${id}`),
  cancelNamingCheck: (id) => post(`/api/naming/checks/${id}/cancel`),
  applyRename: (items, ruleName) => post('/api/rename/apply', { items, ruleName }),
  renameHistory: () => get('/api/rename/history'),
  undoRename: (id) => post(`/api/rename/history/${id}/undo`),
};

/** Reads a text file, decoding UTF-16 (Advanced Renamer presets) when it has a BOM. */
export async function readTextFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
}

/**
 * Sends one upload chunk with XMLHttpRequest (fetch cannot report upload progress).
 * Returns { promise, abort }; onProgress gets the bytes of this chunk sent so far.
 */
export function sendChunk({ dir, name, size, offset }, blob, onProgress) {
  const xhr = new XMLHttpRequest();
  const q = new URLSearchParams({ dir, name, size: String(size), offset: String(offset) });
  const promise = new Promise((resolve, reject) => {
    xhr.open('PUT', `/api/upload?${q}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(apiError(xhr.status, xhr.statusText, data, '/api/upload'));
    };
    xhr.onerror = () => reject(Object.assign(new Error(t('misc.api.networkError')), { network: true }));
    xhr.onabort = () => reject(Object.assign(new Error(t('misc.api.cancelled')), { aborted: true }));
    xhr.send(blob);
  });
  return { promise, abort: () => xhr.abort() };
}
