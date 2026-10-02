// The staging robot: drives the real site the way a customer would, end to end.
//
//   landing page -> heroes gallery -> sign up -> buy credits (Lemon Squeezy
//   test mode) -> upload a drawing -> every pipeline stage completes -> the
//   hero is in "My Creations" -> play a game with it
//
// It talks to nothing but the public frontend URL, like a person would. No
// API shortcuts: a step passes only if the UI shows it passed. Every step
// writes a screenshot to e2e/out/ so a failure can be seen, not guessed at.
//
//   BASE_URL=https://<staging frontend> node e2e/staging-robot.mjs
//   STEPS=landing,gallery,signup   run a subset (default: all)
//
// It spends real money at OpenAI and Meshy (one hero, ~10 credits of
// provider cost) and a Lemon Squeezy TEST-mode purchase, which is free.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const DRAWING = path.join(HERE, '..', 'marketing', 'concepts', 'assets', 'pairs', 'crayon-kid-drawing.jpg');
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const ALL_STEPS = ['landing', 'gallery', 'signup', 'buy', 'create', 'profile', 'game'];
const STEPS = (process.env.STEPS || ALL_STEPS.join(',')).split(',').map((s) => s.trim());
const PIPELINE_TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS || 25 * 60 * 1000);
// DEMO=1 records a video of the same journey at a human pace, with a visible
// cursor, on a phone-sized portrait screen, and marks where the long pipeline wait starts and
// ends so e2e/cut-demo.sh can fast-forward it. The checks are identical.
const DEMO = process.env.DEMO === '1';
const marks = {};

if (!BASE_URL) {
  console.error('BASE_URL is required');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const results = [];
let shot = 0;

async function snap(page, name) {
  const file = path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

// On failure, say what the page actually showed: the visible text is what a
// person would read, and it is what a log reader needs to fix the test.
async function describe(page) {
  const text = await page.evaluate(() => {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('select, script, style').forEach((n) => n.remove());
    return clone.innerText;
  }).catch(() => '(no body)');
  return `url=${page.url()}\n--- visible text ---\n${text.slice(0, 3000)}`;
}

async function step(page, name, fn) {
  if (!STEPS.includes(name)) {
    results.push({ name, status: 'skipped' });
    return;
  }
  const started = Date.now();
  console.log(`\n=== ${name} ===`);
  try {
    const note = await fn();
    await snap(page, name);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ name, status: 'passed', secs, note: note || '' });
    console.log(`PASS ${name} (${secs}s) ${note || ''}`);
  } catch (err) {
    await snap(page, `${name}-FAILED`);
    results.push({ name, status: 'failed', error: String(err && err.message ? err.message : err) });
    console.log(`FAIL ${name}: ${err && err.stack ? err.stack : err}`);
    console.log(await describe(page));
    throw err;
  }
}

function report() {
  const lines = ['| step | result | time | note |', '|---|---|---|---|'];
  for (const r of results) {
    const mark = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
    lines.push(`| ${r.name} | ${mark} ${r.status} | ${r.secs ? r.secs + 's' : ''} | ${(r.note || r.error || '').replace(/\|/g, '/').slice(0, 200)} |`);
  }
  const md = `## Staging robot: ${BASE_URL}\n\n${lines.join('\n')}\n`;
  writeFileSync(path.join(OUT, 'report.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
  console.log('\n' + md);
}

async function creditsShown(page) {
  const txt = await page.locator('.header-auth-credits').innerText();
  return Number(txt.replace(/[^0-9]/g, ''));
}

// ---------------------------------------------------------------------------
// Demo presentation: a visible cursor. Captions are added afterwards by
// cut-demo.mjs, so the recording is clean and one take serves every language.
// ---------------------------------------------------------------------------
// Draws the mouse, which a headless recording otherwise never shows. Runs in
// every page and frame the context opens, so it survives navigation.
const CURSOR_SCRIPT = `(() => {
  if (window.top !== window) return;
  const put = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;'
      + 'background:rgba(255,214,0,.85);border:3px solid #fff;box-shadow:0 0 12px rgba(0,0,0,.5);z-index:2147483647;'
      + 'pointer-events:none;transition:transform .12s';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(.6)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  };
  if (document.documentElement) put(); else addEventListener('DOMContentLoaded', put);
})();`;

// Human-paced typing in the demo; instant otherwise.
async function type(p, selector, value) {
  if (!DEMO) return p.fill(selector, value);
  const el = p.locator(selector);
  await el.click();
  await el.pressSequentially(value, { delay: 55 });
}

async function linger(p, ms) { if (DEMO) await p.waitForTimeout(ms); }

// ---------------------------------------------------------------------------
// Lemon Squeezy's hosted checkout. Card fields live in Stripe iframes whose
// markup changes between Stripe versions, so each field is looked for by the
// several names Stripe has used, in every frame on the page.
// ---------------------------------------------------------------------------
async function fillFirst(page, selectors, value, label, { mainOnly = false } = {}) {
  for (const frame of mainOnly ? [page.mainFrame()] : page.frames()) {
    for (const sel of selectors) {
      const loc = frame.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        if (await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 5000 }).catch(() => {});
          await loc.fill('', { timeout: 5000 }).catch(() => {});
          await loc.pressSequentially(value, { delay: 30 });
          console.log(`  filled ${label} via ${sel} in ${frame.url().slice(0, 60)}`);
          return true;
        }
      }
    }
  }
  return false;
}

async function payOnLemonSqueezy(page, email) {
  await page.waitForURL(/lemonsqueezy\.com/, { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000); // Stripe mounts its iframes after load
  await snap(page, 'checkout-loaded');
  mark('checkout');

  // The checkout's "Email address" is Stripe's Link authentication field, so
  // it lives in a Stripe iframe; a fresh address never triggers Link's code.
  await fillFirst(page, ['input[type=email]', 'input[name=email]'], email, 'email');
  const card = await fillFirst(page, [
    'input[name=cardnumber]', 'input[autocomplete="cc-number"]', '#Field-numberInput', 'input[name=number]',
  ], '4242424242424242', 'card number');
  const exp = await fillFirst(page, [
    'input[name=exp-date]', 'input[autocomplete="cc-exp"]', '#Field-expiryInput', 'input[name=expiry]',
  ], '1234', 'expiry');
  const cvc = await fillFirst(page, [
    'input[name=cvc]', 'input[autocomplete="cc-csc"]', '#Field-cvcInput',
  ], '123', 'cvc');
  await fillFirst(page, ['input[name=name]', 'input[autocomplete="cc-name"]', 'input[name=billingName]', 'input[placeholder*="name" i]'], 'Robot Tester', 'name', { mainOnly: true });
  // Billing country decides which address fields appear, so set it first.
  for (const sel of await page.locator('select').all()) {
    const hasUS = await sel.locator('option', { hasText: /^United States$/ }).count().catch(() => 0);
    if (hasUS) {
      await sel.selectOption({ label: 'United States' });
      console.log('  selected billing country United States');
      await page.waitForTimeout(1000);
      break;
    }
  }

  if (!card || !exp || !cvc) {
    const frames = page.frames().map((f) => f.url().slice(0, 100)).join('\n  ');
    throw new Error(`could not find card fields (card=${card} exp=${exp} cvc=${cvc}); frames:\n  ${frames}`);
  }
  // The address fields render only after a country is chosen ("Loading...").
  const postal = ['input[name=postal]', 'input[name=postalCode]', 'input[autocomplete="postal-code"]', '#Field-postalCodeInput', 'input[name=zip]', 'input[placeholder*="zip" i]', 'input[placeholder*="postal" i]'];
  let zipDone = false;
  for (let i = 0; i < 15 && !zipDone; i++) {
    zipDone = await fillFirst(page, postal, '10001', 'postal');
    if (!zipDone) await page.waitForTimeout(1000);
  }
  // Stripe ticks "Save my information for faster checkout" (Link) by default,
  // which makes a mobile number required. A buyer can untick it; so do we.
  for (const frame of page.frames()) {
    const save = frame.getByRole('checkbox', { name: /save my information/i }).first();
    if (await save.count().catch(() => 0)) {
      if (await save.isChecked().catch(() => false)) {
        await save.uncheck({ timeout: 5000 }).catch(async () => { await save.click({ force: true }); });
        console.log('  unticked "Save my information" (Link)');
      }
      break;
    }
  }

  // A US billing address is complete only with street, city and state.
  await fillFirst(page, ['input[placeholder="Address line 1"]', 'input[autocomplete="address-line1"]'], '350 5th Ave', 'address', { mainOnly: true });
  await fillFirst(page, ['#city', 'input[placeholder="City"]', 'input[autocomplete="address-level2"]'], 'New York', 'city', { mainOnly: true });
  const state = page.locator('input[placeholder^="Select a state"]').first();
  if (await state.count()) {
    await state.click();
    await state.pressSequentially('New York', { delay: 30 });
    const option = page.getByRole('option', { name: /^New York$/ }).first();
    if (await option.count().catch(() => 0)) await option.click();
    else await state.press('Enter');
    console.log('  chose state New York');
  }
  await snap(page, 'checkout-filled');

  let pay = page.getByRole('button', { name: /^(pay|purchase|buy|complete|place order)/i }).first();
  if (!(await pay.count())) pay = page.locator('button[type=submit]').first();
  console.log(`  pressing "${(await pay.innerText().catch(() => '?')).trim()}"`);
  for (let i = 0; i < 20 && (await pay.isDisabled().catch(() => false)); i++) await page.waitForTimeout(1000);
  if (await pay.isDisabled().catch(() => false)) {
    // Say exactly which fields are still empty, in which frame.
    for (const frame of page.frames()) {
      const empty = await frame.evaluate(() => [...document.querySelectorAll('input, select')]
        .filter((el) => el.offsetParent !== null && !el.value)
        .map((el) => `${el.tagName.toLowerCase()} name=${el.name} id=${el.id} ac=${el.autocomplete} ph=${el.placeholder}`)).catch(() => []);
      if (empty.length) console.log(`  empty in ${frame.url().slice(0, 70)}:\n    ${empty.join('\n    ')}`);
    }
    throw new Error('the pay button stayed disabled: the checkout form is incomplete');
  }
  await linger(page, 1200);
  await pay.click({ timeout: 15000 });
  // Success is a "Thanks for your order!" dialog on the same page, whose
  // Continue button follows our redirect_url back to the app.
  const thanks = page.getByText(/Thanks for your order/i).first();
  // Whichever loses the race must not reject unhandled later and kill the run.
  await Promise.race([
    thanks.waitFor({ timeout: 120000 }).catch(() => {}),
    page.waitForURL((u) => u.toString().startsWith(BASE_URL), { timeout: 120000 }).catch(() => {}),
  ]);
  if (!page.url().startsWith(BASE_URL)) {
    if (!(await thanks.isVisible().catch(() => false))) throw new Error('no order confirmation within 2 minutes of paying');
    await snap(page, 'checkout-paid');
    await linger(page, 2500);
    mark('paid');
    await page.getByRole('button', { name: /^continue/i }).or(page.getByRole('link', { name: /^continue/i })).first().click();
    await page.waitForURL((u) => u.toString().startsWith(BASE_URL), { timeout: 60000 });
  }
}

// ---------------------------------------------------------------------------

// No slowMo: slowing every action of Stripe's own fields stalled a payment.
// The demo gets its pace from explicit pauses and typing delays instead.
const browser = await chromium.launch();
// English, US: third-party pages (the checkout) localise to the runner's
// locale otherwise, and the robot finds buttons by their English names.
// The demo is filmed as a customer sees it: a phone, held upright. The video
// is exactly the viewport: Playwright does not scale a 2x device into a 2x
// video, it paints the page into the top-left quarter and leaves the rest
// grey, so a larger phone at 1x is what gives a sharp, full frame.
const VIEW = DEMO ? { width: 540, height: 1170 } : { width: 1280, height: 900 };
const context = await browser.newContext({
  viewport: VIEW, locale: 'en-US', timezoneId: 'America/New_York',
  ...(DEMO ? { isMobile: true, hasTouch: true, recordVideo: { dir: OUT, size: VIEW } } : {}),
});
if (DEMO) await context.addInitScript(CURSOR_SCRIPT);
const page = await context.newPage();
const t0 = Date.now();  // the video's clock starts with the page
// A recording under load drifts tens of seconds from the wall clock, so a
// mark is also painted INTO the video: an 8x8 square in the bottom-right
// corner, coloured by the mark's index in MARK_ORDER. cut-demo.mjs reads the
// colour back frame by frame to find each moment on the video's own clock.
const MARK_ORDER = ['landing', 'gallery_end', 'signup_start', 'signup_end', 'buy_start', 'checkout',
  'paid', 'credits', 'credits_end', 'upload', 'pipeline_start', 'pipeline_end', 'ready_end',
  'game_ready', 'play', 'end'];
const MARK_COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8000', '#80ff00',
  '#0080ff', '#ff0080', '#8000ff', '#00ff80', '#800000', '#008000', '#000080', '#808000'];
const mark = (name) => {
  marks[name] = (Date.now() - t0) / 1000;
  const i = MARK_ORDER.indexOf(name);
  if (!DEMO || i < 0) return;
  page.evaluate((c) => {
    let m = document.getElementById('__demo_mark');
    if (!m) {
      m = document.createElement('div');
      m.id = '__demo_mark';
      m.style.cssText = 'position:fixed;right:0;bottom:0;width:8px;height:8px;z-index:2147483647;pointer-events:none';
      document.documentElement.appendChild(m);
    }
    m.style.background = c;
  }, MARK_COLORS[i]).catch(() => {});
};
page.setDefaultTimeout(30000);
page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));

const stamp = Date.now().toString(36);
const user = { username: `robot_${stamp}`, email: `robot+${stamp}@example.com`, password: `robot-${stamp}-pw` };
let heroName = null;

let exitCode = 0;
try {
  await step(page, 'landing', async () => {
    const res = await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    if (!res || res.status() >= 400) throw new Error(`landing answered ${res && res.status()}`);
    await page.getByRole('button', { name: 'HeroMaker home' }).waitFor();
    // A cached service worker keeps returning visitors on the old app forever.
    const sw = await page.request.get(BASE_URL + '/sw.js');
    const swCache = sw.headers()['cache-control'] || '';
    if (!/no-cache|no-store|max-age=0/.test(swCache)) throw new Error(`/sw.js is cacheable ("${swCache}"): returning visitors would never get a new release`);
    await linger(page, 3500);
    mark('landing');
    return `HTTP ${res.status()}`;
  });

  await step(page, 'gallery', async () => {
    const items = page.locator('.creation-gallery-item');
    await items.first().waitFor({ timeout: 45000 });
    const n = await items.count();
    if (DEMO) {
      await page.mouse.move(640, 400);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 260); await page.waitForTimeout(700); }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(1200);
    }
    mark('gallery_end');
    // Open one hero and come back, as a browsing visitor would.
    await items.first().click();
    await page.locator('.tb-hero-screen').waitFor({ timeout: 30000 });
    if (DEMO) {
      await page.waitForTimeout(1500);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(800); }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(800);
    }
    await page.locator('.tb-back').click();
    await items.first().waitFor();
    return `${n} heroes shown; opened one and returned`;
  });

  await step(page, 'signup', async () => {
    mark('signup_start');
    await page.locator('.header-auth-button').click();
    await page.locator('button.auth-modal-tab').click(); // "Create an account"
    await type(page, '#username', user.username);
    await type(page, '#email', user.email);
    await type(page, '#name', DEMO ? 'Maya' : 'Robot Tester');
    await page.fill('#dateOfBirth', '2000-01-01');
    await type(page, '#password', user.password);
    await page.locator('button.auth-modal-submit').click();
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    await linger(page, 2500);
    mark('signup_end');
    return `${user.username}, balance ${await creditsShown(page)}`;
  });

  await step(page, 'buy', async () => {
    const before = await creditsShown(page);
    mark('buy_start');
    await page.locator('.header-auth-user-button').click();
    await page.getByRole('button', { name: /buy credits/i }).click();
    const pack = page.locator('.buy-credits-pack[data-pack="starter"]');
    await pack.waitFor({ timeout: 20000 });
    if (DEMO) { await pack.hover(); await page.waitForTimeout(2500); }
    const price = await pack.locator('.buy-credits-pack-price').innerText();
    if (!/^\$\d+\.\d{2}$/.test(price.trim())) throw new Error(`price renders as "${price}"`);
    await pack.click();
    await payOnLemonSqueezy(page, user.email);
    // Back on our site: the webhook, not the browser, grants the credits.
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    const deadline = Date.now() + 60000;
    let after = before;
    while (Date.now() < deadline && after <= before) {
      await page.waitForTimeout(2000);
      after = await creditsShown(page).catch(() => before);
    }
    if (after <= before) throw new Error(`balance still ${after} a minute after paying (was ${before})`);
    mark('credits');
    if (DEMO) { await page.locator('.header-auth-credits').hover(); await page.waitForTimeout(3000); }
    mark('credits_end');
    return `paid ${price}; balance ${before} -> ${after}`;
  });

  await step(page, 'create', async () => {
    mark('upload');
    const input = page.locator('.header-upload-buttons input[type=file]');
    await input.setInputFiles(DRAWING);
    const go = page.locator('button.post-upload-action-primary');
    await go.waitFor({ timeout: 60000 });
    if (await go.isDisabled()) throw new Error(`Go is disabled: ${await describe(page)}`);
    await linger(page, 2500);
    await go.click();
    await page.locator('.tb-hero-screen').waitFor({ timeout: 60000 });
    mark('pipeline_start');

    const deadline = Date.now() + PIPELINE_TIMEOUT_MS;
    let lastLine = '';
    const ready = page.locator('.tb-hero-screen[data-state="ready"]');
    while (Date.now() < deadline) {
      if (await ready.isVisible().catch(() => false)) break;
      const failed = page.locator('.tb-failed');
      if (await failed.count()) {
        const name = await failed.getAttribute('data-step').catch(() => '?');
        const label = await failed.locator('.tb-status-name').innerText().catch(() => '?');
        throw new Error(`stage "${name}" failed: ${label}`);
      }
      const line = await page.locator('.tb-making').evaluate((el) => {
        const dots = [...el.querySelectorAll('.tb-step-dot')].map((d) => (d.className.match(/tb-step-dot--(\w+)/) || [])[1]);
        return `${el.getAttribute('data-step')}  [${dots.join(' ')}]  ${el.querySelector('.tb-status-eta')?.textContent || ''}`;
      }).catch(() => '');
      if (line !== lastLine) {
        console.log(`  [${new Date().toISOString().slice(11, 19)}] ${line}`);
        lastLine = line;
      }
      await page.waitForTimeout(DEMO ? 2000 : 10000);
    }
    if (!(await ready.isVisible().catch(() => false))) {
      throw new Error(`hero not ready after ${PIPELINE_TIMEOUT_MS / 60000} min; last: ${lastLine}`);
    }
    mark('pipeline_end');
    heroName = await page.locator('.hero-name-editor, .hero-name').first().innerText().catch(() => null);
    if (DEMO) {
      await page.waitForTimeout(1500);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 320); await page.waitForTimeout(900); }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(1500);
    }
    mark('ready_end');
    return `all stages completed; "${heroName || 'hero'}" shown ready to play`;
  });

  await step(page, 'profile', async () => {
    await page.locator('.tb-back').click();
    await page.locator('.tb-chip-mine').click();
    const mine = page.locator('.creation-gallery-item');
    await mine.first().waitFor({ timeout: 30000 });
    const n = await mine.count();
    if (n < 1) throw new Error('no heroes under My heroes');
    const done = await page.locator('.creation-gallery-item.creation-gallery-status-completed').count();
    if (DEMO) { await mine.first().hover(); await page.waitForTimeout(3500); }
    return `${n} hero(es) under My heroes, ${done} completed${heroName ? ` (${heroName})` : ''}`;
  });

  await step(page, 'game', async () => {
    await page.locator('.creation-gallery-item.creation-gallery-status-completed').first().click();
    const play = page.locator('.tb-play');
    await play.waitFor({ timeout: 20000 });
    const [game] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }).catch(() => null),
      play.click(),
    ]);
    const gp = game || page;
    await gp.waitForURL(/\/play\//, { timeout: 30000 });
    // The recording machine renders in software; lite mode keeps the moves at
    // their real speed there (see reel.ts). The robot's checks run full quality.
    if (DEMO) await gp.goto(gp.url() + '&lite=1');
    await gp.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
    const loaded = await gp.evaluate(() => window.__reel && window.__reel.hero && window.__reel.hero());
    if (DEMO) {
      await gp.waitForTimeout(3000);
      mark('game_ready');
      mark('play');
      // Each tap plays at once; under software WebGL the game's own API is the
      // fast way to tap, and each move is let finish so it is seen.
      for (const move of ['jump', 'backflip', 'victory']) {
        await gp.evaluate((m) => window.__reel.tap(m), move);
        await gp.waitForFunction(() => window.__reel.playing() === null, null, { timeout: 60000 }).catch(() => {});
      }
      await gp.waitForTimeout(3500);
      mark('end');
    } else {
      // A real tap on a move card: it must start playing at once, no queue.
      await gp.locator('.reel-card[data-move="jump"]').click();
      await gp.waitForFunction(() => window.__reel.playing() === 'jump', null, { timeout: 5000 });
      await gp.waitForTimeout(500);
      await gp.locator('.reel-card[data-move="backflip"]').click();
      await gp.waitForFunction(() => window.__reel.playing() === 'backflip', null, { timeout: 5000 });
      await gp.waitForTimeout(1500);
    }
    await snap(gp, 'game-playing');
    return `game loaded the user's hero (${loaded || 'custom'}) and is playing`;
  });
} catch {
  exitCode = 1;
} finally {
  // Leave no trace: every run makes the same hero from the same drawing, and
  // ten identical robots in the public gallery is exactly what a visitor
  // should never see. Deletes only this run's user's own heroes.
  try {
    const state = await context.storageState();
    const origin = state.origins.find((o) => BASE_URL.startsWith(o.origin));
    const token = origin?.localStorage.find((e) => e.name === 'heromaker_jwt_token')?.value;
    if (token) {
      const auth = { Authorization: `Bearer ${token}` };
      const list = await (await fetch(`${BASE_URL}/api/creations/?mine_only=true`, { headers: auth })).json();
      const mine = (Array.isArray(list) ? list : list.creations || []).filter((c) => c.username === user.username);
      for (const c of mine) {
        const r = await fetch(`${BASE_URL}/api/creations/${c.id}`, { method: 'DELETE', headers: auth });
        console.log(`cleanup: deleted ${c.id} -> ${r.status}`);
        if (!r.ok) exitCode = 1;  // a hero that cannot be deleted is a bug
      }
    }
  } catch (e) {
    console.log(`cleanup failed: ${e.message}`);
  }
  report();
  if (DEMO) {
    writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks));
    const video = page.video();
    await context.close();
    if (video) {
      await video.saveAs(path.join(OUT, 'demo.webm')).catch((e) => console.log(`  video not saved: ${e.message}`));
      console.log(`demo video: ${path.join(OUT, 'demo.webm')}  marks: ${JSON.stringify(marks)}`);
    }
  }
  await browser.close();
}
process.exit(exitCode);
