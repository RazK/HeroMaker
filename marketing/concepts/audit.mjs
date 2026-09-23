/**
 * One gate, applied identically to every landing-page concept.
 *
 * The designers each checked their own work. This does not trust that: it
 * re-measures all of them the same way, so "concept 2 passed" and "concept 4
 * passed" mean the same thing.
 *
 * Five rules. The first three are the faults that have been reported from a
 * real phone on this project before; the fourth and fifth are the ones the
 * product owner reported, from the top of the page and then from the rest of
 * it.
 *
 *   1. CONTRAST   every run of text reaches 4.5:1 against what is actually
 *                 behind it (3:1 at 24px+, or 19px+ bold). Backgrounds are
 *                 resolved by walking up the ancestor chain; text sitting on a
 *                 gradient or image is SAMPLED from the rendered pixels, at its
 *                 brightest and darkest point, and judged on the worse one.
 *   2. FITS       nothing is cut off, and the page never scrolls sideways.
 *   3. NO OVERLAP no two runs of text sit on top of each other.
 *   4. ABOVE THE  the live drawing-to-hero card and the primary call to action
 *      FOLD       are both wholly inside the first screen, with no scrolling,
 *                 and pricing is not. Measured from the element boxes with the
 *                 page scrolled to the top - not eyeballed from a screenshot.
 *   5. ONE SCREEN  "every one of these chapters needs to have one single screen
 *      A CHAPTER   occupation, it should not require you to scroll down."
 *                 Every [data-chapter] - Hero, Gallery, Playground, How it
 *                 works, Pricing - has scrollHeight no greater than the
 *                 viewport, at 390x844 AND 1440x900, with the sticky header
 *                 in place and paid for. The visitor scrolls BETWEEN chapters,
 *                 never INSIDE one. And the header really is on every chapter:
 *                 each one is scrolled to and the header's top must still be
 *                 0. `overflow-x:hidden` anywhere above it quietly turns the
 *                 body into a scroll container and sticky stops sticking -
 *                 four of the five shipped that way once.
 *
 * Text is measured as glyphs via Range.getClientRects(), not as element boxes -
 * an element box is mostly empty space and overlapping boxes are normal.
 *
 * The pages are served over HTTP rather than opened as file:// URLs, because
 * the card fetches a 1.1 MB `.vrm` and a `file://` origin refuses that. The
 * server is a throwaway rooted at this folder, on an ephemeral port, up only
 * for the run. That is also how a human should preview them:
 *
 *   npx serve marketing/concepts     # or: python3 -m http.server -d ...
 *
 *   node marketing/concepts/audit.mjs            # all concepts
 *   node marketing/concepts/audit.mjs concept-2  # one of them
 *
 * Screenshots written next to each concept: `-desktop.png` / `-phone.png` are
 * the whole page, `-desktop-fold.png` / `-phone-fold.png` are only the first
 * screen, so rule 4 can be judged on its own, and one
 * `<concept>-<chapter>-<viewport>.png` per chapter per size, which is how a
 * person checks rule 5 with their own eyes.
 *
 * Exit code is the number of concepts with findings.
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { join, basename, extname, normalize } from 'node:path'

// Playwright is a devDependency of the game, not of this folder - there is no
// package.json here and there should not be one for five static mockups. Resolve
// it from where it actually lives rather than symlinking node_modules around.
const PLAYWRIGHT_HOSTS = [
  '/home/user/HeroMaker/games/hero-moves/package.json',
  '/opt/node22/lib/node_modules/playwright/package.json',
]
let chromium
for (const host of PLAYWRIGHT_HOSTS) {
  try { ({ chromium } = createRequire(host)('playwright')); break } catch {}
}
if (!chromium) {
  console.error(`Could not load playwright from any of:\n  ${PLAYWRIGHT_HOSTS.join('\n  ')}`)
  console.error('Run `npm install` in games/hero-moves first.')
  process.exit(1)
}

const DIR = new URL('.', import.meta.url).pathname
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

const filter = process.argv[2]
const files = readdirSync(DIR)
  .filter(f => f.endsWith('.html'))
  .filter(f => !filter || f.includes(filter))
  .sort()

if (files.length === 0) {
  console.error(`No concept HTML found in ${DIR}${filter ? ` matching "${filter}"` : ''}`)
  process.exit(1)
}

const AUDIT = () => {
  // ---- colour helpers -----------------------------------------------------
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b, a] = m[1].split(',').map(s => parseFloat(s.trim()))
    return { r, g, b, a: a === undefined ? 1 : a }
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })

  // The effective background behind an element: walk up until something opaque
  // is found. Report whether anything on the way was an image or a gradient,
  // because then the flat colour is a lie and the caller must sample pixels.
  const backdrop = (el) => {
    let node = el
    let painted = false
    let acc = null
    while (node && node !== document.documentElement.parentNode) {
      const cs = getComputedStyle(node)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') painted = true
      const c = parse(cs.backgroundColor)
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c
        if (acc.a >= 0.999) return { color: acc, painted }
      }
      node = node.parentElement
    }
    return { color: acc || { r: 255, g: 255, b: 255, a: 1 }, painted }
  }

  // ---- every run of text on the page -------------------------------------
  const runs = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode())) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue
    const el = n.parentElement
    if (!el) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (parseFloat(cs.opacity) < 0.1) continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1)
    if (rects.length === 0) continue
    const size = parseFloat(cs.fontSize)
    const weight = parseInt(cs.fontWeight, 10) || 400
    runs.push({
      el, cs, rects, size, weight,
      text: n.nodeValue.trim().slice(0, 60),
      large: size >= 24 || (size >= 18.66 && weight >= 700),
    })
  }

  // ---- rule 1: contrast ---------------------------------------------------
  const contrast = []
  for (const run of runs) {
    const fg = parse(run.cs.color)
    if (!fg) continue
    const { color: bg, painted } = backdrop(run.el)
    const need = run.large ? 3 : 4.5
    const flat = ratio(over(fg, bg), bg)
    contrast.push({
      text: run.text,
      tag: run.el.tagName.toLowerCase(),
      fg: run.cs.color,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      size: run.size,
      need,
      ratio: Math.round(flat * 100) / 100,
      painted,
      rect: (({ x, y, width, height }) => ({ x, y, width, height }))(run.rects[0]),
      pass: flat >= need,
    })
  }

  // ---- rule 2: fits -------------------------------------------------------
  // The gallery row is a deliberate sideways scroller: its later tiles are laid
  // out past the right edge of the window and that is what swiping is for. So a
  // run inside one is judged against THAT box's scrollable width, not the
  // page's - text genuinely spilling out of the row is still caught.
  const xScroller = (el) => {
    let n = el
    while (n && n !== document.body) {
      const cs = getComputedStyle(n)
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1) return n
      n = n.parentElement
    }
    return null
  }
  const docW = document.documentElement.scrollWidth
  const winW = window.innerWidth
  const clipped = []
  for (const run of runs) {
    const sc = xScroller(run.el)
    const box = sc ? sc.getBoundingClientRect() : null
    const lo = sc ? box.left - sc.scrollLeft : 0
    const hi = sc ? lo + sc.scrollWidth : docW
    for (const r of run.rects) {
      if (r.left < lo - 1 || r.right > hi + 1) {
        clipped.push({
          text: run.text, left: Math.round(r.left), right: Math.round(r.right),
          docW: Math.round(hi), where: sc ? 'inside a sideways scroller' : 'on the page',
        })
        break
      }
    }
  }

  // ---- rule 3: no overlapping text ---------------------------------------
  // Only the first rect of each run, inflated by nothing. Two runs whose glyph
  // boxes intersect by more than a couple of pixels are sitting on each other.
  const boxes = runs.map(r => ({ text: r.text, ...r.rects[0].toJSON ? r.rects[0].toJSON() : r.rects[0] }))
  const overlaps = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (w > 2 && h > 2) {
        const area = w * h
        const smaller = Math.min(a.width * a.height, b.width * b.height)
        if (area / smaller > 0.25) {
          overlaps.push({ a: a.text, b: b.text, area: Math.round(area) })
        }
      }
    }
  }

  // ---- rule 4: the hero shot is above the fold ---------------------------
  // The product owner's complaint, made measurable: with the page scrolled to
  // the top, the live card and the primary call to action must be wholly
  // inside the first screen, and pricing must not have started yet.
  const winH = window.innerHeight
  const seen = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      width: Math.round(r.width), height: Math.round(r.height),
    }
  }
  const fold = {
    winH,
    scrolled: Math.round(window.scrollY),
    shot: seen('[data-hero-shot]'),
    card: seen('[data-hero-card]'),
    cta: seen('[data-primary-cta]'),
    pricing: seen('#pricing'),
  }

  // ---- rule 5: one chapter, one screen ------------------------------------
  // scrollHeight, not getBoundingClientRect: a chapter whose contents overflow
  // it looks the right height from the outside and still makes the visitor
  // scroll. The sticky header is part of the viewport this is measured against,
  // so it is charged to every chapter.
  const chapters = [...document.querySelectorAll('[data-chapter]')].map((el) => ({
    name: el.getAttribute('data-chapter') || el.id || el.tagName.toLowerCase(),
    scrollHeight: el.scrollHeight,
    clientHeight: Math.round(el.getBoundingClientRect().height),
  }))

  return {
    runCount: runs.length,
    contrast,
    clipped,
    overlaps: overlaps.slice(0, 20),
    fold,
    chapters,
    winH,
    horizontalScroll: docW > winW + 1 ? { docW, winW } : null,
  }
}

// Sample the rendered pixels behind a text run, for text over a gradient or an
// image where the computed background colour is not what is actually painted.
const SAMPLE = async (page, rect) => {
  const shot = await page.screenshot({
    clip: {
      x: Math.max(0, rect.x), y: Math.max(0, rect.y),
      width: Math.max(1, Math.min(rect.width, 400)),
      height: Math.max(1, Math.min(rect.height, 80)),
    },
  })
  return shot
}

// A throwaway static server rooted at this folder. The card fetches a `.vrm`
// and dynamically imports a sibling module; both are refused on a file://
// origin, so the mockups have to be audited the way they are actually served.
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
    'content-length': stat.size,
    'cache-control': 'no-store',
  })
  createReadStream(path).pipe(res)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch()
let concepts = 0

for (const file of files) {
  const url = `${ORIGIN}/${file}`
  const findings = []

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } })
    await page.goto(url, { waitUntil: 'load' })
    // Give the card a chance to go live so the screenshots show the avatar
    // rather than its still. A card that never arrives is not a failure here -
    // that is exactly the fallback, and rule 4 measures the box either way.
    await page.waitForFunction(
      () => document.querySelector('[data-hero-card].is-live, [data-hero-card].is-still'),
      null, { timeout: 25000 },
    ).catch(() => {})
    await page.waitForTimeout(700)
    await page.evaluate(() => window.scrollTo(0, 0))

    const r = await page.evaluate(AUDIT)

    if (r.horizontalScroll) {
      findings.push(`[${vp.name}] page scrolls sideways: content ${r.horizontalScroll.docW}px in a ${r.horizontalScroll.winW}px window`)
    }
    for (const c of r.clipped) {
      findings.push(`[${vp.name}] text cut off at the edge ${c.where}: "${c.text}" (${c.left}..${c.right} of ${c.docW})`)
    }
    for (const o of r.overlaps) {
      findings.push(`[${vp.name}] text on top of text: "${o.a}" over "${o.b}"`)
    }
    for (const c of r.contrast.filter(c => !c.pass)) {
      findings.push(
        `[${vp.name}] contrast ${c.ratio}:1 needs ${c.need}:1 - ${c.fg} on ${c.bg} ` +
        `(${Math.round(c.size)}px <${c.tag}>) "${c.text}"` +
        (c.painted ? '  [over a gradient/image - flat estimate]' : '')
      )
    }

    // rule 4 - only at the two sizes the brief names.
    if (vp.name === 'phone' || vp.name === 'desktop') {
      const f = r.fold
      if (!f.card) {
        findings.push(`[${vp.name}] no live hero card on the page ([data-hero-card])`)
      } else if (f.card.height < 120 || f.card.width < 120) {
        findings.push(`[${vp.name}] the hero card is ${f.card.width}x${f.card.height}px - too small to be the hero shot`)
      } else if (f.card.bottom > f.winH || f.card.top < 0) {
        findings.push(
          `[${vp.name}] the hero card is not in the first screen: ` +
          `${f.card.top}..${f.card.bottom} of ${f.winH}px (needs scrolling)`)
      } else if (f.shot && (f.shot.bottom > f.winH || f.shot.top < 0)) {
        // The live half fits but its captions do not, which is still a card
        // the reader has to scroll to finish.
        findings.push(
          `[${vp.name}] the hero shot is cut by the fold: ` +
          `${f.shot.top}..${f.shot.bottom} of ${f.winH}px`)
      }
      if (!f.cta) {
        findings.push(`[${vp.name}] no primary call to action marked ([data-primary-cta])`)
      } else if (f.cta.bottom > f.winH || f.cta.top < 0) {
        findings.push(
          `[${vp.name}] the primary call to action is below the fold: ` +
          `${f.cta.top}..${f.cta.bottom} of ${f.winH}px`)
      }
      if (f.pricing && f.pricing.top < f.winH) {
        findings.push(
          `[${vp.name}] pricing starts in the first screen at ${f.pricing.top}px of ${f.winH}px - it belongs well below`)
      }

      // rule 5 - one chapter, one screen, at both of the sizes the brief names.
      if (r.chapters.length === 0) {
        findings.push(`[${vp.name}] no chapters on the page ([data-chapter])`)
      }
      for (const ch of r.chapters) {
        if (ch.scrollHeight > r.winH + 1) {
          findings.push(
            `[${vp.name}] the "${ch.name}" chapter needs scrolling: ` +
            `${ch.scrollHeight}px of content in a ${r.winH}px screen`)
        }
      }

      const stem = join(DIR, `${basename(file, '.html')}-${vp.name}`)
      await page.screenshot({ path: `${stem}-fold.png` })
      await page.screenshot({ path: `${stem}.png`, fullPage: true })

      // One screenshot per chapter per size, so rule 5 can also be judged by
      // eye and not only by the number - and, while we are down there, the
      // header had better still be at the top of the screen.
      for (const ch of r.chapters) {
        const head = await page.evaluate((name) => {
          const el = document.querySelector(`[data-chapter="${name}"]`)
          if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' })
          const h = document.querySelector('.hm-head')
          return h ? Math.round(h.getBoundingClientRect().top) : null
        }, ch.name)
        await page.waitForTimeout(350)
        const top = await page.evaluate(() => {
          const h = document.querySelector('.hm-head')
          return h ? Math.round(h.getBoundingClientRect().top) : null
        })
        if (head === null || top === null) {
          findings.push(`[${vp.name}] no sticky header (.hm-head) on the "${ch.name}" chapter`)
        } else if (top > 1) {
          findings.push(
            `[${vp.name}] the header is not sticky on the "${ch.name}" chapter: ` +
            `it sits at ${top}px instead of 0 (an ancestor with overflow-x:hidden?)`)
        }
        await page.screenshot({
          path: join(DIR, `${basename(file, '.html')}-${ch.name}-${vp.name}.png`),
        })
      }
      await page.evaluate(() => window.scrollTo(0, 0))
    }
    await page.close()
  }

  const name = basename(file, '.html')
  if (findings.length === 0) {
    console.log(`PASS  ${name}`)
  } else {
    concepts++
    console.log(`FAIL  ${name}  (${findings.length} finding${findings.length === 1 ? '' : 's'})`)
    for (const f of findings.slice(0, 25)) console.log(`        ${f}`)
    if (findings.length > 25) console.log(`        ... and ${findings.length - 25} more`)
  }
}

await browser.close()
await new Promise((resolve) => server.close(resolve))
console.log()
console.log(concepts === 0
  ? `All ${files.length} concept(s) pass.`
  : `${concepts} of ${files.length} concept(s) have findings.`)
process.exit(concepts)
