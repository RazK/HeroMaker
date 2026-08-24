import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Loads the packed page over a throttled connection and screenshots the boot
 * sequence, so the splash and its progress can actually be reviewed rather than
 * assumed. Reports when the page first paints and when it becomes playable.
 */
const url = process.argv[2] ?? 'http://127.0.0.1:5197/'
const outDir = process.argv[3] ?? '/tmp/load'
const kbps = Number(process.env.KBPS ?? 1600)
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 1 })
const cdp = await page.context().newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: 90,
  downloadThroughput: (kbps * 1024) / 8,
  uploadThroughput: (kbps * 1024) / 8,
})

// Screenshots block on web fonts, and this sandbox has no route to Google
// Fonts — fail those requests fast so the capture reflects the boot sequence.
await page.route('**://fonts.googleapis.com/**', (r) => r.abort())
await page.route('**://fonts.gstatic.com/**', (r) => r.abort())

const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const t0 = Date.now()
const marks = {}
page.goto(url, { waitUntil: 'commit', timeout: 300000 })

const shots = [1200, 3000, 6000, 10000, 16000, 24000, 40000, 60000]
let i = 0
while (i < shots.length) {
  const wait = shots[i] - (Date.now() - t0)
  if (wait > 0) await page.waitForTimeout(wait)
  const state = await page.evaluate(() => ({
    splash: !!document.getElementById('splash'),
    fill: document.getElementById('splashFill')?.style.width ?? null,
    what: document.getElementById('splashWhat')?.textContent ?? null,
    ready: window.__ready ?? null,
    readyAt: window.__hdReadyAt ?? null,
  })).catch(() => null)
  if (state) {
    if (!marks.firstPaint && state.what) marks.firstPaint = Date.now() - t0
    if (!marks.playable && state.readyAt) marks.playable = state.readyAt
    // Playwright's screenshot blocks on web fonts, which never resolve here;
    // CDP captures the frame as-is.
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (shot) {
      fs.writeFileSync(path.join(outDir, `load-${String(shots[i]).padStart(5, '0')}ms.png`), Buffer.from(shot.data, 'base64'))
    }
    console.log(`${String(Date.now() - t0).padStart(6)}ms  splash=${state.splash} fill=${state.fill ?? '-'} "${state.what ?? ''}" ready=${state.ready}`)
  }
  if (state?.ready === true && i >= 3) break
  i++
}

console.log(`\n@${kbps} kbps: first paint ${marks.firstPaint ?? '?'}ms, playable ${marks.playable ?? 'not yet'}ms`)
console.log('errors:', errors.slice(0, 5).join(' | ') || 'none')
await browser.close()
