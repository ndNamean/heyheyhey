import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: ['leaflet', 'react-leaflet'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('leaflet') || id.includes('react-leaflet')) {
            return 'leaflet';
          }
        },
      },
    },
  },
});
