import { chromium } from 'playwright'

/**
 * Fails the build on text you cannot read.
 *
 * A cream heading on a cream card renders fine, throws no error and looks
 * correct in code review — it is only caught by someone squinting at a phone.
 * This walks every visible text node in the live DOM, resolves the colour it is
 * actually painted over (climbing past transparent ancestors and folding in
 * `opacity`), and reports anything below the WCAG AA ratio for its size.
 *
 * Usage: contrast.mjs [url] [--w=385] [--h=560] [--phase=title|results]
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5183/'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const W = Number(flag('w', 385)), H = Number(flag('h', 560))
const phase = flag('phase', 'title')

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await page.goto(url, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.__ready === true || String(window.__ready ?? '').startsWith('error'),
  null, { timeout: 300000 })

if (phase !== 'title') {
  await page.evaluate(() => window.__api.start())
  await page.waitForFunction((p) => window.__api.phase() === p, phase, { timeout: 180000 })
}

const findings = await page.evaluate(() => {
  const parse = (c) => {
    const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]
    return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }
  }
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
  })
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }

  /** The colour actually painted behind `el`, folding in ancestor opacity. */
  const backdrop = (el) => {
    let acc = { r: 21, g: 15, b: 38, a: 1 } // the WebGL stage behind everything
    const chain = []
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) chain.push(n)
    for (const n of chain.reverse()) {
      const cs = getComputedStyle(n)
      const bg = parse(cs.backgroundColor)
      const o = Number(cs.opacity)
      if (bg.a > 0) acc = over({ ...bg, a: bg.a * o }, acc)
    }
    return acc
  }

  const out = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.nodeValue.trim()
    if (!text) continue
    const el = n.parentElement
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const box = el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue

    // Effective opacity of the text itself is the product down the chain.
    let o = 1
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) o *= Number(getComputedStyle(a).opacity)
    const fg = parse(cs.color)
    const painted = over({ ...fg, a: fg.a * o }, backdrop(el))
    const r = ratio(painted, backdrop(el))

    const px = parseFloat(cs.fontSize)
    const bold = Number(cs.fontWeight) >= 700
    const large = px >= 24 || (bold && px >= 18.66)
    const need = large ? 3 : 4.5
    if (r < need) {
      out.push({
        text: text.slice(0, 40), sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        ratio: +r.toFixed(2), need, px: +px.toFixed(0),
      })
    }
  }
  return out
})

await browser.close()
if (!findings.length) { console.log(`contrast OK (${phase} @ ${W}x${H})`); process.exit(0) }
console.log(`${findings.length} unreadable at ${phase} @ ${W}x${H}:`)
for (const f of findings) console.log(`  ${f.ratio}:1 (needs ${f.need}) ${f.px}px  ${f.sel}  "${f.text}"`)
process.exit(1)
