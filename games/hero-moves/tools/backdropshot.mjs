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
 *   node tools/backdropshot.mjs /tmp/shots/bg --leak=1     # cycle themes, watch the GPU
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

  // Switching themes has to be free. Three passes over every backdrop, with the
  // GPU's own counters read after each: if a theme forgets to dispose a texture
  // the count climbs one pass to the next, and this is the only cheap way to
  // see that before a player's phone does.
  if (flag('leak', '') === '1' && view.id === 'desktop') {
    const passes = []
    for (let p = 0; p < 3; p++) {
      for (const bg of await page.evaluate(() => window.__backdrops.map((b) => b.id))) {
        await page.evaluate((id) => window.__setBackdrop(id), bg)
      }
      passes.push(await page.evaluate(() => window.__gpu()))
      console.log(`  leak pass ${p + 1}:`, JSON.stringify(passes[p]))
    }
    const [, b, c] = passes
    const grew = c.geometries > b.geometries || c.textures > b.textures
    console.log(grew ? '  LEAK: GPU objects grew between passes' : '  leak check: steady')
  }

  // Per-theme cost, measured rather than argued: draw calls, triangles, and the
  // CPU time the backdrop's own update() takes per frame.
  if (flag('stats', '') === '1' && view.id === 'desktop') {
    for (const bg of await page.evaluate(() => window.__backdrops.map((b) => b.id))) {
      await page.evaluate((id) => window.__setBackdrop(id), bg)
      await page.waitForTimeout(1500)
      console.log('  stats', JSON.stringify(await page.evaluate(() => window.__stats())))
    }
  }

  const cdp = await page.context().newCDPSession(page)
  // Heroes outer, backdrops inner: switching a theme is a few canvases, but
  // loading an avatar is a megabyte of VRM parsed in software. Iterating the
  // other way round reloaded a hero for every single shot and took four times
  // as long. Files are named with the tile index they belong at, so the sheet
  // still comes out one row per backdrop.
  const shots = []
  for (let h = 0; h < heroes.length; h++) {
    await page.evaluate((x) => window.__setHeroes([x]), heroes[h])
    for (let b = 0; b < list.length; b++) {
      await page.evaluate((id) => window.__setBackdrop(id), list[b])
      await page.waitForTimeout(settle)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const idx = b * heroes.length + h
      const f = path.join(outDir,
        `${view.id}-${String(idx).padStart(3, '0')}-${list[b]}-${heroes[h]}.png`)
      fs.writeFileSync(f, Buffer.from(shot.data, 'base64'))
      shots.push(f)
      console.log('  ', path.basename(f))
    }
  }
  const files = shots.sort()
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
