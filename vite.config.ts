import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Graph-Centrality-CAMS-JP/',
  plugins: [react()],
  worker: { format: 'es' },
  server: { fs: { allow: ['.'] } },
});
