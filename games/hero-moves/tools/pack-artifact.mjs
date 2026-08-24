import fs from 'node:fs'
import path from 'node:path'

/**
 * Turns the artifact-mode build into a page that streams.
 *
 * The host supplies its own <!doctype>/<html>/<head>/<body>, so this emits page
 * content only — and, more importantly, orders it so the page is useful long
 * before it has finished downloading:
 *
 *   1. stylesheet, then the boot splash   -> paints in the first ~10 KB
 *   2. the app root
 *   3. the engine as a *classic* script   -> runs mid-parse, not deferred
 *   4. one block per hero, each announcing itself as it lands
 *   5. the pose model, last               -> 6.4 MB nobody needs until start
 *
 * A module script is deferred until the whole document has parsed, which for
 * this page means staring at nothing for thirteen megabytes. As a classic
 * script the engine boots at step 3, and the title screen appears as soon as
 * the first hero lands; the rest of the roster and the tracker arrive behind
 * it, while the player is still choosing.
 *
 * Usage: pack-artifact.mjs [dist] [out.html] [assets/avatars] [--heroes=a,b,c]
 *                          [--standalone]
 *
 * `--standalone` wraps the same payload in a complete document instead of an
 * artifact fragment, for a file somebody downloads and opens directly. That is
 * not a nicety: the artifact viewer's iframe is never granted camera
 * permission, so the published page can be looked at but not played. A local
 * file:// page is a secure context and does get the camera, and it has no size
 * ceiling either, so it carries the whole roster.
 */
const dist = process.argv[2] ?? 'dist'
const out = process.argv[3] ?? 'dist/hero-moves.artifact.html'
const avatarDir = process.argv[4] ?? 'assets/avatars'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}

/**
 * Which heroes to ship. The pose model alone is 6.4 MB and each hero another
 * 1.6 MB once base64'd, against a 16 MB ceiling — so a published page carries a
 * subset, and the roster is built from whichever blocks actually arrive.
 */
const standalone = process.argv.includes('--standalone')
const HEROES = flag('heroes',
  standalone
    ? 'Crayon_Kid,Yummy_Bear,Superstar,Gingerella,Skelly,Cloudy'
    : 'Crayon_Kid,Yummy_Bear,Gingerella').split(',').filter(Boolean)
const LIMIT = standalone ? Infinity : 16 * 1024 * 1024

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const pick = (re, what) => {
  const m = html.match(re)
  if (!m) throw new Error(`missing ${what} in the build`)
  return m
}

const title = pick(/<title>[\s\S]*?<\/title>/, 'title')[0]
const icon = pick(/<link[^>]*rel="icon"[^>]*>/, 'icon')[0]
const fonts = html.match(/<link[^>]*fonts\.[^>]*>/g)?.join('\n') ?? ''
const engineSrc = pick(/<script type="module"[^>]*src="\.\/([^"]+)"/, 'engine script')[1]

// The splash markup and its bootstrap, lifted whole out of the body.
const splash = pick(/<div id="boot"[\s\S]*?<\/div>\n<\/div>/, 'boot splash')[0]
const splashScript = pick(/<script>\n\(function \(\)[\s\S]*?<\/script>/, 'splash bootstrap')[0]

const cssFile = fs.readdirSync(path.join(dist, 'assets')).find((f) => f.endsWith('.css'))
if (!cssFile) throw new Error('no stylesheet emitted — build with --mode artifact')
const css = fs.readFileSync(path.join(dist, 'assets', cssFile), 'utf8')
if (!css.includes('#boot')) throw new Error('stylesheet has no boot rules — the splash would render unstyled')

// A classic script, so it executes as the parser reaches it rather than after
// every hero behind it has downloaded.
const engine = '<script>' +
  fs.readFileSync(path.join(dist, engineSrc), 'utf8').replace(/<\/script/gi, '<\\/script') +
  '</script>'

const model = fs.readFileSync('public/pose-model.json', 'utf8')
const escapeForScript = (s) => s.replace(/<\/script/gi, '<\\/script')

const NAMES = {
  Crayon_Kid: 'Crayon Kid', Yummy_Bear: 'Yummy Bear', Superstar: 'Superstar',
  Gingerella: 'Gingerella', Skelly: 'Skelly', Cloudy: 'Cloudy',
}
const blocks = HEROES.map((id) => {
  const file = path.join(avatarDir, `${id}.opt.vrm`)
  if (!fs.existsSync(file)) throw new Error(`no such hero: ${file}`)
  const base64 = fs.readFileSync(file).toString('base64')
  return (
    `<script type="text/plain" id="hm-avatar-${id}">${base64}</script>\n` +
    `<script>__hmAvatar(${JSON.stringify(id)});__hdStep(${JSON.stringify(`${NAMES[id] ?? id} is ready`)})</script>`
  )
})

const page = [
  title,
  icon,
  fonts,
  `<style>${css}</style>`,
  splash,
  splashScript,
  `<script>window.__hdTotal = ${blocks.length + 2}</script>`,
  '<div id="app"></div>',
  engine,
  `<script>__hdStep('Building the stage…')</script>`,
  ...blocks,
  `<script type="application/json" id="pose-model">${escapeForScript(model)}</script>`,
  `<script>__hmPoseModel();__hdStep('Pose tracker ready')</script>`,
].join('\n') + '\n'

const document_ = standalone
  ? '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,' +
    'maximum-scale=1,user-scalable=no,viewport-fit=cover" />\n' +
    '<meta name="theme-color" content="#241b3d" />\n</head>\n<body>\n' + page + '</body>\n</html>\n'
  : page

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, document_)

// Markup checks must ignore script and style bodies: the engine legitimately
// carries strings like '<body' inside its own minified JS.
const markup = page.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
const size = Buffer.byteLength(document_)
const engineAt = page.indexOf(engine)

const checks = standalone ? [] : [
  ['no doctype', !/<!doctype/i.test(markup)],
  ['no <html>/<head>/<body>', !/<(html|head|body)[\s>]/i.test(markup)],
  ['title early', page.indexOf('<title>') >= 0 && page.indexOf('<title>') < 8192],
  ['stylesheet before splash', page.indexOf('#boot') < page.indexOf('id="boot"')],
  ['splash before engine', page.indexOf('id="boot"') < engineAt],
  ['app root before engine', page.indexOf('id="app"') < engineAt],
  ['pose model after the heroes', page.indexOf('id="pose-model"') >
    Math.max(...HEROES.map((id) => page.indexOf(`id="hm-avatar-${id}"`)))],
  ['engine is a classic script', !/<script type="module"/.test(page)],
  ['every hero blocked', HEROES.every((id) => page.includes(`id="hm-avatar-${id}"`))],
  ['heroes after engine', HEROES.every((id) => page.indexOf(`id="hm-avatar-${id}"`) > engineAt)],
  [`under ${(LIMIT / 1e6).toFixed(0)} MB`, size < LIMIT],
]
const external = [...markup.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
const badHosts = external.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u))
checks.push(['only google-fonts externals', badHosts.length === 0])
if (standalone) {
  checks.unshift(
    ['stylesheet before splash', page.indexOf('#boot') < page.indexOf('id="boot"')],
    ['splash before engine', page.indexOf('id="boot"') < engineAt],
    ['engine is a classic script', !/<script type="module"/.test(page)],
    ['every hero blocked', HEROES.every((id) => page.includes(`id="hm-avatar-${id}"`))],
  )
}

for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
if (badHosts.length) console.log('     blocked hosts:', badHosts.join(', '))

const firstHero = page.indexOf(`id="hm-avatar-${HEROES[0]}"`) +
  fs.statSync(path.join(avatarDir, `${HEROES[0]}.opt.vrm`)).size * 1.37
console.log(`\n${out}  ${(size / 1e6).toFixed(2)} MB total, heroes: ${HEROES.join(', ')}`)
console.log(`  splash paints at ~${(page.indexOf('<div id="app">') / 1e3).toFixed(0)} KB`)
console.log(`  first hero at   ~${(firstHero / 1e6).toFixed(2)} MB`)
console.log(`  tracker at      ~${(size / 1e6).toFixed(2)} MB`)
if (checks.some(([, ok]) => !ok)) process.exit(1)
