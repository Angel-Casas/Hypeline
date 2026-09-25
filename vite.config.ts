import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};
/**
 * The app icons carry a content hash in their name so that changing the mark changes the
 * **manifest** — which is the only thing an already-installed PWA re-checks (see
 * `scripts/render-icons.mjs`). Written by `npm run icons`; never edit by hand.
 */
const icons = JSON.parse(
  readFileSync(new URL('./scripts/icons.generated.json', import.meta.url), 'utf8'),
) as Record<'favicon' | 'icon192' | 'icon512' | 'apple' | 'maskable' | 'og' | 'ogAbsolute', string>;

export default defineConfig({
  // the support sheet prefills bug reports with the version
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    // the icon <link>s carry the same hashes as the manifest, from the same one file
    {
      name: 'hypeline-icon-links',
      transformIndexHtml: (html: string) =>
        html
          .replace(
            '<!--icons-->',
            [
              `<link rel="icon" href="/${icons.favicon}" type="image/svg+xml" />`,
              `<link rel="icon" href="/${icons.icon192}" type="image/png" sizes="192x192" />`,
              `<link rel="apple-touch-icon" href="/${icons.apple}" />`,
            ].join('\n    '),
          )
          // an unfurler has no page to resolve a relative path against: these must be absolute
          .replace(
            '<!--social-->',
            [
              `<meta property="og:image" content="${icons.ogAbsolute}" />`,
              `<meta name="twitter:image" content="${icons.ogAbsolute}" />`,
            ].join('\n    '),
          ),
    },
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
        // the installed app opens on the desk, not the landing page: someone who has
        // installed it has already read the pitch (Angel, 2026-09-25). `src/app/router.ts`
        // covers installs that still carry the old start_url.
        start_url: '/dashboard',
        icons: [
          { src: icons.icon192, sizes: '192x192', type: 'image/png' },
          { src: icons.icon512, sizes: '512x512', type: 'image/png' },
          { src: icons.maskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
