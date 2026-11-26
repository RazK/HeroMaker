// Raw real-speed recording of a cold load on a phone network (9 Mbps, 150 ms).
const { chromium } = require('playwright');
const fs = require('fs');
const B = 'https://frontend-staging-7cb8.up.railway.app';
const [tag, which] = process.argv.slice(2);
const HERO = '/hero/5622bb2a-2027-4693-a431-36703644ab95';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const dir = `rec-${tag}-${which}`; fs.rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, recordVideo: { dir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 });
  await page.setContent('<body style="margin:0;background:#fff6ea"></body>');
  await page.waitForTimeout(800);
  const t0 = Date.now();
  if (which === 'gallery') {
    await page.goto(B + '/gallery', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('img')].filter((im) => { const r = im.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && r.width > 60; }); return imgs.length >= 4 && imgs.every((im) => im.complete && im.naturalWidth > 0); }, null, { timeout: 120000, polling: 50 });
  } else {
    await page.goto(B + HERO, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const m = document.querySelector('.tb-dock-layer--moves'); return m && getComputedStyle(m).opacity === '1'; }, null, { timeout: 120000, polling: 50 });
  }
  const ms = Date.now() - t0;
  await page.waitForTimeout(2500);
  const version = await page.evaluate(() => fetch('https://backend-staging-384f.up.railway.app/api/version').then((r) => r.json()).then((j) => j.version).catch(() => '?'));
  await ctx.close();
  const vid = fs.readdirSync(dir).find((f) => f.endsWith('.webm'));
  fs.renameSync(`${dir}/${vid}`, `${tag}-${which}.webm`);
  console.log(JSON.stringify({ tag, which, ms, version, file: `${tag}-${which}.webm` }));
  await browser.close();
})();
