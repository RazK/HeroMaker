// node full.js  -> rec/teacher-full/{student,teacher}.mp4 + steps.json
// The not-happy teacher flow: a class whose 10 seats each hold a hero; an
// 11th student sees "This class is full"; the teacher adds seats (TEST
// checkout); the waiting student goes on by themself. Real speed, staging.
// The 10 seat-filling heroes use the robot's drawing in the default style,
// which the staging result cache serves without calling a provider.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const BASE = 'https://frontend-staging-7cb8.up.railway.app';
const API = 'https://backend-staging-384f.up.railway.app';
const DRAWING = '/home/user/HeroMaker/marketing/concepts/assets/pairs/crayon-kid-drawing.jpg';
const out = path.join(__dirname, 'teacher-full');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });

const steps = [];
let t0 = 0;
const mark = (who, name) => { const t = (Date.now() - t0) / 1000; steps.push({ who, step: name, at: +t.toFixed(1) }); console.log(t.toFixed(1), who, name); };

async function screencast(ctx, page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    fs.writeFileSync(`${dir}/${String(frames.length).padStart(6, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    frames.push(f.metadata.timestamp);
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  return { cdp, frames, dir };
}
// One video from the shared start t0, so both phones share one clock.
function encode(sc, file) {
  const start = t0 / 1000;
  const lines = [];
  const first = sc.frames.findIndex((t) => t >= start - 0.5);
  // Hold the first frame from t0 so both videos start at the same moment.
  for (let i = Math.max(0, first); i < sc.frames.length; i++) {
    const next = i + 1 < sc.frames.length ? sc.frames[i + 1] : sc.frames[i] + 1;
    const dur = i === first ? next - start : next - sc.frames[i];
    lines.push(`file '${sc.dir}/${String(i).padStart(6, '0')}.jpg'`, `duration ${Math.max(0.001, dur).toFixed(3)}`);
  }
  lines.push(lines[lines.length - 2]);
  fs.writeFileSync(`${sc.dir}.txt`, lines.join('\n') + '\n');
  execSync(`ffmpeg -nostdin -v error -y -f concat -safe 0 -i ${sc.dir}.txt -vf "fps=30,scale=780:1688:force_original_aspect_ratio=decrease,pad=780:1688:(ow-iw)/2:(oh-ih)/2:color=0xfff6e9,format=yuv420p" -c:v libx264 -crf 18 ${file}`);
}

(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-US' };
  const stamp = Date.now().toString(36);
  const u = { username: `rec_${stamp}`, email: `robot+rec${stamp}@example.com`, password: `rec-${stamp}-pw` };
  const tctx = await b.newContext(phone);
  await tctx.addInitScript(() => { localStorage.setItem('heromaker_adult_confirmed', '1'); });
  const tp = await tctx.newPage();
  let token = null;
  const api = (p, init = {}) => fetch(API + p, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  try {
    // ---- Setup, off camera: a teacher, a class of 10 paid seats, live.
    await tp.goto(BASE + '/', { waitUntil: 'load' });
    await tp.locator('.header-auth-button').click();
    const grownUp = tp.getByRole('dialog', { name: 'Is a grown-up with you?' });
    await grownUp.waitFor({ timeout: 15000 });
    await grownUp.getByRole('button', { name: 'Yes' }).click();
    await tp.locator('#username').waitFor({ timeout: 15000 });
    await tp.locator('button.auth-modal-tab').click();
    await tp.fill('#username', u.username); await tp.fill('#email', u.email); await tp.fill('#name', 'Robot Tester');
    await tp.fill('#dateOfBirth', '2000-01-01'); await tp.fill('#password', u.password);
    await tp.locator('button.auth-modal-submit').click();
    await tp.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    token = await tp.evaluate(() => localStorage.getItem('heromaker_jwt_token'));
    await tp.getByRole('button', { name: 'Account' }).click();
    await tp.getByRole('switch', { name: 'I run classes' }).click();
    await tp.locator('.cls-new-class').waitFor({ timeout: 30000 });
    await tp.locator('.cls-new-class').click();
    const school = tp.locator('#cls-school');
    const title = tp.locator('#cls-title');
    await school.or(title).first().waitFor({ timeout: 15000 });
    if (await school.isVisible()) {
      await tp.fill('#cls-school', 'Robot Primary');
      await tp.locator('.cls-school-types').getByRole('radio', { name: 'Primary school' }).click();
      await tp.locator('.cls-school-save').click();
    }
    await title.waitFor({ timeout: 15000 });
    await tp.fill('#cls-title', 'Class 2B');
    const value = tp.locator('.cls-new-sheet .cls-stepper-value');
    for (let i = 0; i < 80 && Number(await value.inputValue()) !== 10; i++) {
      await tp.locator('.cls-new-sheet .cls-stepper').getByRole('button', { name: Number(await value.inputValue()) > 10 ? 'Fewer' : 'More' }).click();
    }
    await tp.locator('.cls-ages').getByRole('radio', { name: '7–8' }).click();
    await tp.locator('.cls-pay-seats').click();
    await tp.locator('.cls-pay-money').click();
    await tp.waitForURL((x) => x.pathname.startsWith('/api/payments/sandbox/checkout/'), { timeout: 60000 });
    await tp.getByRole('button', { name: 'Pay', exact: true }).click();
    await tp.waitForURL((x) => x.toString().startsWith(BASE) && !x.pathname.startsWith('/api/payments/'), { timeout: 60000 });
    const start = tp.locator('.cls-start');
    await start.waitFor({ timeout: 60000 });
    await start.click();
    await tp.locator('.cls-start-confirm').click();
    const pinBox = tp.locator('.cls-join-card .cls-pin');
    await pinBox.waitFor({ timeout: 15000 });
    const pin = (await pinBox.locator('.cls-pin-box').allInnerTexts()).join('');
    console.log('class live, code', pin);

    // ---- Ten students fill the ten seats (off camera). Each seat is taken
    // when its hero starts; the cache serves the robot's drawing.
    const names = ['Noa', 'Ari', 'Dan', 'Lia', 'Tom', 'Gal', 'Yon', 'Mia', 'Ido', 'Eli'];
    for (const [i, n] of names.entries()) {
      const kc = await b.newContext(phone);
      const k = await kc.newPage();
      await k.goto(`${BASE}/join/${pin}`, { waitUntil: 'domcontentloaded' });
      await k.locator('.cls-name-input').fill(n);
      await k.locator('.cls-ages').getByRole('radio', { name: '7', exact: true }).click();
      await k.locator('.cls-go').click();
      await k.locator('.cls-draw').waitFor({ timeout: 30000 });
      await k.locator('.cls-draw input[type=file]').setInputFiles(DRAWING);
      await k.locator('.cls-make').click();
      await k.locator('.cls-draw').waitFor({ state: 'detached', timeout: 60000 });
      await kc.close();
      console.log('seat', i + 1, 'taken by', n);
      if (i === 0) {
        // A cache miss would make real heroes: stop if the first is not fast.
        const t = Date.now();
        let ready = false;
        while (Date.now() - t < 90000 && !ready) {
          await new Promise((r) => setTimeout(r, 5000));
          const cls = await (await api('/api/v1/classes')).json();
          const id = (cls.data || cls.classes || cls)[0]?.id;
          const view = await (await api(`/api/v1/classes/${id}`)).json();
          ready = (view.heroes_ready || 0) >= 1;
        }
        if (!ready) throw new Error('the first student hero was not ready in 90 s: not cached, stopping before spending more');
        console.log('first hero ready fast: cached');
      }
    }

    // ---- On camera: the teacher's board and an 11th student's phone.
    await tp.reload({ waitUntil: 'domcontentloaded' });
    await tp.locator('.cls-join-card .cls-pin').waitFor({ timeout: 30000 });
    const sctx = await b.newContext(phone);
    const sp = await sctx.newPage();
    await sp.goto('about:blank');
    const tsc = await screencast(tctx, tp, `${out}/tframes`);
    const ssc = await screencast(sctx, sp, `${out}/sframes`);
    t0 = Date.now();
    await tp.waitForTimeout(1500);
    mark('teacher', 'the class board: every seat has a hero (10 of 10)');
    await tp.waitForTimeout(2500);
    await sp.goto(`${BASE}/join/${pin}`, { waitUntil: 'domcontentloaded' });
    mark('student', 'an 11th student opens the class code');
    await sp.getByText('This class is full').waitFor({ timeout: 30000 });
    mark('student', '"This class is full. Ask your teacher for a seat."');
    await sp.waitForTimeout(5000);
    // The teacher adds seats.
    await tp.getByRole('button', { name: 'More', exact: true }).click();
    const add = tp.getByRole('button', { name: /Add seats/ }).first();
    await add.waitFor({ timeout: 30000 });
    mark('teacher', 'taps More (⋯): Add seats');
    await tp.waitForTimeout(1500);
    await add.click();
    mark('teacher', 'taps Add seats');
    const sv = tp.locator('.tb-sheet .cls-stepper-value, [role=dialog] .cls-stepper-value').first();
    await sv.waitFor({ timeout: 15000 });
    for (let i = 0; i < 40 && Number(await sv.inputValue()) < 10; i++) await tp.locator('[role=dialog] .cls-stepper, .tb-sheet .cls-stepper').first().getByRole('button', { name: 'More' }).click();
    await tp.waitForTimeout(1500);
    await tp.locator('.cls-pay-seats').click();
    await tp.locator('.cls-pay-money').click();
    await tp.waitForURL((x) => x.pathname.startsWith('/api/payments/sandbox/checkout/'), { timeout: 60000 });
    mark('teacher', 'TEST checkout: ₪100 for 10 more seats');
    await tp.waitForTimeout(3000);
    await tp.getByRole('button', { name: 'Pay', exact: true }).click();
    await tp.waitForURL((x) => x.toString().startsWith(BASE) && !x.pathname.startsWith('/api/payments/'), { timeout: 60000 });
    mark('teacher', 'paid: back on the class, the seats arrive');
    // The waiting student goes on by themself (the page asks every 4 s).
    await sp.locator('.cls-name-input').waitFor({ timeout: 60000 });
    mark('student', 'a seat: the student goes on to "What is your name?" by themself');
    await sp.waitForTimeout(3000);
    await sp.locator('.cls-name-input').fill('Ben');
    await sp.waitForTimeout(3000);
    mark('end', 'end');
    await tsc.cdp.send('Page.stopScreencast').catch(() => {});
    await ssc.cdp.send('Page.stopScreencast').catch(() => {});
    encode(tsc, `${out}/teacher-full-teacher.mp4`);
    encode(ssc, `${out}/teacher-full-student.mp4`);
    fs.writeFileSync(`${out}/steps.json`, JSON.stringify({ flow: 'teacher-full (not happy: not enough seats)', files: ['teacher-full-teacher.mp4', 'teacher-full-student.mp4'], note: 'both videos start at the same moment (t=0): put them side by side or cut between them', speed: 'real, never sped up', steps }, null, 1));
  } finally {
    if (token) {
      // Clean up as the robot does: the class heroes go with the account.
      const r = await api('/api/v1/me', { method: 'DELETE', body: JSON.stringify({ confirm: u.username }) });
      console.log('deleted test account', u.username, r.status);
    }
    await b.close();
  }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
