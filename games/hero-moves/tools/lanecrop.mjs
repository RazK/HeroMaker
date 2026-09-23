import { chromium } from 'playwright'
import fs from 'node:fs'

/**
 * Dumps the exact picture each lane is judged from.
 *
 * Every wrong answer the lane tracker has given has turned out to be a
 * cropping question, and cropping questions are settled by looking at the
 * crop — not by reasoning about the arithmetic that produced it.
 *
 * Usage: lanecrop.mjs OUTDIR [--video=] [--players=3] [--at=20,26,32]
 */
const out = process.argv[2] ?? '/tmp/shots/crops'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const feed = flag('video', '/tmp/party/p3.y4m')
const players = Number(flag('players', 3))
const at = flag('at', '18,24,30').split(',').map(Number)
const meta = JSON.parse(fs.readFileSync(feed.replace(/\.y4m$/, '.json'), 'utf8'))
const base = flag('url', 'http://127.0.0.1:5183')

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${feed}`],
})
const page = await browser.newPage({ viewport: { width: 640, height: 420 } })
await page.context().grantPermissions(['camera'])
await page.goto(`${base}?lite=1`, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
await page.evaluate((n) => window.__api.setPlayers(n), players)
await page.evaluate(() => window.__api.wake())
await page.waitForFunction(() => window.__api.ready() === 'ready', null, { timeout: 180000 })

fs.mkdirSync(out, { recursive: true })
for (const t of at) {
  // Wait for the feed to reach this point of its loop, then grab every lane
  // from the same frame.
  await page.evaluate(({ want, dur }) => new Promise((done) => {
    const now = (window.__api.camClock() / 1000) % dur
    setTimeout(done, ((((want - now) % dur) + dur) % dur) * 1000)
  }), { want: t, dur: meta.duration })
  for (let i = 0; i < players; i++) {
    // Draw the skeleton the model read on top of the picture it read it from.
    // A crop that looks right and a skeleton that does not is a different bug
    // from a crop that is wrong, and only the overlay tells them apart.
    const d = await page.evaluate((n) => {
      const dbg = window.__api.laneDebug(n)
      if (!dbg.crop) return null
      return new Promise((done) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = 192; c.height = 192
          const g = c.getContext('2d')
          g.drawImage(img, 0, 0)
          // Lane keypoints are in lane widths on both axes; the crop is a
          // window inside that lane, so this is only ever indicative.
          g.fillStyle = '#ff2d78'
          for (const p of dbg.points) {
            if (p.s < 0.3) continue
            g.beginPath(); g.arc(p.x * 192, p.y * 192 * dbg.aspect, 3, 0, 7); g.fill()
          }
          done({ png: c.toDataURL('image/png'), label: dbg.label, distance: dbg.distance })
        }
        img.src = dbg.crop
      })
    }, i)
    if (!d) continue
    const f = `${out}/t${t}-lane${i}.png`
    fs.writeFileSync(f, Buffer.from(d.png.split(',')[1], 'base64'))
    console.log(`${f}  ${d.label ?? 'none'} @${d.distance}`)
    const pts = await page.evaluate((n) => window.__api.laneDebug(n).points, i)
    const show = ['leftShoulder', 'rightShoulder', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee', 'leftAnkle']
    console.log('   ' + pts.filter((p) => show.includes(p.name))
      .map((p) => `${p.name.replace('left', 'L').replace('right', 'R')}(${p.x},${p.y},${p.s})`).join(' '))
  }
}
await browser.close()
