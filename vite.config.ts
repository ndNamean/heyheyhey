import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@instantdb/react',
      'leaflet',
      'react-leaflet',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Each vendor in its own chunk prevents Rollup circular-dependency
          // TDZ errors that cause blank pages in production
          'vendor-react':   ['react', 'react-dom'],
          'vendor-instant': ['@instantdb/react'],
        },
      },
    },
  },
});
