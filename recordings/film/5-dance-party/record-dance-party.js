// Dance party, camera off: Violet's own dance on the stage, stepped clock, true 30 fps.
const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'https://frontend-staging-7cb8.up.railway.app/play/index.html?vrm=%2Fapi%2Ffiles%2F8ddf800b-e552-4439-b319-b1a4a3535183%2F26eef3df-315f-40f8-a6bd-b87716d34976%2Fopt_avatar.vrm&name=Violet%20Volt&back=%2Fhero%2F26eef3df-315f-40f8-a6bd-b87716d34976';
const OUT = process.argv[2], SECS = Number(process.argv[3] || 4), FPS = 30;
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.clock.install();
  await p.goto(URL, { waitUntil: 'load' });
  // Load in real time with the fake clock following, then settle.
  for (let i = 0; i < 120; i++) { await p.clock.runFor(100); await p.waitForTimeout(100); }
  // The stage only: the back button is chrome, not the show.
  await p.addStyleTag({ content: '.tb-corner--start { visibility: hidden !important; }' });
  const panel = await p.locator('.tb-panel.own').boundingBox();
  const clip = { x: 0, y: 0, width: Math.floor(panel.x), height: 390 };
  // PAUSE the clock: installed but not paused it keeps ticking with wall time, and
  // each ~1 s screenshot leaks into page time (2026-11-25's capture played far
  // too fast: 741 ms of page time per frame). Paused, runFor moves it exactly
  // 1/30 s (measured 34 ms, 2 animation frames) and fires the page's rAF.
  await p.clock.pauseAt(Date.now() + 1000);
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const w0 = Date.now();
  for (let f = 0; f < SECS * FPS; f++) {
    await p.clock.runFor(1000 / FPS);
    await p.screenshot({ path: `${OUT}/${String(f).padStart(5, '0')}.png`, clip });
  }
  console.log('clip', JSON.stringify(clip), 'frames', SECS * FPS, 'wall', ((Date.now() - w0) / 1000).toFixed(0), 's');
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
