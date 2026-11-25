import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Su GitHub Pages l'app è servita da /<nome-repo>/
const base = process.env.GITHUB_PAGES ? '/Audiolibro-autodidattica-/' : '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Audiolibro',
        short_name: 'Audiolibro',
        description: 'Carica un libro e ascoltalo con sintesi vocale',
        lang: 'it',
        theme_color: '#1f2a44',
        background_color: '#1f2a44',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,mjs}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'happy-dom',
  },
});
