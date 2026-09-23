/**
 * Is the gallery chapter really the gallery — and is it still there when the
 * gallery is not?
 *
 * "you see a preview of the actual gallery. literally use the gallery there."
 * So `hero-gallery.js` reads the live public endpoint. That buys a new way to
 * fail: a landing page whose second chapter is empty because a Railway service
 * was restarting. This measures both halves of that.
 *
 *   online    the row ends up marked data-live, holds at least six pairs, and
 *             every image in it came from heromaker.up.railway.app
 *   offline   with the whole API blocked, the row still holds the six pairs
 *             committed in assets/pairs/ — same count, nothing blank, and the
 *             page never waited on the network to show them
 *   instant   in BOTH cases the six committed pairs are on screen at first
 *             paint, before any fetch resolves
 *
 *   node marketing/concepts/gallery-check.mjs
 *   node marketing/concepts/gallery-check.mjs concept-2
 *
 * Exit code is the number of concepts with a failure.
 *
 * HOW THE `online` HALF REACHES THE API. Where the browser has no route out -
 * a CI sandbox, an agent container behind an egress proxy Chromium will not
 * use - the harness relays for it: Node fetches the very same URL the page
 * asked for and hands back the real status, headers and bytes. The page's own
 * code is untouched and unaware; what is being measured is hero-gallery.js
 * against the live API's real answers - both response shapes, `completed`
 * filtering, the swap, the count - not Chromium's transport, which is not the
 * product's risk. When the browser CAN reach the API directly, nothing is
 * relayed and the request goes straight out. If neither route works the
 * `online` half fails honestly rather than quietly passing.
 *
 * The `offline` half never touches the network either way: the whole API is
 * aborted at the browser, which is exactly the failure being tested.
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createReadStream, statSync, readdirSync } from 'node:fs'
import { join, basename, extname, normalize } from 'node:path'

const HOSTS = [
  '/home/user/HeroMaker/games/hero-moves/package.json',
  '/opt/node22/lib/node_modules/playwright/package.json',
]
let chromium
for (const host of HOSTS) {
  try { ({ chromium } = createRequire(host)('playwright')); break } catch {}
}
if (!chromium) { console.error('Could not load playwright'); process.exit(1) }

const DIR = new URL('.', import.meta.url).pathname
const filter = process.argv[2]
const files = readdirSync(DIR).filter(f => f.endsWith('.html'))
  .filter(f => !filter || f.includes(filter)).sort()

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.vrm': 'model/gltf-binary', '.glb': 'model/gltf-binary',
}
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\.]+)/, '')
  const path = join(DIR, rel || 'index.html')
  let stat
  try { stat = statSync(path) } catch { res.writeHead(404).end('not found'); return }
  if (stat.isDirectory()) { res.writeHead(404).end('not found'); return }
  res.writeHead(200, {
    'content-type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size, 'cache-control': 'no-store',
  })
  createReadStream(path).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`
const API = 'heromaker.up.railway.app'
const NEEDED = 6

/** What the row holds right now. */
const read = () => {
  const row = document.querySelector('[data-gallery-row]')
  if (!row) return null
  const srcs = [...row.querySelectorAll('img')].map(i => i.getAttribute('src') || '')
  return {
    tiles: row.children.length,
    live: row.dataset.live === '1',
    names: [...row.querySelectorAll('b')].map(b => b.textContent.trim()),
    fromApi: srcs.filter(s => s.includes('heromaker.up.railway.app')).length,
    fromDisk: srcs.filter(s => s.startsWith('assets/pairs/')).length,
    count: (document.querySelector('[data-gallery-count]') || {}).textContent,
  }
}

// Can the browser get out by itself? Ask it once, rather than assuming.
const browser = await chromium.launch()
const probe = await browser.newPage()
const direct = await probe.evaluate(async (api) => {
  try {
    const r = await fetch(`https://${api}/api/creations/?limit=1`, { mode: 'cors' })
    return r.ok
  } catch { return false }
}, API).catch(() => false)
await probe.close()

// Can THIS process get out? If the browser cannot but Node can, Node relays.
let nodeCan = false
try {
  const r = await fetch(`https://${API}/api/creations/?limit=1`)
  nodeCan = r.ok
} catch {}

const RELAY = !direct && nodeCan
console.log(direct
  ? '(the browser reaches the API directly)\n'
  : RELAY
    ? '(the browser has no route out; this process is relaying the real API to it)\n'
    : '(NOTHING here can reach the API - the online half cannot pass)\n')

/** Hand the page the real answer to the exact request it made. */
const relay = async (route) => {
  const req = route.request()
  try {
    const res = await fetch(req.url(), { headers: { accept: req.headers().accept || '*/*' } })
    const body = Buffer.from(await res.arrayBuffer())
    route.fulfill({
      status: res.status,
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      headers: { 'access-control-allow-origin': '*' },
      body,
    })
  } catch (err) {
    route.abort()
  }
}

let bad = 0
const rows = []

for (const file of files) {
  const name = basename(file, '.html')
  const findings = []
  const line = { name }

  for (const mode of ['online', 'offline']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    if (mode === 'offline') await page.route(`**://${API}/**`, r => r.abort())
    else if (RELAY) await page.route(`**://${API}/**`, relay)
    await page.goto(`${ORIGIN}/${file}`, { waitUntil: 'domcontentloaded' })

    // Before anything can have resolved: the committed pairs must already be
    // the content of the chapter, not a spinner.
    const first = await page.evaluate(read)
    if (!first) { findings.push(`[${mode}] no gallery row ([data-gallery-row])`); await page.close(); continue }
    if (first.tiles < NEEDED || first.fromDisk < NEEDED * 2) {
      findings.push(`[${mode}] the chapter is not instant: ${first.tiles} tiles, ${first.fromDisk} committed images at first paint`)
    }

    if (mode === 'online') {
      await page.waitForFunction(
        () => document.querySelector('[data-gallery-row]').dataset.live === '1',
        null, { timeout: 25000 },
      ).catch(() => {})
    } else {
      await page.waitForTimeout(3000)
    }
    const end = await page.evaluate(read)
    line[mode] = end

    if (mode === 'online') {
      if (!end.live) findings.push('[online] the row never swapped to the live gallery')
      else {
        if (end.tiles < NEEDED) findings.push(`[online] only ${end.tiles} live pairs`)
        if (end.fromApi !== end.tiles * 2) {
          findings.push(`[online] ${end.fromApi} of ${end.tiles * 2} images came from the API`)
        }
      }
    } else {
      if (end.live) findings.push('[offline] the row claims to be live with the API blocked')
      if (end.tiles < NEEDED || end.fromDisk < NEEDED * 2) {
        findings.push(`[offline] the fallback did not hold: ${end.tiles} tiles, ${end.fromDisk} committed images`)
      }
    }
    // Frame the chapter this is about, not the top of the page.
    await page.evaluate(() => {
      const el = document.querySelector('[data-chapter="gallery"]')
      if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' })
    })
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(DIR, `${name}-gallery-${mode}.png`) })
    await page.close()
  }

  rows.push(line)
  if (findings.length === 0) console.log(`PASS  ${name}`)
  else { bad++; console.log(`FAIL  ${name}`); for (const f of findings) console.log(`        ${f}`) }
}

await browser.close()
await new Promise(r => server.close(r))

console.log('\n  concept                 online                              offline')
for (const r of rows) {
  const on = r.online ? `${r.online.tiles} live pairs, count ${r.online.count}` : '--'
  const off = r.offline ? `${r.offline.tiles} committed pairs, count ${r.offline.count}` : '--'
  console.log(`  ${r.name.padEnd(22)}  ${on.padEnd(34)}  ${off}`)
}
console.log()
console.log(bad === 0
  ? `The gallery is live in ${files.length} concept(s), and survives the API being gone.`
  : `${bad} of ${files.length} concept(s) failed.`)
process.exit(bad)
