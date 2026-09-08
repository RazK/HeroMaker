import { chromium } from 'playwright'
/**
 * Measures how fast MoveNet actually runs here, with the fake camera attached.
 *
 * With several players this is per *lane*: lanes are inferred round robin, one
 * per frame, so a lane refreshes at this rate divided by the player count.
 *
 * Usage: trackrate.mjs URL [feed.y4m] [players]
 */
const feed = process.argv[3] ?? '/tmp/party/p3.y4m'
const players = Number(process.argv[4] ?? 3)
const b = await chromium.launch({ executablePath: process.env.PW_EXE,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox',
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${feed}`] })
const ctx = await b.newContext({ viewport:{width:900,height:600}, permissions:['camera'] })
const p = await ctx.newPage()
await p.goto(process.argv[2], { waitUntil:'load', timeout:180000 })
await p.waitForFunction(() => window.__ready === true, null, { timeout:300000 })
await p.evaluate((n) => window.__api.setPlayers(n), players)
await p.evaluate(() => window.__api.wake())
await p.waitForFunction(() => window.__api.ready() === 'ready', null, { timeout: 180000 })
await p.waitForTimeout(25000)
const t = await p.evaluate(() => window.__api.tracker())
console.log('tracker:', JSON.stringify(t))
console.log(`${players} lane(s): ${(t.fps / players).toFixed(2)} refreshes per lane per second`)
await b.close()
