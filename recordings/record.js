// node record.js <flow>  -> rec/<flow>/<flow>.webm + steps.json (real speed, phone 390x844, staging, signed out)
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://frontend-staging-7cb8.up.railway.app';
const TOY = 'b4acf85a-a135-462d-b19b-5c4fc0d50793';
const flow = process.argv[2];
const out = `${__dirname}/${flow}`;
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { localStorage.setItem('heromaker_adult_confirmed', '1'); });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
  const p = await ctx.newPage();
  // Chrome's own screencast, at device pixels (780x1688): every frame with its time.
  fs.mkdirSync(`${out}/frames`);
  const cdp = await ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const n = frames.length;
    fs.writeFileSync(`${out}/frames/${String(n).padStart(6, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    frames.push(f.metadata.timestamp);
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  const t0 = Date.now();
  const steps = [];
  const mark = (name) => { const t = (Date.now() - t0) / 1000; steps.push({ step: name, at: +t.toFixed(1) }); console.log(t.toFixed(1), name); };
  const tap = async (loc) => { await loc.waitFor({ timeout: 60000 }); await loc.click(); };
  const goChapter = async (key) => {
    const slides = (await p.locator('.tb-live-stage').getAttribute('data-slides')).split(',').map((k) => k.replace(/-.*$/, ''));
    if ((await p.locator('.tb-live-stage').getAttribute('data-slide')) === key) return;
    await tap(p.locator('.tb-chapter').nth(slides.indexOf(key)));
    await p.waitForFunction((k) => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') === k, key, { timeout: 30000 });
  };
  if (flow === 'collector-toy') {
    await p.goto(`${BASE}/hero/${TOY}`, { waitUntil: 'load' });
    await p.waitForFunction(() => { const m = document.querySelector('.tb-dock-layer--moves'); return m && getComputedStyle(m).opacity === '1'; }, null, { timeout: 120000 });
    mark('hero page: the 3D hero, ready');
    await p.waitForTimeout(3000);
    await p.waitForFunction(() => (document.querySelector('.tb-live-stage')?.getAttribute('data-slides') || '').includes('figure'), null, { timeout: 90000 });
    await goChapter('figure');
    await p.waitForFunction(() => !!document.querySelector('.tb-figure-room canvas') && !document.querySelector('.tb-parts-loading'), null, { timeout: 120000 });
    mark('toy slide: the hero as a printable toy');
    await p.waitForTimeout(5000);
    const apart = p.locator('.tb-dock-layer .tb-figure-apart');
    await tap(apart);
    await p.waitForFunction(() => document.querySelector('.tb-dock-layer .tb-figure-apart')?.getAttribute('aria-pressed') === 'true', null, { timeout: 60000 });
    mark('tapped Take apart: the pieces come apart, arrows show where each clicks in');
    await p.waitForTimeout(7000);
    await tap(apart);
    await p.waitForFunction(() => document.querySelector('.tb-dock-layer .tb-figure-apart')?.getAttribute('aria-pressed') === 'false', null, { timeout: 60000 });
    mark('tapped Put together: the toy clicks back');
    await p.waitForTimeout(5000);
    mark('Print file button (download for a 3D printer)');
    await p.locator('.tb-dock-layer').getByText('Print file').first().hover().catch(() => {});
    await p.waitForTimeout(4000);
    mark('end');
  } else if (flow === 'kid-happy') {
    const HERO = process.env.HERO || '5622bb2a-2027-4693-a431-36703644ab95';
    await p.goto(`${BASE}/hero/${HERO}`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') === 'hero', null, { timeout: 120000 });
    await p.waitForFunction(() => { const m = document.querySelector('.tb-dock-layer--moves'); return m && getComputedStyle(m).opacity === '1'; }, null, { timeout: 60000 });
    mark('the hero, ready to move');
    await p.waitForTimeout(2000);
    await tap(p.locator('.tb-move[data-move="dance"]').first());
    mark('tapped Dance');
    await p.waitForTimeout(5000);
    await tap(p.locator('.tb-move[data-move="backflip"]').first());
    mark('tapped Flip: a backflip');
    await p.waitForTimeout(4000);
    await tap(p.locator('.tb-play').first());
    await p.locator('.tb-games-sheet').waitFor({ timeout: 30000 });
    mark('tapped Play: pick a game');
    await p.waitForTimeout(3000);
    await tap(p.locator('.tb-game[data-game="arena"]'));
    await p.waitForURL(/\/play\/arena\.html/, { timeout: 30000 });
    await p.waitForFunction(() => window.__ready !== undefined, null, { timeout: 120000 });
    mark('Robot Rumble opens with this hero');
    await p.waitForTimeout(3000);
    await tap(p.locator('.rr-start'));
    await p.waitForFunction(() => window.__phase === 'play', null, { timeout: 30000 });
    mark('tapped Start: the round begins');
    const kb = p.keyboard;
    for (const [key, ms] of [['ArrowRight', 1200], ['j', 0], ['ArrowUp', 900], ['j', 0], ['k', 0], ['ArrowLeft', 1200], ['j', 0], ['j', 0], ['ArrowDown', 900], ['k', 0], ['j', 0], ['ArrowRight', 1500], ['j', 0], ['j', 0]]) {
      if (ms) { await kb.down(key); await p.waitForTimeout(ms); await kb.up(key); } else { await kb.press(key); await p.waitForTimeout(700); }
    }
    mark('played: move, punch, jump');
    await p.waitForTimeout(2000);
    await tap(p.locator('.rr-back-slot .tb-nav, .rr-back-slot button').first());
    await p.waitForURL((u) => u.pathname.startsWith('/hero/'), { timeout: 30000 });
    await p.locator('.tb-share').waitFor({ timeout: 60000 });
    mark('back on the hero');
    await p.waitForTimeout(3000);
    await tap(p.locator('.tb-share').first());
    mark('tapped Share: the link is copied, to send to family');
    await p.waitForTimeout(4000);
    mark('end');
  } else if (flow === 'buy-credits') {
    // A fresh test account (deleted at the end, as the robot does).
    const stamp = Date.now().toString(36);
    const u = { username: `rec_${stamp}`, email: `robot+rec${stamp}@example.com`, password: `rec-${stamp}-pw` };
    await p.goto(BASE + '/', { waitUntil: 'load' });
    await tap(p.locator('.header-auth-button'));
    const grownUp = p.getByRole('dialog', { name: 'Is a grown-up with you?' });
    await grownUp.waitFor({ timeout: 15000 });
    await grownUp.getByRole('button', { name: 'Yes' }).click();
    await p.locator('#username').waitFor({ timeout: 15000 });
    await p.locator('button.auth-modal-tab').click();
    await p.fill('#username', u.username); await p.fill('#email', u.email); await p.fill('#name', 'Robot Tester');
    await p.fill('#dateOfBirth', '2000-01-01'); await p.fill('#password', u.password);
    await p.locator('button.auth-modal-submit').click();
    const coin = p.locator('.header-auth-credits');
    await coin.waitFor({ timeout: 30000 });
    const token = await p.evaluate(() => localStorage.getItem('heromaker_jwt_token'));
    const api = async (path, init = {}) => (await fetch(BASE.replace('frontend-staging-7cb8', 'backend-staging-384f') + path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } }));
    const credits = async () => (await (await api('/api/v1/me')).json()).credits;
    try {
      await p.waitForTimeout(3000);
      mark(`signed in, ${await coin.innerText()} credits (setup ends here)`);
      await p.waitForTimeout(2000);
      await tap(coin);
      const pack = p.locator('.buy-credits-pack[data-pack="single"]');
      await pack.waitFor({ timeout: 20000 });
      mark('tapped the coin: Buy credits, pick a pack');
      await p.waitForTimeout(4000);
      await tap(pack);
      await p.waitForURL((x) => x.pathname.startsWith('/api/payments/sandbox/checkout/'), { timeout: 60000 });
      await p.waitForLoadState('domcontentloaded');
      const orderPage = p.url();
      mark(`picked One hero, ₪10: the TEST checkout ("${(await p.locator('.amount').innerText().catch(() => '?')).trim()}")`);
      await p.waitForTimeout(4000);
      await p.getByRole('button', { name: 'Pay', exact: true }).click();
      await p.waitForURL((x) => x.toString().startsWith(BASE) && !x.pathname.startsWith('/api/payments/sandbox/'), { timeout: 60000 });
      mark('tapped Pay: back in the app');
      const back = Date.now();
      let n = 0;
      while (Date.now() - back < 60000 && n < 10) { await p.waitForTimeout(1000); n = Number((await coin.innerText().catch(() => '0')).trim()) || 0; }
      mark(`credits added: the coin shows ${n}`);
      await p.waitForTimeout(5000);
      const receipts = await (await api('/api/v1/receipts')).json();
      fs.writeFileSync(`${out}/proof.json`, JSON.stringify({ checkout_page: orderPage, balance_after: await credits(), receipts }, null, 1));
      console.log('PROOF', JSON.stringify(receipts));
      mark('end');
    } finally {
      const r = await api('/api/v1/me', { method: 'DELETE', body: JSON.stringify({ confirm: u.username }) });
      console.log('deleted test account', u.username, r.status);
    }
  } else if (flow === 'visitor') {
    await p.goto(BASE + '/', { waitUntil: 'load' });
    const item = p.locator('.creation-gallery-item.creation-gallery-status-completed').first();
    await item.waitFor({ timeout: 60000 });
    await item.click();
    await p.waitForURL(/\/hero\//, { timeout: 30000 });
    const link = p.url();
    // Start again as someone who got the link: fresh page, straight to the hero.
    await p.goto('about:blank');
    mark('opens a shared link');
    await p.goto(link, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') === 'hero', null, { timeout: 120000 });
    mark('the reveal: drawing, painting, then the 3D hero');
    await p.waitForFunction(() => { const m = document.querySelector('.tb-dock-layer--moves'); return m && getComputedStyle(m).opacity === '1'; }, null, { timeout: 60000 });
    await p.waitForTimeout(2500);
    await tap(p.locator('.tb-move[data-move="dance"]').first());
    mark('tapped a move: Dance');
    await p.waitForTimeout(6000);
    await tap(p.locator('.tb-hero-screen .tb-logo').first());
    await p.locator('.tb-landing-make').filter({ visible: true }).first().waitFor({ timeout: 30000 });
    mark('tapped the logo: the home page');
    await p.waitForTimeout(4000);
    await tap(p.locator('.tb-landing-make').filter({ visible: true }).first());
    mark('tapped Make a hero');
    await p.waitForTimeout(6000);
    mark('end');
    fs.writeFileSync(`${out}/link.txt`, link + '\n');
  }
  await cdp.send('Page.stopScreencast').catch(() => {});
  await ctx.close();
  // Each frame lasts until the next one: real speed, nothing sped up.
  const start = t0 / 1000;
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1] : frames[i] + 1;
    if (frames[i] < start - 0.5) continue;
    lines.push(`file 'frames/${String(i).padStart(6, '0')}.jpg'`, `duration ${Math.max(0.001, next - frames[i]).toFixed(3)}`);
  }
  lines.push(lines[lines.length - 2]);
  fs.writeFileSync(`${out}/frames.txt`, lines.join('\n') + '\n');
  require('child_process').execSync(`ffmpeg -nostdin -v error -y -f concat -safe 0 -i frames.txt -vf "fps=30,scale=780:1688:force_original_aspect_ratio=decrease,pad=780:1688:(ow-iw)/2:(oh-ih)/2:color=0xfff6e9,format=yuv420p" -c:v libx264 -crf 18 ${flow}.mp4`, { cwd: out });
  const first = frames.find((t) => t >= start - 0.5) ?? start;
  for (const s of steps) s.at = +(s.at - (first - start)).toFixed(1);
  fs.writeFileSync(`${out}/steps.json`, JSON.stringify({ flow, file: `${flow}.mp4`, base: BASE, viewport: '390x844 @2x (780x1688 video)', speed: 'real, never sped up', steps }, null, 1));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
