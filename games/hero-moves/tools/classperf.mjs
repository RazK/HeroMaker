/**
 * Load time and frame rate of the class stage, live (not frame-stepped).
 *
 *   CLASS_API=https://<staging>  node tools/classperf.mjs [WxH] [seconds] [extra query]
 *   CLASS_FILES=<dir>            node tools/classperf.mjs ...
 *
 * Reports when the class list arrived, when each hero was downloaded and ready,
 * when all twelve were on stage, and the frame rate over the next N seconds.
 * Under SwiftShader (no GPU) the frame rate is a floor, not a forecast.
 */
import { launch, openStage } from './classlib.mjs'

const [size = '1280x720', secs = '10', query = ''] = process.argv.slice(2)
const [width, height] = size.split('x').map(Number)
const base = process.env.CLASS_URL ?? 'http://127.0.0.1:4194/class-stage.html'
const browser = await launch()
const { page, log, wall } = await openStage(browser, { url: `${base}?stats=1${query ? '&' + query : ''}`, width, height })
const perf = await page.evaluate(() => window.__perf)
const ready = Object.keys(perf).filter((k) => /^ready\d+$/.test(k)).map((k) => perf[k])
const dl = Object.keys(perf).filter((k) => /^dl\d+$/.test(k)).map((k) => perf[k])
const vrms = log.filter((l) => l.path.endsWith('.vrm'))
console.log(JSON.stringify({
  heroes: perf.heroes, failed: perf.failed, wallToReadyMs: wall, scriptStartMs: Math.round(perf.start),
  classListMs: perf.manifest, firstHeroReadyMs: Math.min(...ready), allHeroesReadyMs: perf.allReady,
  lastDownloadMs: Math.max(...dl), firstFrameMs: perf.compiled,
  vrmMB: +(vrms.reduce((s, l) => s + l.bytes, 0) / 1e6).toFixed(1),
  vrmFetchMs: { min: Math.min(...vrms.map((l) => l.ms)), max: Math.max(...vrms.map((l) => l.ms)) },
}))
const samples = []
for (let i = 0; i < Number(secs); i++) {
  await page.waitForTimeout(1000)
  samples.push(await page.evaluate(() => window.__fps ?? 0))
}
const info = await page.evaluate(() => window.__renderInfo())
const sorted = [...samples].sort((a, b) => a - b)
console.log(JSON.stringify({ size, query, fps: { median: +sorted[sorted.length >> 1].toFixed(1), min: +sorted[0].toFixed(1), max: +sorted.at(-1).toFixed(1) }, draws: info.calls, triangles: info.triangles }))
await browser.close()
