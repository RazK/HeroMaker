/**
 * Does the hero actually move? Measured, not argued.
 *
 * The product owner tested these pages on a real Android phone and reported
 * that "the animations don't work on the VRM" - every card sat on its still
 * image. The cause was the engine loader: it asked cdn.jsdelivr.net for three
 * and @pixiv/three-vrm first and only fell back to the self-contained bundle
 * when that import rejected. On his phone it evidently did not fall back.
 *
 * So this does not trust that the fix works. It loads every concept with
 * **cdn.jsdelivr.net blocked outright**, presses each of the three moves, and
 * compares the rendered pixels of the card:
 *
 *   canvas     a <canvas> exists inside [data-hero-card] and is big enough to
 *              be the most important object on the page (>= 280px on phone)
 *   moving     four frames of the SAME clip, 260ms apart, are compared against
 *              the first and the largest difference is taken - the hero is
 *              animating rather than frozen on frame one. Several offsets,
 *              not one: Fly is a level forward glide on a short loop, and two
 *              samples a whole loop apart can land on the same pose and read
 *              as frozen when nothing is wrong
 *   distinct   the opening frame of this clip differs from the previous
 *              clip's - pressing the button really changed the performance
 *   playground the second card - the dance loop the playground chapter
 *              previews - goes live and moves too
 *
 * Frames come off the page as PNG element screenshots and are decoded here
 * (zlib + the four PNG filters, which is all Playwright ever emits: 8-bit
 * RGB/RGBA, non-interlaced), so "changed" is a share of pixels, not a guess
 * from a file size.
 *
 *   node marketing/concepts/anim-check.mjs             # all five, phone
 *   node marketing/concepts/anim-check.mjs concept-2   # one of them
 *   node marketing/concepts/anim-check.mjs --keep      # keep the frame PNGs
 *
 * Exit code is the number of concepts with a failure.
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createReadStream, statSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, basename, extname, normalize } from 'node:path'
import { inflateSync } from 'node:zlib'

// Playwright is a devDependency of the game, not of this folder. Resolve it
// from where it actually lives - the game's own node_modules when that has
// been installed, otherwise the global install this image ships.
const HOSTS = [
  '/home/user/HeroMaker/games/hero-moves/package.json',
  '/opt/node22/lib/node_modules/playwright/package.json',
]
let chromium
for (const host of HOSTS) {
  try { ({ chromium } = createRequire(host)('playwright')); break } catch {}
}
if (!chromium) {
  console.error(`Could not load playwright from any of:\n  ${HOSTS.join('\n  ')}`)
  process.exit(1)
}

const DIR = new URL('.', import.meta.url).pathname
const args = process.argv.slice(2)
const KEEP = args.includes('--keep')
const filter = args.find(a => !a.startsWith('--'))

const files = readdirSync(DIR)
  .filter(f => f.endsWith('.html'))
  .filter(f => !filter || f.includes(filter))
  .sort()

if (files.length === 0) {
  console.error(`No concept HTML in ${DIR}${filter ? ` matching "${filter}"` : ''}`)
  process.exit(1)
}

const FRAMES = join(DIR, 'anim-frames')
rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })

// ---- PNG -> raw RGBA ------------------------------------------------------
// Only what Playwright emits: 8 bits per channel, colour type 2 or 6, no
// interlacing. Anything else throws rather than being silently mis-read.
function decodePNG(buf) {
  let p = 8
  let w = 0, h = 0, colour = 0, depth = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const body = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4)
      depth = body[8]; colour = body[9]
      if (depth !== 8 || (colour !== 2 && colour !== 6) || body[12] !== 0) {
        throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${body[12]})`)
      }
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    p += 12 + len
  }
  const ch = colour === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let q = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[q++]
    const line = raw.subarray(q, q + stride); q += stride
    const row = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? row[x - ch] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= ch ? prev[x - ch] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      row[x] = v & 0xff
    }
  }
  return { w, h, ch, data: out }
}

/** Share of pixels whose colour moved by more than a hair, 0..1. */
function diff(a, b) {
  if (a.w !== b.w || a.h !== b.h || a.ch !== b.ch) return 1
  let changed = 0
  const n = a.w * a.h
  for (let i = 0; i < n; i++) {
    const o = i * a.ch
    const d = Math.abs(a.data[o] - b.data[o])
      + Math.abs(a.data[o + 1] - b.data[o + 1])
      + Math.abs(a.data[o + 2] - b.data[o + 2])
    if (d > 12) changed++
  }
  return changed / n
}

// ---- the same throwaway static server the audit uses ----------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.vrm': 'model/gltf-binary',
  '.vrma': 'model/gltf-binary', '.woff2': 'font/woff2',
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

const CLIPS = ['fly', 'dance', 'backflip']
// The hero is the point of the page. Below this it is a thumbnail.
const MIN_PHONE = 280
const MIN_DESKTOP = 320
// A card that is NOT animating is showing a static PNG, so every frame of it
// is byte-identical and this measures exactly 0. The bar only has to clear
// that, and is set well above it.
const MOVING = 0.0015
const GAP = 260       // between samples
const SAMPLES = 4     // so the window is ~780ms, sampled at four phases

const browser = await chromium.launch()
let bad = 0
const report = []

for (const file of files) {
  const name = basename(file, '.html')
  const findings = []
  const row = { name, phone: null, desktop: null, clips: {} }

  for (const vp of [{ n: 'phone', w: 390, h: 844 }, { n: 'desktop', w: 1440, h: 900 }]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } })
    // The whole point: prove the card never needed the CDN.
    await page.route('**://*.jsdelivr.net/**', r => r.abort())
    await page.route('**://*.unpkg.com/**', r => r.abort())
    await page.goto(`${ORIGIN}/${file}`, { waitUntil: 'load' })

    const live = await page.waitForFunction(
      () => !!document.querySelector('[data-hero-card].is-live'),
      null, { timeout: 40000 },
    ).then(() => true).catch(() => false)

    const box = await page.evaluate(() => {
      const c = document.querySelector('[data-hero-card] canvas')
      if (!c) return null
      const r = c.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height) }
    })

    if (!live) findings.push(`[${vp.n}] the hero card never went live (still image only)`)
    if (!box) findings.push(`[${vp.n}] no <canvas> inside [data-hero-card]`)
    else {
      row[vp.n] = `${box.w}x${box.h}`
      const min = vp.n === 'phone' ? MIN_PHONE : MIN_DESKTOP
      if (Math.min(box.w, box.h) < min) {
        findings.push(`[${vp.n}] canvas is ${box.w}x${box.h}px - the hero needs at least ${min}px`)
      }
    }

    // The clip test runs on the phone only: that is where it was reported
    // broken, and a second run would only re-measure the same engine.
    if (vp.n === 'phone' && live && box) {
      const card = page.locator('[data-hero-card]').first()
      let previous = null
      for (const clip of CLIPS) {
        const btn = page.locator(`[data-hero-moves] button[data-move="${clip}"]`).first()
        if (await btn.count() === 0) { findings.push(`[phone] no button for "${clip}"`); continue }
        await btn.click()
        // Let the crossfade finish so the frames are of this clip, not of the
        // blend out of the last one.
        await page.waitForTimeout(700)
        const a = decodePNG(await card.screenshot())
        if (KEEP) writeFileSync(join(FRAMES, `${name}-${clip}-a.png`), await card.screenshot())
        let moved = 0
        for (let i = 1; i < SAMPLES; i++) {
          await page.waitForTimeout(GAP)
          moved = Math.max(moved, diff(a, decodePNG(await card.screenshot())))
        }
        const apart = previous ? diff(previous, a) : null
        row.clips[clip] = {
          moving: +(moved * 100).toFixed(2),
          distinct: apart === null ? null : +(apart * 100).toFixed(2),
        }
        if (moved < MOVING) {
          findings.push(`[phone] "${clip}" is frozen: at most ${(moved * 100).toFixed(2)}% of the card changed across ${SAMPLES} frames`)
        }
        if (apart !== null && apart < MOVING) {
          findings.push(`[phone] "${clip}" looks identical to the clip before it (${(apart * 100).toFixed(2)}% different)`)
        }
        previous = a
      }
      await page.screenshot({ path: join(DIR, `${name}-anim.png`) })

      // The playground chapter previews a second hero on a longer dance loop,
      // driven by the same hero-card.js. It is lazy, so it has to be scrolled
      // to before it is asked to prove anything.
      const play = page.locator('[data-chapter="playground"] [data-hero-card]').first()
      if (await play.count() === 0) {
        findings.push('[phone] the playground chapter previews no hero ([data-hero-card])')
      } else {
        await play.scrollIntoViewIfNeeded()
        const lit = await page.waitForFunction(
          () => {
            const el = document.querySelector('[data-chapter="playground"] [data-hero-card]')
            return !!(el && el.classList.contains('is-live') && el.querySelector('canvas'))
          }, null, { timeout: 40000 },
        ).then(() => true).catch(() => false)
        if (!lit) findings.push('[phone] the playground preview never went live')
        else {
          await page.waitForTimeout(700)
          const a = decodePNG(await play.screenshot())
          let moved = 0
          for (let i = 1; i < SAMPLES; i++) {
            await page.waitForTimeout(GAP)
            moved = Math.max(moved, diff(a, decodePNG(await play.screenshot())))
          }
          row.clips.playground = { moving: +(moved * 100).toFixed(2), distinct: null }
          if (moved < MOVING) {
            findings.push(`[phone] the playground preview is frozen: at most ${(moved * 100).toFixed(2)}% changed across ${SAMPLES} frames`)
          }
          await page.screenshot({ path: join(DIR, `${name}-playground.png`) })
        }
        const link = page.locator('[data-chapter="playground"] a[href*="hero-moves"]')
        if (await link.count() === 0) {
          findings.push('[phone] the playground chapter does not link to Hero Moves')
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    await page.close()
  }

  report.push(row)
  if (findings.length === 0) console.log(`PASS  ${name}`)
  else {
    bad++
    console.log(`FAIL  ${name}`)
    for (const f of findings) console.log(`        ${f}`)
  }
}

await browser.close()
await new Promise(r => server.close(r))

console.log(`\n  concept                 canvas (phone)   canvas (desktop)   fly / dance / backflip / playground: most the card changed across ${SAMPLES} frames`)
for (const r of report) {
  const clips = [...CLIPS, 'playground'].map(c => r.clips[c] ? `${r.clips[c].moving}%` : '--').join('  ')
  console.log(`  ${r.name.padEnd(22)}  ${String(r.phone).padEnd(15)}  ${String(r.desktop).padEnd(17)}  ${clips}`)
}
console.log()
console.log(bad === 0
  ? `All ${files.length} concept(s) animate, with the CDN blocked.`
  : `${bad} of ${files.length} concept(s) failed.`)
process.exit(bad)
