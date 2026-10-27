import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  optimizeDeps: { include: ['@team-plan/shared'] },
  server: { proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: true } } },
});
