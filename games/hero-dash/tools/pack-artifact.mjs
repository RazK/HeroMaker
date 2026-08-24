import fs from 'node:fs'
import path from 'node:path'

/**
 * Turns the single-file build into an Artifact-ready page.
 *
 * The Artifact host supplies its own <!doctype>/<html>/<head>/<body> wrapper,
 * so this strips ours and emits just the page content: head links, the shared
 * board's JSON island, the app root, and the inlined style and script.
 */
const src = process.argv[2] ?? 'dist/index.html'
const out = process.argv[3] ?? 'dist/hero-dash.artifact.html'

const html = fs.readFileSync(src, 'utf8')
const grab = (open, close) => {
  const a = html.indexOf(open)
  if (a < 0) throw new Error(`missing ${open}`)
  const b = html.indexOf(close, a)
  if (b < 0) throw new Error(`unterminated ${open}`)
  return html.slice(a + open.length, b)
}
const head = grab('<head>', '</head>')
const body = grab('<body>', '</body>')

// Drop the charset/viewport meta the host already sets; keep everything else.
const keptHead = head
  .split('\n')
  .filter((line) => !/<meta\s+charset/i.test(line) && !/name="viewport"/i.test(line))
  .join('\n')
  .trim()

const page = `${keptHead}\n${body.trim()}\n`
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, page)

// Markup checks must ignore script/style bodies: the page legitimately carries
// a '<!doctype html>' string inside its own JS, for republishing itself.
const markup = page.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')

const checks = [
  ['no doctype', !/<!doctype/i.test(markup)],
  ['no <html>', !/<html[\s>]/i.test(markup)],
  ['no <head>', !/<head[\s>]/i.test(markup)],
  ['no <body>', !/<body[\s>]/i.test(markup)],
  ['has <title>', /<title>/i.test(page)],
  ['title in first 8KB', page.indexOf('<title>') < 8192],
  ['has app root', page.includes('id="app"')],
  ['has shared board island', page.includes('id="shared-hall-of-fame"')],
  ['under 16 MB', Buffer.byteLength(page) < 16 * 1024 * 1024],
]
const external = [...markup.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
const badHosts = external.filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com/.test(u))
checks.push(['only google-fonts externals', badHosts.length === 0])

for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
if (badHosts.length) console.log('     blocked hosts:', badHosts.join(', '))
console.log(`\n${out}  ${(Buffer.byteLength(page) / 1e6).toFixed(2)} MB`)
if (checks.some(([, ok]) => !ok)) process.exit(1)
