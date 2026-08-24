import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Cuts the avatar glob out of the bundle for the single-file build.
 *
 * In that build the avatars are delivered as `<script type="text/plain">`
 * blocks injected by tools/pack-artifact.mjs, which is what lets the boot
 * splash report real download progress. Without this the same ~7 MB would also
 * be inlined into the JS. Runs `pre`, before Vite expands import.meta.glob.
 */
function domAvatars(): Plugin {
  return {
    name: 'hd-dom-avatars',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/game/roster.ts')) return null
      const start = code.indexOf('/* @dom-avatars:start */')
      const end = code.indexOf('/* @dom-avatars:end */')
      if (start < 0 || end < 0) {
        this.error('roster.ts is missing the @dom-avatars markers')
      }
      return code.slice(0, start) + '{}' + code.slice(end + '/* @dom-avatars:end */'.length)
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [domAvatars(), viteSingleFile()] : [],
  build: {
    rollupOptions: mode === 'single'
      // iife, not esm: a classic <script> runs the moment the parser reaches
      // it, so the engine boots while the avatar blocks after it are still
      // downloading. A module script is deferred until the whole 8 MB document
      // has parsed, which is the difference between playable at 2 MB and
      // playable at 8 MB on a phone.
      ? { output: { format: 'iife', inlineDynamicImports: true } }
      : { input: { main: 'index.html', lab: 'lab.html', thumbs: 'thumbs.html' } },
    target: 'es2020',
    assetsInlineLimit: mode === 'single' ? 100000000 : 4096,
    chunkSizeWarningLimit: 4000,
  },
  server: { host: '127.0.0.1', port: 5180 },
  preview: { host: '127.0.0.1', port: 5181 },
}))
