import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls to the live backend (avoids CORS entirely)
    proxy: {
      '/auth': {
        target: 'https://dl.memoryai.club',
        changeOrigin: true,
      },
      '/api': {
        target: 'https://dl.memoryai.club',
        changeOrigin: true,
      },
    },
  },
});
