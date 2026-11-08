import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs separately (npm run dev in server/).
const api = process.env.API_URL || 'http://127.0.0.1:8095';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: api, changeOrigin: true } },
  },
});
