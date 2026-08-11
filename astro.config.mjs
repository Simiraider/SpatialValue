// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  adapter: vercel(),

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // model-viewer se pre-empaqueta al arrancar el dev server para evitar
      // "Failed to fetch dynamically imported module" por caché desactualizado.
      include: ['@google/model-viewer/dist/model-viewer-module.min.js'],
    },
  },

  integrations: [react()]
});