/**
 * Contact sheets for the backdrop lab.
 *
 * Every theme, with a real hero standing in front of it, at a desktop and a
 * phone viewport — because a backdrop that looks rich in a wide shot can put a
 * skyline straight through a hero's face once the camera solves for a portrait
 * phone, and the only way to know is to look.
 *
 * The heroes default to the three that matter most for contrast: the pale white
 * cloud, the yellow star and a plain humanoid.
 *
 *   node tools/backdropshot.mjs /tmp/shots/bg
 *   node tools/backdropshot.mjs /tmp/shots/bg --heroes=Cloudy --q=lite --bg=space,reef
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const outDir = process.argv[2] ?? '/tmp/shots/bg'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const base = flag('url', 'http://127.0.0.1:5183')
const heroes = flag('heroes', 'Cloudy,Superstar,Crayon_Kid').split(',')
const quality = flag('q', 'full')
const settle = Number(flag('settle', 900))
const only = flag('bg', '')
const VIEWS = [
  { id: 'desktop', w: Number(flag('w', 1280)), h: Number(flag('h', 720)), scale: 640 },
  { id: 'phone', w: 390, h: 844, scale: 300 },
]
const FFMPEG = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg'

fs.mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})

const sheets = []
for (const view of VIEWS) {
  const page = await browser.newPage({
    viewport: { width: view.w, height: view.h }, deviceScaleFactor: 1,
  })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()) })

  const url = `${base}/backdrops.html?a=${heroes[0]}&q=${quality}`
  await page.goto(url, { waitUntil: 'load', timeout: 180000 })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
  const all = await page.evaluate(() => window.__backdrops.map((b) => b.id))
  const list = only ? only.split(',').filter((id) => all.includes(id)) : all
  console.log(`[${view.id}] ${view.w}x${view.h} · ${list.length} backdrops x ${heroes.length} heroes`)

  const cdp = await page.context().newCDPSession(page)
  const files = []
  for (const bg of list) {
    await page.evaluate((id) => window.__setBackdrop(id), bg)
    for (const hero of heroes) {
      await page.evaluate((h) => window.__setHeroes([h]), hero)
      await page.waitForTimeout(settle)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const f = path.join(outDir, `${view.id}-${String(files.length).padStart(3, '0')}-${bg}-${hero}.png`)
      fs.writeFileSync(f, Buffer.from(shot.data, 'base64'))
      files.push(f)
      console.log('  ', path.basename(f))
    }
  }
  await page.close()

  // One row per backdrop, one column per hero.
  const cols = heroes.length
  const rows = Math.ceil(files.length / cols)
  const listFile = path.join(outDir, `${view.id}.txt`)
  fs.writeFileSync(listFile, files.map((f) => `file '${f}'`).join('\n'))
  const sheet = path.join(outDir, `sheet-${view.id}.png`)
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-r', '1', '-i', listFile,
    '-vf', `scale=${view.scale}:-1,tile=${cols}x${rows}:padding=6:margin=6:color=0x14121a`,
    '-frames:v', '1', sheet])
  sheets.push(sheet)
  console.log('sheet:', sheet)
}

await browser.close()
console.log(sheets.join('\n'))
