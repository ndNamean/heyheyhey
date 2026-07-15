import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  define: {
    'import.meta.env.VITE_INSTANT_APP_ID': JSON.stringify('vitest-test-app-id'),
  },
});
