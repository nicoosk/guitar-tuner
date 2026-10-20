import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// App 100 % estática: las afinaciones se guardan en el navegador (src/store.js).
// BASE_PATH permite publicarla en un subdirectorio, p. ej. GitHub Pages (/guitar-tuner/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Afinador de guitarra',
        short_name: 'Afinador',
        description: 'Afinador de guitarra acústica con detección automática de cuerda.',
        lang: 'es',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e1014',
        theme_color: '#0e1014',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
    }),
  ],
});
