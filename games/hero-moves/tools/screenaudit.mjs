import { chromium } from 'playwright'
import fs from 'node:fs'

/**
 * The screen gate.
 *
 * Three bugs came back off one real phone in one sitting: a control that had
 * been pushed off the bottom of a card and could not be reached, a label that
 * said "Short" where it meant twenty-five seconds, and three heroes standing in
 * the same cubic metre of stage. Two of the three are geometry, and geometry is
 * exactly what nobody checks by reading a diff — the screen it breaks on is
 * never the screen it was built at.
 *
 * So this walks the product and fails the build on three machine-checkable
 * rules:
 *
 *   1. Nothing interactive is unreachable. Every button, link and input in the
 *      DOM is fully inside the viewport and not clipped by anything, except in
 *      one declared scrolling list (`data-scroll`), and there it must actually
 *      scroll into full, un-covered view.
 *   2. Nothing overlaps that should not. Text runs, images and controls that
 *      are not ancestors of one another may not share pixels, unless one of
 *      them is inside a subtree marked `data-overlay=` with a key this file
 *      knows about. The allowlist is small and each entry is a sentence you can
 *      argue with, because a rule with no allowlist gets commented out in a day.
 *   3. No two heroes intersect. Their world-space bounding boxes are read back
 *      out of the running scene and must be clear of each other on X.
 *
 * It also carries the fit checks that used to live in `tools/partyfit.mjs` —
 * tap target size, hero portrait size, card overflow, how much of the screen
 * the stage keeps — because two tools measuring the same card is two tools that
 * will eventually disagree about it. partyfit is gone; this is where those
 * assertions live now.
 *
 * Usage:
 *
 *   node tools/screenaudit.mjs [url]                 # the whole product
 *   node tools/screenaudit.mjs --quick               # one pass per viewport
 *   node tools/screenaudit.mjs --players=3 --phase=menu --viewport=phone-in-view
 *   node tools/screenaudit.mjs --rules=1,3           # just those rules
 *   node tools/screenaudit.mjs --shots=/tmp/audit    # a png per failing case
 *
 * No camera and no GPU are needed: `window.__api` puts every phase up without
 * one, which is the only reason walking a few thousand combinations is possible
 * at all.
 */

// ---------------------------------------------------------------- the matrix
/**
 * The seven sizes, unchanged from partyfit: a small phone, the ~385x560 a
 * phone actually hands an embedded artifact once the viewer has taken its
 * chrome, two bigger phones, a tablet, a landscape phone and a desktop.
 */
const SIZES = [
  { name: 'phone-small', w: 320, h: 480 },
  { name: 'phone-in-view', w: 385, h: 560 },
  { name: 'phone-tall', w: 412, h: 660 },
  { name: 'phone-full', w: 430, h: 900 },
  { name: 'tablet', w: 820, h: 900 },
  { name: 'landscape', w: 900, h: 430 },
  { name: 'desktop', w: 1440, h: 900 },
]
const PHASES = ['menu', 'countdown', 'dancing', 'paused', 'results']
const LENGTHS = ['short', 'normal', 'long']
const PLAYERS = [1, 2, 3]
const STANCES = [false, true]

// ---------------------------------------------------------------- allowlists
/**
 * Deliberate layering, and why.
 *
 * A mark licenses a subtree to overlap things *outside* it. Two elements inside
 * the same marked subtree landing on each other is still a finding — otherwise
 * marking the HUD would excuse the whole HUD from the rule, which is how these
 * lists rot.
 */
const OVERLAP_ALLOW = {
  scene: 'the WebGL canvas is the world; every card and plate is painted over it',
  hud: 'the score plates, the strip and the count-in float over the 3D stage',
  strip: 'the beat line and the move name are drawn across the pictogram strip',
  'sticky-footer': 'the results buttons ride the bottom of a card that scrolls',
  'tile-badge': 'the P2/P3 badge sits in the corner of the hero tile it marks',
  'preview-chip': 'the stance switch, the camera button and the hint sit on the camera preview',
}
/** Scrolling lists a player has a reason to scroll. See rule 1. */
const SCROLL_ALLOW = {
  'hero-gallery': 'six characters in a grid, with the next row peeking under the fold',
}

/** A control smaller than this is one a child misses. From partyfit. */
const MIN_TAP = 40
/** Below this a hero portrait is a smudge; the picker is the whole screen. */
const MIN_TILE = 52
/** Below this the heroes are not worth looking at, which is the whole game. */
const MIN_STAGE_FRACTION = 0.3
/** Clear air required between two heroes' world boxes on X, in metres. */
const HERO_MARGIN = 0.05

// ---------------------------------------------------------------- flags
const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : dflt
}
const has = (name) => argv.includes(`--${name}`)
const list = (name, all, map = (v) => v) => {
  const raw = flag(name, null)
  if (raw === null || raw === 'all') return all
  const want = raw.split(',').map((s) => s.trim()).map(map)
  const picked = all.filter((v) => want.includes(v))
  if (!picked.length) throw new Error(`--${name}=${raw} matches nothing of: ${all.join(', ')}`)
  return picked
}

const url = argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5183/'
const quick = has('quick')
const shotsDir = flag('shots', null)
const bail = has('bail')
const verbose = has('verbose')
const rules = new Set((flag('rules', '1,2,3,fit')).split(',').map((s) => s.trim()))

const sizes = list('viewport', SIZES.map((s) => s.name)).map((n) => SIZES.find((s) => s.name === n))
const phases = list('phase', PHASES)
const lengths = list('length', LENGTHS)
const players = list('players', PLAYERS, Number)
const stances = list('stance', STANCES, (v) => v === 'sitting' || v === 'true')

/**
 * `--quick` is the pass you run while working: it keeps every viewport and
 * every phase — the two dimensions that actually move the layout — and takes
 * one representative value of the rest. It is not the gate.
 */
const plan = []
for (const size of sizes) {
  for (const phase of phases) {
    for (const n of quick ? [players[players.length - 1]] : players) {
      for (const seated of quick ? [stances[0]] : stances) {
        for (const length of quick ? [lengths[0]] : lengths) {
          // The backdrop cannot move a DOM node, but it can hide one behind a
          // bright sky, and rule 3 wants every set walked, so it is in the
          // product. It is the innermost loop because it is the cheapest to
          // change: no reload, no relayout, one call.
          plan.push({ size, phase, players: n, seated, length })
        }
      }
    }
  }
}

// ---------------------------------------------------------------- page audit
/**
 * Everything below runs inside the page. It is one function because Playwright
 * serialises it across, and it returns findings rather than throwing so one bad
 * screen does not cost the rest of the run.
 */
function auditPage(opts) {
  const { minTap, overlapAllow, scrollAllow, minTile, minStageFraction } = opts
  const rules = new Set(opts.rules)
  const findings = []
  const vw = innerWidth, vh = innerHeight
  const add = (rule, what, where, detail) => findings.push({ rule, what, where, detail })

  // ---- helpers
  const nameOf = (e) => {
    if (!e || !e.tagName) return String(e)
    const id = e.id ? `#${e.id}` : ''
    const cls = typeof e.className === 'string' && e.className
      ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
    const text = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)
    return `${e.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`
  }
  const rectOf = (e) => {
    const r = e.getBoundingClientRect()
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }
  }
  const inter = (a, b) => {
    const l = Math.max(a.l, b.l), t = Math.max(a.t, b.t)
    const r = Math.min(a.r, b.r), bo = Math.min(a.b, b.b)
    return { l, t, r, b: bo, w: Math.max(0, r - l), h: Math.max(0, bo - t) }
  }
  const viewport = { l: 0, t: 0, r: vw, b: vh, w: vw, h: vh }

  const chainVisible = (e) => {
    for (let p = e; p; p = p.parentElement) {
      if (p.hidden) return false
      const cs = getComputedStyle(p)
      if (cs.display === 'none' || cs.visibility === 'hidden') return false
      if (parseFloat(cs.opacity) === 0) return false
    }
    return true
  }
  /** Ancestors that cut their children off, innermost first. */
  const clippers = (e) => {
    const out = []
    for (let p = e.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      const ov = `${cs.overflowX} ${cs.overflowY}`
      if (/auto|scroll|hidden|clip/.test(ov)) out.push(p)
    }
    return out
  }
  const visibleRect = (e) => {
    let box = rectOf(e)
    for (const c of clippers(e)) box = inter(box, rectOf(c))
    return inter(box, viewport)
  }
  const markOf = (e, attr) => {
    for (let p = e; p; p = p.parentElement) {
      const v = p.dataset && p.dataset[attr]
      if (v) return { key: v, node: p }
    }
    return null
  }

  // ---------------------------------------------------------- rule 1
  const CONTROL = 'button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
  const controls = [...document.querySelectorAll(CONTROL)].filter(chainVisible)
    .filter((e) => { const r = rectOf(e); return r.w >= 1 && r.h >= 1 })

  if (rules.has('1')) {
    // Remember where every scroller sits so the page is handed back untouched.
    // Every element that *can* scroll, not just those that already are: this
    // rule scrolls things into view to prove they can be reached, and a gallery
    // left half-scrolled would follow the run into the next screen it audits.
    const scrollers = [...document.querySelectorAll('*')]
      .filter((e) => e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)
      .map((e) => ({ e, top: e.scrollTop, left: e.scrollLeft }))

    for (const e of controls) {
      const full = rectOf(e)
      const vis = visibleRect(e)
      const clipped = vis.w < full.w - 1 || vis.h < full.h - 1
      if (!clipped) { checkCovered(e, vis); continue }

      // Clipped. The only licence is a declared scrolling list.
      const scroll = markOf(e, 'scroll')
      if (!scroll || !scrollAllow[scroll.key]) {
        const by = clippers(e).find((c) => {
          const i = inter(rectOf(e), rectOf(c))
          return i.w < full.w - 1 || i.h < full.h - 1
        })
        add(1, nameOf(e), by ? nameOf(by) : 'the viewport',
          vis.w <= 0 || vis.h <= 0
            ? `entirely out of view (${Math.round(full.l)},${Math.round(full.t)} ${Math.round(full.w)}x${Math.round(full.h)}, viewport ${vw}x${vh})`
            : `cut to ${Math.round(vis.w)}x${Math.round(vis.h)} of ${Math.round(full.w)}x${Math.round(full.h)}`)
        continue
      }
      // Declared scroller: it has to genuinely bring the control into view.
      e.scrollIntoView({ block: 'center', inline: 'center' })
      const after = visibleRect(e)
      const afterFull = rectOf(e)
      if (after.w < afterFull.w - 1 || after.h < afterFull.h - 1) {
        add(1, nameOf(e), nameOf(scroll.node),
          `still cut to ${Math.round(after.w)}x${Math.round(after.h)} of ` +
          `${Math.round(afterFull.w)}x${Math.round(afterFull.h)} after scrolling it into view`)
      } else {
        checkCovered(e, after)
      }
    }
    for (const s of scrollers) { s.e.scrollTop = s.top; s.e.scrollLeft = s.left }
  }

  /** In view is not the same as tappable: something may be painted over it. */
  function checkCovered(e, vis) {
    const x = (vis.l + vis.r) / 2, y = (vis.t + vis.b) / 2
    const hit = document.elementFromPoint(x, y)
    if (!hit) {
      add(1, nameOf(e), 'nothing', `hit test at (${Math.round(x)},${Math.round(y)}) found no element`)
      return
    }
    if (hit === e || e.contains(hit) || hit.contains(e)) return
    add(1, nameOf(e), nameOf(hit), `covered: a tap in the middle of it lands on ${nameOf(hit)}`)
  }

  // ---------------------------------------------------------- fit checks
  if (rules.has('fit')) {
    for (const e of controls) {
      const r = rectOf(e)
      // The stance chips and the stage pills are chips, not primary controls;
      // partyfit only ever asserted this of the big ones, and so does this.
      if (!e.classList.contains('btn') && !e.classList.contains('icon-btn')) continue
      if (Math.min(r.w, r.h) < minTap) {
        add('fit', nameOf(e), 'tap target', `${Math.round(r.w)}x${Math.round(r.h)}, under ${minTap}px`)
      }
    }
    const card = document.querySelector('.layer.sheet:not([hidden]) .card')
    if (card) {
      const r = rectOf(card)
      if (r.b > vh + 1) add('fit', nameOf(card), 'viewport', `card overflows the bottom by ${Math.round(r.b - vh)}px`)
      if (r.r > vw + 1) add('fit', nameOf(card), 'viewport', `card overflows the right by ${Math.round(r.r - vw)}px`)
      const landscape = vw > vh
      const frac = landscape ? (vw - r.w) / vw : (vh - r.h) / vh
      if (frac < minStageFraction) {
        add('fit', nameOf(card), 'the stage',
          `stage left with ${(frac * 100).toFixed(0)}% of the ${landscape ? 'width' : 'height'}, under ${minStageFraction * 100}%`)
      }
    }
    const tiles = [...document.querySelectorAll('.gtile img')]
    if (document.querySelector('#title:not([hidden])')) {
      if (tiles.length !== 6) add('fit', '.gallery', 'roster', `${tiles.length} hero tiles, expected 6`)
      for (const t of tiles) {
        const r = rectOf(t)
        // The short side, not the width partyfit used to take: the portraits
        // are `object-fit: contain` inside a box the lobby caps the height of,
        // so a 78x41 tile shows a 41px avatar however wide its box is.
        if (Math.min(r.w, r.h) < minTile) {
          add('fit', nameOf(t.closest('.gtile')), 'hero portrait', `${Math.round(r.w)}x${Math.round(r.h)}px, short side under ${minTile}px`)
          break
        }
      }
    }
  }

  // ---------------------------------------------------------- rule 2
  if (rules.has('2')) {
    /**
     * What counts as "something drawn".
     *
     * Not every element: a container's box is not ink, and comparing containers
     * produces a page of findings about nothing. The candidates are the things
     * a player actually sees — each run of text, measured with a Range so the
     * box is the glyphs and not the block they sit in; each replaced element;
     * and each control, because two controls sharing pixels is a bug however
     * empty they are.
     */
    const boxes = []
    const pushBox = (el, box, kind) => {
      if (box.w < 2 || box.h < 2) return
      // A text run is measured with a Range, which reports where the glyphs
      // *would* be — `overflow: hidden` and `text-overflow: ellipsis` on the
      // element itself do not move them. So a run is clipped by its own element
      // as well as by its ancestors; without that, every truncated name in the
      // product reads as painted over its neighbour.
      const cut = kind === 'text' ? [el, ...clippers(el)] : clippers(el)
      const clip = cut.reduce((acc, c) => inter(acc, rectOf(c)), box)
      const v = inter(clip, viewport)
      if (v.w < 2 || v.h < 2) return
      boxes.push({ el, box: v, kind })
    }
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    const range = document.createRange()
    for (let el = walk.currentNode; el; el = walk.nextNode()) {
      if (!(el instanceof Element) || !chainVisible(el)) continue
      const tag = el.tagName.toLowerCase()
      if (/^(img|canvas|svg|video|input|select|textarea)$/.test(tag)) pushBox(el, rectOf(el), tag)
      else if (el.matches('button, a[href], [role="button"]')) pushBox(el, rectOf(el), 'control')
      for (const node of el.childNodes) {
        if (node.nodeType !== 3 || !node.data.trim()) continue
        range.selectNodeContents(node)
        for (const r of range.getClientRects()) {
          pushBox(el, { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }, 'text')
        }
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue
        const o = inter(a.box, b.box)
        if (o.w < 2 || o.h < 2) continue
        const area = o.w * o.h
        const smallest = Math.min(a.box.w * a.box.h, b.box.w * b.box.h)
        if (area < 6 || area / smallest < 0.03) continue
        // Licensed layering: the mark has to sit over exactly one of the two,
        // or it would excuse a subtree from overlapping itself.
        const ma = markOf(a.el, 'overlay'), mb = markOf(b.el, 'overlay')
        const licensed = (m, other) => m && overlapAllow[m.key] && !m.node.contains(other.el)
        if (licensed(ma, b) || licensed(mb, a)) continue
        add(2, `${a.kind}: ${nameOf(a.el)}`, `${b.kind}: ${nameOf(b.el)}`,
          `${Math.round(o.w)}x${Math.round(o.h)}px of shared pixels ` +
          `(${Math.round((area / smallest) * 100)}% of the smaller)`)
      }
    }
  }

  return findings
}

// ---------------------------------------------------------------- driver
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})

const started = Date.now()
let checked = 0
const failures = []
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true })

for (const size of sizes) {
  // One page per viewport. Booting the game costs half a minute of software
  // rendering; changing every other axis costs one call into window.__api.
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } })
  await page.route('**://fonts.g*/**', (r) => r.abort())
  page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
  // ?lite=1 drops antialiasing, shadows and the pixel ratio. None of that moves
  // a DOM box or a hero, and without it a software renderer spends the entire
  // run on pixels nothing asserts.
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}lite=1`, { waitUntil: 'load', timeout: 180000 })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
  // A build that predates the debug surface still has to be auditable — that is
  // how you show a gate failing on the bug it was written for. A missing hook
  // is reported, never quietly skipped.
  const backdrops = await page.evaluate(() => window.__api.backdrops?.() ?? null)
  if (!backdrops) console.log('! this build does not expose __api.backdrops(); auditing the default set only')
  const stages = list('stage', backdrops ?? ['default'])

  let state = { players: null, seated: null, length: null, phase: null, stage: null }
  for (const cell of plan.filter((c) => c.size === size)) {
    for (const stageId of quick ? [stages[0]] : stages) {
      const want = { ...cell, stage: stageId }
      // Cheapest axis first, and only what actually changed: the difference
      // between a 40-minute run and a four-hour one.
      if (want.players !== state.players) {
        await page.evaluate((n) => window.__api.setPlayers(n), want.players)
        await page.waitForTimeout(400 * want.players)
      }
      if (want.seated !== state.seated) await page.evaluate((v) => window.__api.setSeated(v), want.seated)
      if (want.length !== state.length) await page.evaluate((v) => window.__api.setLength(v), want.length)
      if (backdrops && want.stage !== state.stage) {
        await page.evaluate((v) => window.__api.setBackdrop(v), want.stage)
      }
      // A phase is always re-entered: `stage()` restarts the routine, and the
      // menu has to be returned to first or the game refuses to start again.
      await page.evaluate(() => window.__api.menu())
      if (want.phase !== 'menu') await page.evaluate((p) => window.__api.stage(p), want.phase)
      state = want
      // Two frames: one to lay out, one for the plates that are positioned from
      // the frame before them.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

      const found = await page.evaluate(auditPage, {
        minTap: MIN_TAP, minTile: MIN_TILE, minStageFraction: MIN_STAGE_FRACTION,
        overlapAllow: OVERLAP_ALLOW, scrollAllow: SCROLL_ALLOW, rules: [...rules],
      })

      // Rule 3 is the scene, not the DOM, so it is read separately.
      if (rules.has('3')) {
        const boxes = await page.evaluate(() => window.__api.heroBoxes?.() ?? null)
        if (!boxes) {
          found.push({
            rule: 3, what: 'window.__api.heroBoxes()', where: 'the page',
            detail: 'not exposed, so no hero can be shown clear of any other',
          })
        }
        for (let i = 0; boxes && i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], b = boxes[j]
            if (!a || !b) continue
            const lo = a.min[0] < b.min[0] ? a : b
            const hi = lo === a ? b : a
            const gap = hi.min[0] - lo.max[0]
            if (gap < HERO_MARGIN) {
              found.push({
                rule: 3, what: `hero in lane ${lo.lane + 1}`, where: `hero in lane ${hi.lane + 1}`,
                detail: gap < 0
                  ? `world boxes overlap by ${(-gap).toFixed(3)} m on X ` +
                    `(${lo.min[0].toFixed(2)}..${lo.max[0].toFixed(2)} against ${hi.min[0].toFixed(2)}..${hi.max[0].toFixed(2)})`
                  : `only ${gap.toFixed(3)} m of clear air on X, under the ${HERO_MARGIN} m margin`,
              })
            }
          }
        }
      }

      checked++
      const label = `${size.name} ${size.w}x${size.h} ${want.players}P ` +
        `${want.seated ? 'sitting' : 'standing'} ${want.length} ${want.stage} ${want.phase}`
      if (found.length) {
        failures.push({ label, found })
        console.log(`✗ ${label}`)
        for (const f of found) console.log(`    rule ${f.rule}: ${f.what} — ${f.where}: ${f.detail}`)
        if (shotsDir) {
          const file = `${shotsDir}/${label.replace(/[^\w]+/g, '-')}.png`
          await page.screenshot({ path: file })
          console.log(`    ${file}`)
        }
        if (bail) { await page.close(); await browser.close(); process.exit(1) }
      } else if (verbose) {
        console.log(`✓ ${label}`)
      }
    }
  }
  console.log(`— ${size.name}: ${checked} checked, ${failures.length} failing so far`)
  await page.close()
}
await browser.close()

const secs = ((Date.now() - started) / 1000).toFixed(0)
console.log(`\n${checked} screens in ${secs}s across ${sizes.length} viewport(s)`)
if (!failures.length) { console.log('no findings'); process.exit(0) }
const byRule = new Map()
for (const f of failures) for (const x of f.found) byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1)
console.log(`${failures.length} screen(s) with findings: ` +
  [...byRule].sort().map(([r, n]) => `rule ${r} x${n}`).join(', '))
process.exit(1)
