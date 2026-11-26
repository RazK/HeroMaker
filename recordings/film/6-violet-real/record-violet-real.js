// Stepped-clock, true 30 fps captures of Violet's staging hero (26eef3df) for Tom's
// real-footage reel. Playwright's fake clock drives rAF/timers: step 1/30 s, wait a
// frame, screenshot, repeat. Network still loads in wall time. No paid calls.
//
// The clock is PAUSED before recording (clock.pauseAt). Installed but not paused,
// it keeps ticking with wall time, so every screenshot's ~1 s leaks into page time
// and a "30 fps" capture plays many times too fast (measured: 741 ms of page time
// per frame unpaused, 34 ms paused).
//
//   node violet-real.js arrival  OUT   # load -> drawing -> painting -> 3D reveal + 3 s
//   node violet-real.js move     OUT Wave|Flip|Punch   # 4 s from the tap
//   node violet-real.js tab      OUT Drawing|Painting  # 3 s from the tap
//   node violet-real.js rumble   OUT   # landscape, 6 s, no camera
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://frontend-staging-7cb8.up.railway.app';
const ID = '26eef3df-315f-40f8-a6bd-b87716d34976';
const OWNER = '8ddf800b-e552-4439-b319-b1a4a3535183';
const VRM = `/api/files/${OWNER}/${ID}/opt_avatar.vrm`;
const [mode, OUT, arg] = process.argv.slice(2);
const FPS = 30;
const steps = [];
let frame = 0;
const mark = (what) => { steps.push({ frame, t: +(frame / FPS).toFixed(3), what }); console.log(`[${frame}] ${what}`); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const land = mode === 'rumble';
  const ctx = await b.newContext({ viewport: land ? { width: 844, height: 390 } : { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.clock.install();
  fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
  const shot = async () => {
    // runFor fires the page's rAF callbacks for that 1/30 s (with the clock
    // paused a rAF awaited here would never come); the screenshot then makes
    // the browser composite that frame.
    await p.clock.runFor(1000 / FPS);
    await p.screenshot({ path: `${OUT}/${String(frame).padStart(5, '0')}.png` });
    frame++;
  };
  const record = async (secs) => { for (let i = 0; i < secs * FPS; i++) await shot(); };
  // The fake clock started at wall time and ticks with it: 1 s ahead is always the future.
  const pause = async () => { await p.clock.pauseAt(Date.now() + 1000); };
  // Load in wall time with the page clock following (not recorded).
  const settle = async (pred, max = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < max) { await p.clock.runFor(100); if (await p.evaluate(pred).catch(() => false)) return true; await p.waitForTimeout(100); }
    return false;
  };
  const heroReady = () => { const m = document.querySelector('.tb-dock-layer--moves'); return !!m && getComputedStyle(m).opacity === '1'; };

  if (mode === 'arrival') {
    // The page's own intro (HeroLive): the drawing, then (1 s after the drawing
    // and painting have loaded) the painting, then (1 s after the 3D is shown)
    // the live hero. Page time is held still while the network loads in wall
    // time, so the intro waits on the drawing; then recording plays it through
    // at true speed. What the film shows is the intro as it runs on a fast phone.
    await p.goto(`${BASE}/hero/${ID}`, { waitUntil: 'commit' });
    await pause();
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      const ok = await p.evaluate(() => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') === 'drawing'
        && [...document.querySelectorAll('.tb-live-stage img')].some((i) => i.complete && i.naturalWidth > 0)).catch(() => false);
      if (ok) break;
      await p.waitForTimeout(250);
    }
    await p.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    mark('on the drawing (the intro starts here)');
    let seen = 'drawing';
    while (frame < 20 * FPS) {
      await shot();
      const slide = await p.evaluate(() => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') || '').catch(() => '');
      if (slide && slide !== seen) { mark(`on the ${slide} slide`); seen = slide; }
      if (seen === 'hero' && await p.evaluate(heroReady).catch(() => false)) { mark('3D Violet live, moves shown'); break; }
    }
    await record(3);
    mark('end');
  } else if (mode === 'move' || mode === 'tab') {
    await p.goto(`${BASE}/hero/${ID}`, { waitUntil: 'load' });
    if (!(await settle(heroReady))) throw new Error('hero never got its moves');
    await p.waitForTimeout(3000); // models settle, clock ticking with wall time
    await pause();
    await record(0.5);
    if (mode === 'move') {
      const btn = p.locator('.tb-moves button', { hasText: arg });
      await btn.click({ noWaitAfter: true });
      mark(`tapped ${arg}`);
      await record(4);
    } else {
      const tile = p.locator('.tb-chapter', { hasText: arg });
      await tile.click({ noWaitAfter: true });
      mark(`tapped the ${arg} tab`);
      await record(3);
    }
    mark('end');
  } else if (mode === 'rumble') {
    await p.goto(`${BASE}/play/arena.html?vrm=${encodeURIComponent(VRM)}&name=Violet%20Volt&back=${encodeURIComponent('/hero/' + ID)}`, { waitUntil: 'load' });
    await p.waitForTimeout(12000); // loads and starts, clock ticking with wall time
    await pause();
    mark('Robot Rumble with Violet, no camera, no player input');
    await record(6);
    mark('end');
  } else throw new Error('mode?');
  fs.writeFileSync(`${OUT}/steps.json`, JSON.stringify({ hero: ID, url: p.url().replace(/\?.*/, ''), mode, arg: arg || null, viewport: land ? '844x390' : '390x844', deviceScaleFactor: 2, fps: FPS, frames: frame, method: 'stepped clock (Playwright clock.install + runFor 1/30 s per frame), staging', steps }, null, 2));
  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
