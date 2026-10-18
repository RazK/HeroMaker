import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Runs tools/mirror.test.ts in Node. The game's pose code is plain TypeScript
 * with no DOM, so esbuild (already here through Vite) bundles it and Node runs
 * it — no browser, no camera, a second or two.
 */
const dir = mkdtempSync(path.join(tmpdir(), 'mirrortest-'))
const out = path.join(dir, 'mirror.test.mjs')
try {
  await build({
    entryPoints: [new URL('./mirror.test.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning',
    define: { __GAME_ROOT__: JSON.stringify(path.resolve(new URL('..', import.meta.url).pathname)) },
  })
  await import(pathToFileURL(out).href)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
