import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api-sc': {
        target: 'https://api-v2.soundcloud.com',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        rewrite: (path) => path.replace(/^\/api-sc/, '')
      }
    }
  },
  preview: {
    port: 4173,
    host: true,
    proxy: {
      '/api-sc': {
        target: 'https://api-v2.soundcloud.com',
        changeOrigin: true,
        secure: false,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        rewrite: (path) => path.replace(/^\/api-sc/, '')
      }
    }
  }
});
