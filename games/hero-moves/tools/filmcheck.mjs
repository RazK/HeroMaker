/**
 * Drives the film and greeting players like a parent would, in a real browser:
 *
 *  1. film.html — loads, Play, plays in real time until the fake door freezes
 *     it, taps "Unlock", and screenshots each state.
 *  2. greeting.html — taps "Save video", waits for the recorder to finish and
 *     the download to arrive, and transcodes it to MP4 with ffmpeg — the same
 *     step a server would run for WhatsApp and iOS.
 *  3. Screenshots both players at the brand book's four viewports.
 *
 *   node tools/filmcheck.mjs <outDir> --vrm=/api/files/<u>/<c>/opt_avatar.vrm --name=... --artist=... \
 *     --files=<mirror of /api/files> --fonts=<Google Fonts copy>
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require('playwright') } catch { return require('/opt/node22/lib/node_modules/playwright') }
})()

const outDir = process.argv[2]
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const base = flag('url', 'http://127.0.0.1:4192')
const files = flag('files', ''), fontsDir = flag('fonts', '')
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'
fs.mkdirSync(outDir, { recursive: true })
const q = (extra) => new URLSearchParams({ vrm: flag('vrm', ''), name: flag('name', ''), artist: flag('artist', ''), age: flag('age', ''), ...extra })

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})

async function open(viewport, url) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  if (files) await page.route('**/api/files/**', (route) => {
    const p = path.join(files, decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/api\/files\//, '')))
    return fs.existsSync(p) ? route.fulfill({ status: 200, body: fs.readFileSync(p) }) : route.fulfill({ status: 404 })
  })
  if (fontsDir) {
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(path.join(fontsDir, 'fonts.css'), 'utf8') }))
    await page.route('https://fonts.gstatic.com/**', (r) => {
      const p = path.join(fontsDir, new URL(r.request().url()).pathname.slice(1).replace(/\//g, '_'))
      return fs.existsSync(p) ? r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(p) }) : r.abort()
    })
  }
  await page.goto(url, { waitUntil: 'load', timeout: 180000 })
  await page.waitForSelector('.film-bigplay:not([hidden])', { timeout: 300000 })
  return { ctx, page }
}
const shot = (page, name) => page.screenshot({ path: path.join(outDir, name) }).then(() => console.log('  ', name))

// 1. The film, through the fake door.
{
  const { ctx, page } = await open({ width: 390, height: 844 }, `${base}/film.html?${q({ story: flag('story', 'birthday') })}`)
  await shot(page, 'film-ready-390x844.png')
  const t0 = Date.now()
  await page.click('.tb-btn--primary')
  await page.waitForTimeout(4000)
  await shot(page, 'film-playing-390x844.png')
  await page.waitForSelector('.film-paywall', { timeout: 120000 })
  const at = await page.evaluate(() => window.__player.now())
  console.log(`paywall after ${((Date.now() - t0) / 1000).toFixed(1)}s wall, film time ${at.toFixed(2)}s`)
  await page.waitForTimeout(600)
  await shot(page, 'film-paywall-390x844.png')
  await page.click('.film-paywall .tb-btn--primary')
  await page.waitForTimeout(400)
  await shot(page, 'film-paywall-clicked-390x844.png')
  console.log('fake door log:', JSON.stringify(await page.evaluate(() => window.__door)))
  await ctx.close()
}

// 2. A greeting, saved as a real video file by the browser.
{
  const { ctx, page } = await open({ width: 390, height: 844 }, `${base}/greeting.html?${q({ occasion: flag('occasion', 'birthday'), to: flag('to', 'Savta') })}`)
  await shot(page, 'greeting-ready-390x844.png')
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 180000 }),
    page.click('.tb-btn--secondary'),
  ])
  const saved = path.join(outDir, download.suggestedFilename())
  await download.saveAs(saved)
  console.log('browser saved', saved, fs.statSync(saved).size, 'bytes', JSON.stringify(await page.evaluate(() => window.__saved)))
  await page.waitForTimeout(500)
  await shot(page, 'greeting-saved-390x844.png')
  if (!saved.endsWith('.mp4')) {
    const mp4 = saved.replace(/\.[^.]+$/, '.mp4')
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', saved, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-movflags', '+faststart', mp4])
    console.log('transcoded', mp4, fs.statSync(mp4).size, 'bytes')
  }
  await ctx.close()
}

// 3. The brand book's viewports.
for (const [w, h] of [[360, 640], [390, 844], [844, 390], [1280, 800]]) {
  for (const p of ['film', 'greeting']) {
    const { ctx, page } = await open({ width: w, height: h }, `${base}/${p}.html?${q({})}`)
    await shot(page, `${p}-${w}x${h}.png`)
    await ctx.close()
  }
}
await browser.close()
