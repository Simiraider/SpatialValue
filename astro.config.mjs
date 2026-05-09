// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
        '@components': new URL('./src/components', import.meta.url).pathname,
        '@layouts': new URL('./src/layouts', import.meta.url).pathname,
        '@utils': new URL('./src/utils', import.meta.url).pathname,
        '@hooks': new URL('./src/hooks', import.meta.url).pathname,
        '@lib': new URL('./src/lib', import.meta.url).pathname,
        '@services': new URL('./src/services', import.meta.url).pathname,
        '@stores': new URL('./src/stores', import.meta.url).pathname,
        '@types': new URL('./src/types', import.meta.url).pathname,
        '@constants': new URL('./src/constants', import.meta.url).pathname,
      },
    },
  },
  integrations: [react()],
});
