import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

/**
 * The core-visual gate for animation clips.
 *
 * The playbook's first rule is to validate the core visual before building
 * around it: produce a still of the *actual play camera* framing a real avatar
 * and check it against the pitch. A clip that reads beautifully in the
 * animation lab, on its own camera at desktop size, tells you nothing about
 * whether a 30%-head hero mid-backflip is legible on a 385x560 phone.
 *
 * Usage: clipframing.mjs out.png [--w=385] [--h=560] [--clip=backflip] [--t=0.45]
 */
const out = process.argv[2] ?? '/tmp/shots/clipframing.png'
const flag = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(hit.indexOf('=') + 1) : d
}
const W = Number(flag('w', 385)), H = Number(flag('h', 560))
const clip = flag('clip', 'backflip')
const settle = Number(flag('settle', 900))
const base = flag('url', 'http://127.0.0.1:5183')
const heroes = (flag('heroes', '0,1,3,5')).split(',').map(Number)
const FFMPEG = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg'

const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await page.goto(base, { waitUntil: 'load', timeout: 180000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
await page.waitForFunction(() => window.__api.clipsReady?.() === true, null, { timeout: 300000 })

const shots = []
for (const i of heroes) {
  await page.evaluate((n) => window.__api.pickLeader(n), i)
  await page.waitForFunction(() => window.__api.clipsReady?.() === true, null, { timeout: 300000 })
  await page.evaluate((c) => window.__api.perform(c, 'leader'), clip)
  await page.waitForTimeout(settle)
  const f = out.replace(/\.png$/, `-${i}.png`)
  await page.screenshot({ path: f })
  shots.push(f)
  console.log(`  hero ${i} -> ${f}`)
}
await browser.close()

execFileSync(FFMPEG, ['-y', '-loglevel', 'error',
  ...shots.flatMap((f) => ['-i', f]),
  '-filter_complex', `hstack=${shots.length}`, out])
console.log(`\n${out}`)
