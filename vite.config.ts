/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // For hosts that serve from a sub-path (e.g. GitHub Pages project sites),
  // set BASE_PATH=/repo-name/ at build time. Defaults to the domain root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Sift',
        short_name: 'Sift',
        description: 'Format, minify, obfuscate and validate SQL, JSON and JavaScript - locally, offline.',
        theme_color: '#0c0c10',
        background_color: '#0c0c10',
        display: 'standalone',
        icons: [{ src: 'sift-logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
  worker: { format: 'es' },
  server: { port: 5180, strictPort: true },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
