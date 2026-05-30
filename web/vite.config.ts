import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 次フェーズで実装。dev 時は /api を server (PORT 4317) にプロキシ。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5317,
    host: true,
    proxy: {
      '/api': 'http://localhost:4317',
    },
  },
});
