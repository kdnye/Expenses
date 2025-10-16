import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'FSI Expense Report Builder',
        short_name: 'FSI Expenses',
        description:
          'Collect expenses, validate company policy, and prepare the month-end packet — even offline.',
        start_url: '.',
        display: 'standalone',
        background_color: '#0b1120',
        theme_color: '#0f172a',
        icons: [
          {
            src: 'fsi-logo.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'fsi-logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      includeAssets: ['fsi-logo.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});
