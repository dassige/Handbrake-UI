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
  settings: () => get('/api/settings'),
  saveSettings: (s) => request('PUT', '/api/settings', s),
  browse: (root, path) =>
    get(`/api/browse?root=${root}${path ? `&path=${encodeURIComponent(path)}` : ''}`),

  presets: () => get('/api/presets'),
  preset: (id) => get(`/api/presets/${id}`),
  uploadPreset: (fileName, content) => post('/api/presets', { fileName, content }),
  setDefaultPreset: (id) => post(`/api/presets/${id}/default`),
  deletePreset: (id) => request('DELETE', `/api/presets/${id}`),

  jobs: () => get('/api/jobs'),
  addJobs: (paths, presetId, position) => post('/api/jobs', { paths, presetId, position }),
  updateJob: (id, patch) => request('PATCH', `/api/jobs/${id}`, patch),
  jobLog: (id) => get(`/api/jobs/${id}/log`),
  jobAction: (id, action, body) => post(`/api/jobs/${id}/${action}`, body),
  reorder: (ids) => post('/api/jobs/reorder', { ids }),
  removeJobs: (ids) => post('/api/jobs/remove', { ids }),
  clearJobs: (statuses) => post('/api/jobs/clear', { statuses }),
  startQueue: () => post('/api/queue/start'),
  stopQueue: () => post('/api/queue/stop'),
};
