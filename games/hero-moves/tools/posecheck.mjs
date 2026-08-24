import { chromium } from 'playwright'

/** Reports what each move scores when performed perfectly. See src/posecheck.ts. */
const base = process.argv[2] ?? 'http://127.0.0.1:5183'
const avatar = process.argv[3] ?? 'Gingerella'
const browser = await chromium.launch({
  executablePath: process.env.PW_EXE || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(`${base}/posecheck.html?a=${encodeURIComponent(avatar)}`, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 })
const rows = await page.evaluate(() => window.__rows)
await page.screenshot({ path: process.env.SHEET ?? '/tmp/shots/posecheck.png', fullPage: true })
await browser.close()
for (const r of rows) {
  if (r.error) { console.log(`${r.move.padEnd(14)} ${r.error}`); continue }
  console.log(`${r.move.padEnd(14)} ${r.score.toFixed(2)} ${r.grade.padEnd(8)} ` +
    r.worst.map((w) => `${w.limb} ${w.deg}deg`).join('  '))
}
const avg = rows.filter((r) => !r.error).reduce((a, r) => a + r.score, 0) / rows.length
console.log(`\nmean ${avg.toFixed(2)}`)
if (process.argv.includes('--raw')) {
  for (const r of rows.slice(0, 2)) {
    console.log(`\n${r.move} keypoints (x, y, score):`)
    for (const [k, v] of Object.entries(r.raw ?? {})) console.log(`  ${k.padEnd(15)} ${v.join('  ')}`)
  }
}
