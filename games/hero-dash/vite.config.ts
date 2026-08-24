import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    rollupOptions: mode === 'single' ? {} : { input: { main: 'index.html', lab: 'lab.html', thumbs: 'thumbs.html' } },
    target: 'es2020',
    assetsInlineLimit: mode === 'single' ? 100000000 : 4096,
    chunkSizeWarningLimit: 4000,
  },
  server: { host: '127.0.0.1', port: 5180 },
  preview: { host: '127.0.0.1', port: 5181 },
}))
