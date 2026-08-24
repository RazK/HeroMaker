import fs from 'node:fs'
import path from 'node:path'

/**
 * Turns the single-file build into an Artifact-ready page that streams.
 *
 * The host supplies its own <!doctype>/<html>/<head>/<body>, so this emits just
 * page content — and, more importantly, orders that content so the page is
 * useful long before it has finished downloading:
 *
 *   1. styles, then the boot splash          → paints in the first few KB
 *   2. the app root
 *   3. the engine as a *classic* script      → runs mid-parse, ~1 MB in
 *   4. one block per avatar, each followed by a progress marker
 *
 * A module script would be deferred until the whole ~8 MB document had parsed.
 * As a classic script the engine boots at step 3 and starts playing as soon as
 * the first hero's block arrives, with the rest streaming in behind it.
 */
const src = process.argv[2] ?? 'dist/index.html'
const out = process.argv[3] ?? 'dist/hero-dash.artifact.html'
const avatarDir = process.argv[4] ?? 'public/avatars'

const html = fs.readFileSync(src, 'utf8')

const cut = (open, close) => {
  const a = html.indexOf(open)
  if (a < 0) throw new Error(`missing ${open}`)
  const b = html.indexOf(close, a)
  if (b < 0) throw new Error(`unterminated ${open}`)
  return html.slice(a + open.length, b)
}
const head = cut('<head>', '</head>')
const body = cut('<body>', '</body>')

/** Pull one whole element (with its content) out of a chunk of markup. */
function take(markup, startPattern, endTag) {
  const m = markup.match(startPattern)
  if (!m) throw new Error(`missing ${startPattern}`)
  const start = m.index
  const end = markup.indexOf(endTag, start)
  if (end < 0) throw new Error(`unterminated ${startPattern}`)
  const element = markup.slice(start, end + endTag.length)
  return [element, markup.slice(0, start) + markup.slice(end + endTag.length)]
}

// The engine, rewritten from a deferred module to a classic script.
let [engine] = take(head, /<script type="module"[^>]*>/, '</script>')
engine = engine.replace(/<script type="module"[^>]*>/, '<script>')

// vite-plugin-singlefile emits <style rel="stylesheet" crossorigin>, not a bare
// <style> — matching only the latter silently ships an unstyled page.
const styles = head.match(/<style[^>]*>[\s\S]*?<\/style>/g)?.join('\n') ?? ''
if (!styles.includes('splash-card')) {
  throw new Error('stylesheet missing or does not contain the splash rules — the boot screen would render unstyled')
}
const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>Hero Dash</title>'
const fonts = head.match(/<link[^>]*fonts\.[^>]*>/g)?.join('\n') ?? ''
const icon = head.match(/<link[^>]*rel="icon"[^>]*>/)?.[0] ?? ''
const board = head.match(/<script id="shared-hall-of-fame"[\s\S]*?<\/script>/)?.[0] ?? ''

// Splash markup + its inline script, and the app root, in document order.
const [splash, bodyRest] = take(body, /<div id="splash"/, '</div>\n</div>')
const splashScript = bodyRest.match(/<script>\n\(function \(\)[\s\S]*?<\/script>/)?.[0] ?? ''
if (!splashScript) throw new Error('missing splash bootstrap script')
const appRoot = '<div id="app"></div>'

// One block per avatar, in roster order so the first hero arrives first.
const ROSTER_ORDER = ['Crayon_Kid', 'Yummy_Bear', 'Superstar', 'Gingerella', 'Skelly', 'Cloudy']
const NAMES = {
  Crayon_Kid: 'Crayon Kid', Yummy_Bear: 'Yummy Bear', Superstar: 'Superstar',
  Gingerella: 'Gingerella', Skelly: 'Skelly', Cloudy: 'Cloudy',
}
const escapeForScript = (s) => s.replace(/<\/script/gi, '<\\/script')

const blocks = ROSTER_ORDER.map((id) => {
  const file = path.join(avatarDir, `${id}.opt.vrm`)
  const base64 = fs.readFileSync(file).toString('base64')
  return (
    `<script type="text/plain" id="hd-avatar-${id}">${escapeForScript(base64)}</script>\n` +
    `<script>__hdAvatar(${JSON.stringify(id)},${JSON.stringify(`${NAMES[id]} is ready`)})</script>`
  )
})

const page = [
  title,
  icon,
  fonts,
  styles,
  board,
  splash,
  splashScript,
  `<script>window.__hdTotal = ${blocks.length + 1}</script>`,
  appRoot,
  engine,
  `<script>__hdStep('Building the Crayon Kingdom…')</script>`,
  ...blocks,
].filter(Boolean).join('\n') + '\n'

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, page)

// Markup checks must ignore script/style bodies: the page legitimately carries
// a '<!doctype html>' string inside its own JS, for republishing itself.
const markup = page.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
const size = Buffer.byteLength(page)

const engineAt = page.indexOf(engine)
const checks = [
  ['no doctype', !/<!doctype/i.test(markup)],
  ['no <html>/<head>/<body>', !/<(html|head|body)[\s>]/i.test(markup)],
  ['title in first 8KB', page.indexOf('<title>') >= 0 && page.indexOf('<title>') < 8192],
  ['splash before engine', page.indexOf('id="splash"') < engineAt],
  ['app root before engine', page.indexOf('id="app"') < engineAt],
  ['engine is a classic script', !/<script type="module"/.test(page)],
  ['every avatar blocked', ROSTER_ORDER.every((id) => page.includes(`id="hd-avatar-${id}"`))],
  ['avatars after engine', ROSTER_ORDER.every((id) => page.indexOf(`id="hd-avatar-${id}"`) > engineAt)],
  ['shared board island', page.includes('id="shared-hall-of-fame"')],
  ['under 16 MB', size < 16 * 1024 * 1024],
  ['stylesheet before splash', page.indexOf('splash-card') < page.indexOf('id="splash"')],
  ['splash styles present', page.includes('#splash')],
]
const external = [...markup.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
const badHosts = external.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u))
checks.push(['only google-fonts externals', badHosts.length === 0])

for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
if (badHosts.length) console.log('     blocked hosts:', badHosts.join(', '))

const toFirstPlay = page.indexOf(`id="hd-avatar-${ROSTER_ORDER[0]}"`) + fs.statSync(path.join(avatarDir, `${ROSTER_ORDER[0]}.opt.vrm`)).size * 1.37
console.log(`\n${out}  ${(size / 1e6).toFixed(2)} MB total`)
console.log(`  splash paints at ~${(page.indexOf(engine) / 1e3).toFixed(0)} KB`)
console.log(`  playable at     ~${(toFirstPlay / 1e6).toFixed(2)} MB`)
if (checks.some(([, ok]) => !ok)) process.exit(1)
