/**
 * Builds `hero-card-engine.js` out of the game's own animation code.
 *
 * The live card on every concept plays real mocap on a real pipeline VRM. That
 * is already solved once, in `games/hero-moves/src/`:
 *
 *   src/avatar/loader.ts  loads a VRM, rotates VRM 0.0 to face +Z, grounds it
 *   src/anim/clips.ts     loads `.vrma` natively, retargets CC0 glTF mocap
 *   src/anim/retarget.ts  the rotation-only, proportion-blind transform
 *
 * so the mockups compile that source rather than owning a second copy of it.
 * esbuild only strips the types and bundles the four modules together; three
 * and @pixiv/three-vrm stay external and are resolved by the import map in
 * each concept page, straight from the CDN.
 *
 *   node marketing/concepts/build-engine.mjs
 *
 * Re-run it whenever `games/hero-moves/src/anim/` changes. The output is
 * committed so the concepts open with nothing installed.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const GAME = resolve(HERE, '../../games/hero-moves')

const require = createRequire(join(GAME, 'package.json'))
let esbuild
try {
  esbuild = require('esbuild')
} catch {
  console.error('esbuild not found. Run `npm install` in games/hero-moves first.')
  process.exit(1)
}

const ENTRY = `
export { loadHero } from './src/avatar/loader'
export { loadVrma, loadRetargeted } from './src/anim/clips'
export { UE_RIG, MIXAMO_RIG } from './src/anim/retarget'
`

const BANNER = `/* GENERATED — do not edit.
 * Built from games/hero-moves/src/{avatar/loader,anim/clips,anim/retarget}.ts
 * by marketing/concepts/build-engine.mjs. Re-run that script to refresh it.
 */`

const result = await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: GAME, sourcefile: 'engine.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  // Resolved by the import map in each concept page, from cdn.jsdelivr.net.
  external: ['three', 'three/*', '@pixiv/three-vrm', '@pixiv/three-vrm-animation'],
  banner: { js: BANNER },
  outfile: join(HERE, 'hero-card-engine.js'),
  legalComments: 'none',
  metafile: true,
})

const out = Object.values(result.metafile.outputs)[0]
console.log(`hero-card-engine.js  ${(out.bytes / 1024).toFixed(1)} KB`)
