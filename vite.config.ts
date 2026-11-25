import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Su GitHub Pages l'app è servita da /<nome-repo>/
const base = process.env.GITHUB_PAGES ? '/Audiolibro-autodidattica-/' : '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Audiolibro',
        short_name: 'Audiolibro',
        description: 'Carica un libro e ascoltalo con sintesi vocale',
        lang: 'it',
        theme_color: '#151b33',
        background_color: '#151b33',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,mjs,png}'],
        // I file del motore vocale AI (~34 MB) non vengono scaricati da tutti:
        // sono salvati in cache solo la prima volta che si usa la voce AI.
        globIgnores: ['wasm/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/wasm/'),
            handler: 'CacheFirst',
            options: { cacheName: 'voce-ai-motore', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      // Versione di ONNX Runtime che carica i suoi file da public/wasm/ (vedi scripts/copy-wasm.mjs)
      // invece di includerne una seconda copia (15 MB) nella build.
      'onnxruntime-web/wasm': fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs', import.meta.url)),
      'onnxruntime-web/webgpu': fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
  },
});
