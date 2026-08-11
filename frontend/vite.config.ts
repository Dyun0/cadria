import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', port: 5173,
    proxy: { '/api': 'http://localhost:3001', '/uploads': 'http://localhost:3001', '/outputs': 'http://localhost:3001' },
  },
  build: { outDir: 'dist' },
  test: { exclude: ['e2e/**', 'node_modules/**'] },
});
