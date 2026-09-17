import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    // the relay's gates are tested too: locking the app out of its own relay is a
    // deploy-breaking mistake, and it is cheap to catch here (2026-09-17)
    include: ['src/**/*.test.ts', 'shim/*.test.mjs'],
  },
});
