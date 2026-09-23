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
export * as THREE from 'three'
export { loadHero } from './src/avatar/loader'
export { loadVrma, loadRetargeted } from './src/anim/clips'
export { Performer, CLIPS } from './src/anim/performer'
export { UE_RIG, MIXAMO_RIG } from './src/anim/retarget'
`

const banner = (what) => `/* GENERATED — do not edit.
 * Built from games/hero-moves/src/{avatar/loader,anim/{clips,performer,retarget}}.ts
 * by marketing/concepts/build-engine.mjs. Re-run that script to refresh it.
 * ${what}
 */`

const common = {
  stdin: { contents: ENTRY, resolveDir: GAME, sourcefile: 'engine.ts', loader: 'ts' },
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  legalComments: 'none',
  metafile: true,
}

const builds = [
  // The one the pages ask for first: three and @pixiv/three-vrm stay external
  // and the import map in each concept resolves them from cdn.jsdelivr.net.
  {
    ...common,
    external: ['three', 'three/*', '@pixiv/three-vrm', '@pixiv/three-vrm-animation'],
    banner: { js: banner('three and @pixiv/three-vrm come from the CDN via the page import map.') },
    outfile: join(HERE, 'hero-card-engine.js'),
  },
  // The one it falls back to when the CDN is unreachable — behind a corporate
  // proxy, on a plane, or in CI. Same source, dependencies bundled in, so the
  // mockups animate from a folder with no network at all.
  {
    ...common,
    minify: true,
    banner: { js: banner('three and @pixiv/three-vrm bundled in, for when the CDN is unreachable.') },
    outfile: join(HERE, 'hero-card-engine.bundle.js'),
  },
]

for (const opts of builds) {
  const result = await esbuild.build(opts)
  const [name, out] = Object.entries(result.metafile.outputs)[0]
  console.log(`${name.split('/').pop().padEnd(28)} ${(out.bytes / 1024).toFixed(1)} KB`)
}
