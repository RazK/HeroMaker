import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const bundled = (mode: string) => mode === 'single' || mode === 'artifact'

export default defineConfig(({ mode }) => ({
  base: './',
  // vite-plugin-singlefile forces assetsInlineLimit to infinity, which is
  // exactly wrong for 'artifact': there the packer wants the engine as one
  // script but the avatars as separate files it can stream in behind it.
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    rollupOptions: bundled(mode)
      // Classic script, not a module: it boots mid-parse so the game is
      // playable before the payload behind it has finished downloading.
      ? { output: { format: 'iife', inlineDynamicImports: true } }
      : { input: { main: 'index.html', moveslab: 'moveslab.html', dancer: 'dancer.html',
                    posecheck: 'posecheck.html', animlab: 'animlab.html',
                    posegate: 'posegate.html', reel: 'reel.html' } },
    target: 'es2020',
    // The packer needs the stylesheet as its own file so it can put it ahead of
    // the engine; an iife build otherwise folds CSS into the script, and the
    // boot screen would sit unstyled until two megabytes had parsed.
    cssCodeSplit: mode !== 'artifact',
    // 'artifact' keeps the thumbnails inline but leaves the VRMs out of the
    // engine script: tools/pack-artifact appends them as their own blocks so
    // the game paints and starts before the last hero has downloaded.
    assetsInlineLimit: mode === 'artifact' ? 200000 : mode === 'single' ? 100000000 : 4096,
    chunkSizeWarningLimit: 6000,
  },
  server: { host: '127.0.0.1', port: 5182 },
  preview: { host: '127.0.0.1', port: 5183 },
}))
