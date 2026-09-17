import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  // the support sheet prefills bug reports with the version
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // a waiting build is announced, never swapped in mid-clip (see src/lib/pwa.ts)
      registerType: 'prompt',
      manifest: {
        name: 'Hypeline',
        short_name: 'Hypeline',
        description: 'Twitch clipping that listens to chat.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Never cache API calls; only the app shell.
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The 31 MB ffmpeg core is fetched on first export and cached at runtime, not precached.
        globIgnores: ['ffmpeg/**', 'fonts/*-{cyrillic,cyrillic-ext,greek,vietnamese}.woff2'],
        runtimeCaching: [
          {
            urlPattern: /\/fonts\/.*\.woff2$/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts' },
          },
          {
            urlPattern: /\/ffmpeg\/ffmpeg-core\.(js|wasm)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'ffmpeg-core' },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  // ffmpeg.wasm spawns its worker with `new Worker(new URL('./worker.js', import.meta.url))`;
  // pre-bundling breaks that path in dev.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
});
