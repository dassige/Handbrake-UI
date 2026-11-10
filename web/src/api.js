async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || `${res.status} ${res.statusText}`);
  return data;
}

const get = (url) => request('GET', url);
const post = (url, body = {}) => request('POST', url, body);

export const api = {
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

  jobs: () => get('/api/jobs'),
  addJobs: (paths, presetId, position) => post('/api/jobs', { paths, presetId, position }),
  updateJob: (id, patch) => request('PATCH', `/api/jobs/${id}`, patch),
  jobLog: (id) => get(`/api/jobs/${id}/log`),
  jobAction: (id, action, body) => post(`/api/jobs/${id}/${action}`, body),
  reorder: (ids) => post('/api/jobs/reorder', { ids }),
  removeJobs: (ids) => post('/api/jobs/remove', { ids }),
  clearJobs: (statuses) => post('/api/jobs/clear', { statuses }),
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
  prepareZip: (paths, name) => post('/api/download/zip', { paths, name }),
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
    if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
    return data;
  },
  restoreBackup: (source, scope) => post('/api/backup/restore', { source, scope }),

  stats: (days) => get(`/api/stats?days=${days}`),
  watchStatus: () => get('/api/watch'),
  watchScan: () => post('/api/watch/scan'),
  recentNotifications: () => get('/api/notifications/recent'),
  testNotification: (channel, notifications) => post('/api/notifications/test', { channel, notifications }),

  qualityScans: () => get('/api/quality/scans'),
  qualityScan: (id) => get(`/api/quality/scans/${id}`),
  startQualityScan: (paths) => post('/api/quality/scans', { paths }),
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
      else {
        const err = new Error(data?.error || `${xhr.status} ${xhr.statusText}`);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(Object.assign(new Error('Network error'), { network: true }));
    xhr.onabort = () => reject(Object.assign(new Error('Cancelled'), { aborted: true }));
    xhr.send(blob);
  });
  return { promise, abort: () => xhr.abort() };
}
