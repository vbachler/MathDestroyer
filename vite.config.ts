import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // host: true listens on all network interfaces so other devices on the LAN can play.
  server: { port: 5173, host: true, strictPort: true },
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
