import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    rollupOptions: mode === 'single'
      // Classic script, not a module: it boots mid-parse so the game is
      // playable before the payload behind it has finished downloading.
      ? { output: { format: 'iife', inlineDynamicImports: true } }
      : { input: { main: 'index.html', moveslab: 'moveslab.html', dancer: 'dancer.html',
                    posecheck: 'posecheck.html' } },
    target: 'es2020',
    assetsInlineLimit: mode === 'single' ? 100000000 : 4096,
    chunkSizeWarningLimit: 6000,
  },
  server: { host: '127.0.0.1', port: 5182 },
  preview: { host: '127.0.0.1', port: 5183 },
}))
