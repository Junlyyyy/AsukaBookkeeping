import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时后端跑在 3001，Vite 代理 /api 到后端，避免跨域
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 800,
  },
});
