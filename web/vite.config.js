import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web UI's own version, built into the bundle (shown in Settings → About).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const webVersion = { version: pkg.version ?? null, date: pkg.versionDate ?? null, commit: pkg['git-parentCommit-ID'] ?? null };

// In development the API runs separately (npm run dev in server/).
const api = process.env.API_URL || 'http://127.0.0.1:8095';

export default defineConfig({
  plugins: [react()],
  define: { __WEB_VERSION__: JSON.stringify(webVersion) },
  server: {
    port: 5173,
    proxy: { '/api': { target: api, changeOrigin: true } },
  },
});
