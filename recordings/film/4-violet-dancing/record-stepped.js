// Deterministic capture: a fake clock drives rAF and performance.now; step 1/30 s, screenshot, repeat.
const { chromium } = require('playwright');
const fs = require('fs');
const HERO = 'https://frontend-staging-7cb8.up.railway.app/hero/26eef3df-315f-40f8-a6bd-b87716d34976';
const OUT = process.argv[2], SECS = Number(process.argv[3] || 4), FPS = 30;
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto(HERO, { waitUntil: 'load' });
  // Let the page load and the hero appear, moving the fake clock in real time while we wait.
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await p.clock.runFor(200);
    if (await p.evaluate(() => document.querySelector('.tb-hero-screen')?.getAttribute('data-state') === 'ready' && !!document.querySelector('.tb-live-stage canvas'))) break;
    await p.waitForTimeout(150);
  }
  for (let i = 0; i < 60; i++) { await p.clock.runFor(100); await p.waitForTimeout(100); } // ~6 s of settle, models load
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const w0 = Date.now();
  for (let f = 0; f < SECS * FPS; f++) {
    await p.clock.runFor(1000 / FPS);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())).catch(() => {})).catch(() => {});
    await p.screenshot({ path: `${OUT}/${String(f).padStart(5, '0')}.png` });
  }
  console.log('captured', SECS * FPS, 'frames in', ((Date.now() - w0) / 1000).toFixed(1), 's wall');
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
