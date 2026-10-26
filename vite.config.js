import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://localhost:${process.env.PORT || 4000}`;
// Build for a sub-path with e.g. `BASE_PATH=/chat npm run build` (must match BASE_PATH in the server .env).
const base = `${(process.env.BASE_PATH || '').replace(/\/+$/, '').replace(/^(?=[^/])/, '/')}/`;

export default defineConfig({
  root: 'client',
  base,
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/socket.io': { target: api, ws: true },
    },
  },
});
