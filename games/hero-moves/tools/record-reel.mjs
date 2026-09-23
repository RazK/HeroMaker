import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Records the Stunt Reel prototype: build a routine, play it, hit a combo.
 * Drives the real UI hooks, so what is recorded is what a player would get.
 */
const out = process.argv[2] ?? '/tmp/demo/reel.mp4'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const W = Number(flag('w', 430)), H = Number(flag('h', 780))
const base = flag('url', 'http://127.0.0.1:5183')
const FFMPEG = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg'

const videoDir = fs.mkdtempSync('/tmp/hm-reel-')
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required'],
})
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: videoDir, size: { width: W, height: H } },
})
const page = await context.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const started = Date.now()
await page.goto(`${base}/reel.html`, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
const readySeconds = (Date.now() - started) / 1000
await page.waitForTimeout(2500)

/** Tap the deck the way a player would, so the UI state is real. */
async function tap(label) {
  const btn = page.locator('.reel-card', { hasText: label }).first()
  await btn.click()
  await page.waitForTimeout(650)
}

// A routine containing two combos: FLY into LANDING is the superhero landing,
// and PUNCH PUNCH VICTORY is the knockout.
for (const m of (flag('routine', 'Fly,Landing,Punch,Punch,Victory')).split(',')) await tap(m)
await page.waitForTimeout(900)
await page.locator('.btn', { hasText: 'PLAY THE REEL' }).click()

// Let the whole routine run; the clips are a few seconds each.
await page.waitForFunction(() => window.__reel.playing() === true, null, { timeout: 20000 })
await page.waitForFunction(() => window.__reel.playing() === false, null, { timeout: 180000 })
await page.waitForTimeout(3000)

await context.close()
await browser.close()

const webm = fs.readdirSync(videoDir).map((f) => path.join(videoDir, f)).find((f) => f.endsWith('.webm'))
if (!webm) { console.error('no video'); process.exit(1) }
fs.mkdirSync(path.dirname(out), { recursive: true })
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, readySeconds - 1)), '-i', webm,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-movflags', '+faststart', out])
fs.rmSync(videoDir, { recursive: true, force: true })
console.log(`${out}  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`)
