// The staging robot: drives the real site the way a customer would, end to end.
//
//   landing page -> heroes gallery -> sign up -> buy credits (Lemon Squeezy
//   test mode) -> upload a drawing -> every pipeline stage completes -> the
//   hero is in "My Creations" -> its page: the intro, then moves -> Play ->
//   the game chooser -> Dance party, and the camera-free Robot Rumble ->
//   Teacher home -> a new class whose seats it cannot cover from its credits,
//   paid for in money on Lemon Squeezy -> the seats land on the class (not on
//   the robot's balance) -> Start class shows a PIN and a QR -> a student
//   joins on a phone and makes a hero -> the teacher opens it from the class
//   -> End class
//
// It talks to nothing but the public frontend URL, like a person would. No
// API shortcuts: a step passes only if the UI shows it passed (the class step
// also reads the API back, to prove where the money's seats went). Every step
// writes a screenshot to e2e/out/ so a failure can be seen, not guessed at.
//
//   BASE_URL=https://<staging frontend> node e2e/staging-robot.mjs
//   STEPS=landing,gallery,signup   run a subset (default: all)
//
// It spends real money at OpenAI and Meshy (one hero, ~10 credits of
// provider cost) and two Lemon Squeezy TEST-mode purchases (a credit pack,
// then a class's seats), which are free.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const DRAWING = path.join(HERE, '..', 'marketing', 'concepts', 'assets', 'pairs', 'crayon-kid-drawing.jpg');
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const ALL_STEPS = ['landing', 'gallery', 'signup', 'buy', 'create', 'profile', 'game', 'class'];
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

async function payOnLemonSqueezy(page, email, { marks: marking = true } = {}) {
  await page.waitForURL(/lemonsqueezy\.com/, { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');
  // Stripe mounts its iframes after load, sometimes many seconds after: wait
  // for the card number itself rather than a fixed time.
  await page.waitForTimeout(4000);
  for (let i = 0; i < 30; i++) {
    let found = false;
    for (const frame of page.frames()) {
      const n = frame.locator('input[name=cardnumber], input[autocomplete="cc-number"], #Field-numberInput, input[name=number]').first();
      if (await n.isVisible().catch(() => false)) { found = true; break; }
    }
    if (found) break;
    await page.waitForTimeout(1000);
  }
  await snap(page, 'checkout-loaded');
  if (marking) mark('checkout');

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
    if (marking) mark('paid');
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
// LOGIN_AS=robot_<stamp> signs in to an earlier robot account instead of
// making a new one (its password follows the same pattern), e.g. to top up a
// test account with PACK=maker.
const LOGIN_AS = (process.env.LOGIN_AS || '').trim();
const PACK = (process.env.PACK || 'starter').trim();
const loginStamp = LOGIN_AS.replace(/^robot_/, '');
const user = LOGIN_AS
  ? { username: LOGIN_AS, email: `robot+${loginStamp}@example.com`, password: `robot-${loginStamp}-pw` }
  : { username: `robot_${stamp}`, email: `robot+${stamp}@example.com`, password: `robot-${stamp}-pw` };
let heroName = null;

// The run's own token: from the page if signed in, else by signing in over
// the API, because a run can fail after the account was made but before the
// page shows it - and that account must not be left behind either.
async function robotToken() {
  try {
    const state = await context.storageState();
    const origin = state.origins.find((o) => BASE_URL.startsWith(o.origin));
    const token = origin?.localStorage.find((e) => e.name === 'heromaker_jwt_token')?.value;
    if (token) return token;
  } catch { /* the page may be gone; fall through to the API */ }
  const r = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });
  if (r.status === 401) return null;  // no such account: sign-up never happened
  if (!r.ok) throw new Error(`sign-in for cleanup answered ${r.status}`);
  return (await r.json()).access_token || null;
}

// Reads the API back as this run's robot, to check what the UI cannot show.
async function robotApi(pathname) {
  const token = await robotToken();
  if (!token) throw new Error(`no token to read ${pathname}`);
  const r = await fetch(`${BASE_URL}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${pathname} answered ${r.status}`);
  return r.json();
}

async function cleanup() {
  const started = Date.now();
  const done = (status, note) => {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ name: 'cleanup', status, secs, ...(status === 'failed' ? { error: note } : { note }) });
    console.log(`${status === 'failed' ? 'FAIL' : status === 'skipped' ? 'SKIP' : 'PASS'} cleanup: ${note}`);
  };
  console.log('\n=== cleanup ===');
  if (LOGIN_AS) return done('skipped', `signed in to an existing account (${LOGIN_AS}): kept, with its heroes`);
  if (!/^robot_[a-z0-9]+$/.test(user.username)) return done('failed', `refusing to delete "${user.username}": not this run's robot`);
  try {
    const token = await robotToken();
    if (!token) return done('passed', `no account to delete: ${user.username} was never created`);
    const auth = { Authorization: `Bearer ${token}` };
    let heroes = 0;
    const list = await (await fetch(`${BASE_URL}/api/creations/?mine_only=true`, { headers: auth })).json();
    const mine = (Array.isArray(list) ? list : list.creations || []).filter((c) => c.username === user.username);
    for (const c of mine) {
      const r = await fetch(`${BASE_URL}/api/creations/${c.id}`, { method: 'DELETE', headers: auth });
      console.log(`cleanup: deleted hero ${c.id} -> ${r.status}`);
      if (!r.ok) throw new Error(`hero ${c.id} could not be deleted (${r.status})`);  // a bug
      heroes++;
    }
    const r = await fetch(`${BASE_URL}/api/auth/me`, {
      method: 'DELETE',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: user.username }),
    });
    console.log(`cleanup: deleted account ${user.username} -> ${r.status}`);
    if (r.status !== 204) throw new Error(`account ${user.username} could not be deleted (${r.status})`);
    // The deleted account's token must stop working: that is the promise.
    const after = await fetch(`${BASE_URL}/api/auth/me`, { headers: auth });
    if (after.ok) throw new Error(`account ${user.username} still answers /me after deletion`);
    done('passed', `deleted ${heroes} hero(es) and the account ${user.username}`);
  } catch (e) {
    exitCode = 1;  // a robot that cannot clean up leaves clutter: fail the run
    done('failed', `${user.username} left behind: ${e.message}`);
  }
}

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
    // Signed out the gallery is Editors' choice alone: no chips, and the
    // public listing holds only starred heroes (All heroes is admin-only).
    if (await page.locator('.tb-gallery-chips').count()) throw new Error('signed-out gallery shows filter chips');
    const pub = await (await page.request.get(BASE_URL + '/api/creations/')).json();
    const leaked = (Array.isArray(pub) ? pub : pub.creations || []).filter((c) => !c.featured);
    if (leaked.length) throw new Error(`public listing shows ${leaked.length} hero(es) not in Editors' choice`);
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
    return `${n} Editors' choice heroes shown, no chips signed out; opened one and returned`;
  });

  await step(page, 'signup', async () => {
    mark('signup_start');
    await page.locator('.header-auth-button').click();
    if (LOGIN_AS) {
      await type(page, '#username', user.username);
      await type(page, '#password', user.password);
      await page.locator('button.auth-modal-submit').click();
      await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
      return `signed in as ${user.username}, balance ${await creditsShown(page)}`;
    }
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
    const pack = page.locator(`.buy-credits-pack[data-pack="${PACK}"]`);
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
    // The style picker: five cards, Pixar picked. The robot keeps Pixar on
    // purpose - its drawing's Pixar painting is in the staging result cache.
    const cards = page.locator('.tb-styles .tb-style');
    await cards.first().waitFor({ timeout: 15000 });
    const styles = await cards.evaluateAll((els) => els.map((el) => `${el.dataset.style}${el.getAttribute('aria-checked') === 'true' ? '*' : ''}`));
    if (styles.join(',') !== 'pixar*,lego,minecraft,anime,original') throw new Error(`style cards are [${styles.join(', ')}], want pixar* (picked), lego, minecraft, anime, original`);
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
    // A fresh hero is not starred, so it is not in Editors' choice (the
    // default view): it is found under My heroes.
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
    // The hero's page plays how it was made the first time a hero is opened on
    // a device. This robot watched its hero become ready, so forget that and
    // open it as a first visit.
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('heromaker.intro.seen.')) localStorage.removeItem(k);
    });
    await page.locator('.creation-gallery-item.creation-gallery-status-completed').first().click();
    const stage = page.locator('.tb-live-stage');
    await stage.waitFor({ timeout: 20000 });
    const phase = await stage.getAttribute('data-phase');
    if (phase === 'live') throw new Error('a first visit did not open into the intro');
    await snap(page, 'intro');
    // The hero screen fits the phone, and the document itself cannot scroll:
    // a desktop browser has no collapsing URL bar, so "it fits here" is not
    // enough; the page must be locked (overflow hidden on html and body).
    const ns = await page.evaluate(() => {
      const h = document.documentElement;
      const locked = [h, document.body].every((el) => getComputedStyle(el).overflowY === 'hidden');
      window.scrollTo(0, 500);
      return { fits: h.scrollHeight <= innerHeight + 1, locked, y: window.scrollY };
    });
    if (!ns.fits || !ns.locked || ns.y !== 0) throw new Error(`hero screen can scroll: ${JSON.stringify(ns)}`);
    const title = (await page.locator('.tb-hero-screen .tb-header-title').innerText()).trim();
    if (!title) throw new Error('the header shows no hero name');

    // A tap on the stage skips the intro, straight to the live hero.
    if (DEMO) await page.waitForTimeout(4000);
    await stage.click({ position: { x: 24, y: 120 } });
    await page.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-phase') === 'live', null, { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-shown') === 'hero', null, { timeout: 90000 });
    await page.locator('.tb-move:not([disabled])').first().waitFor({ timeout: 90000 });
    mark('game_ready');

    // A real tap on a move: it plays at once, no queue. Measured in the page,
    // from the pointer going down to the stage reporting the move.
    const tapToMove = async (move) => {
      await page.evaluate((m) => {
        const s = document.querySelector('.tb-live-stage');
        window.__tap = { at: 0, playing: 0 };
        document.addEventListener('pointerdown', () => { window.__tap.at = performance.now(); }, { once: true, capture: true });
        new MutationObserver((_, o) => {
          if (s.getAttribute('data-playing') === m) { window.__tap.playing = performance.now(); o.disconnect(); }
        }).observe(s, { attributes: true });
      }, move);
      await page.locator(`.tb-move[data-move="${move}"]`).click();
      await page.waitForFunction(() => window.__tap.playing > 0, null, { timeout: 5000 });
      return page.evaluate(() => Math.round(window.__tap.playing - window.__tap.at));
    };
    mark('play');
    const jumpMs = await tapToMove('jump');
    if (jumpMs > 300) throw new Error(`jump started ${jumpMs} ms after the tap`);
    await page.waitForTimeout(DEMO ? 300 : 500);
    const flipMs = await tapToMove('backflip');
    await page.waitForTimeout(700);
    await snap(page, 'hero-moving');
    // When a move ends the hero goes back to its idle dance by itself.
    await page.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-playing') === '', null, { timeout: 30000 });
    if (DEMO) {
      await tapToMove('victory');
      await page.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-playing') === '', null, { timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    // Play is the bottom-most button on the page. It opens the game chooser:
    // two games, each opened with the same hero parameters.
    const lowest = await page.evaluate(() => {
      const all = [...document.querySelectorAll('.tb-hero-screen button, .tb-hero-screen a')];
      return all.reduce((a, b) => (b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a)).className;
    });
    if (!/\btb-play\b/.test(lowest)) throw new Error(`the bottom-most button is "${lowest}", not Play`);
    const play = page.locator('.tb-play');
    const playText = (await play.innerText()).trim();
    if (playText !== 'Play') throw new Error(`the primary reads "${playText}"`);
    const openChooser = async () => {
      await play.click();
      await page.locator('.tb-games').waitFor({ timeout: 5000 });
    };
    await openChooser();
    await snap(page, 'game-chooser');
    const games = await page.locator('.tb-game').evaluateAll((as) => Object.fromEntries(as.map((a) => [a.dataset.game, a.getAttribute('href')])));
    if (!games.dance || !/^\/play\/index\.html\?vrm=[^&]*opt_avatar\.vrm/.test(games.dance)) throw new Error(`Dance party links to ${games.dance}`);
    if (!games.arena || !/^\/play\/arena\.html\?vrm=[^&]*opt_avatar\.vrm/.test(games.arena)) throw new Error(`Robot Rumble links to ${games.arena}`);
    if (games.dance.split('?')[1] !== games.arena.split('?')[1]) throw new Error('the two games are not opened with the same hero');

    // Robot Rumble, the camera-free game: a tap on its card opens it on the
    // same hero, and a tap on Start begins a round.
    await page.locator('.tb-game[data-game="arena"]').click();
    await page.waitForURL(/\/play\/arena\.html/, { timeout: 30000 });
    await page.waitForFunction(() => window.__ready !== undefined, null, { timeout: 90000 });
    const arenaReady = await page.evaluate(() => window.__ready);
    if (arenaReady !== true) throw new Error(`Robot Rumble did not start: ${arenaReady}`);
    await snap(page, 'robot-rumble-start');
    await page.locator('.rr-start').click();
    await page.waitForFunction(() => window.__phase === 'play', null, { timeout: 30000 });
    await page.waitForTimeout(DEMO ? 3000 : 1000);
    await snap(page, 'robot-rumble');
    // Raz's rule: nothing the player can hit is a hero. Other heroes only
    // cheer from the stands. The game proves it about its own scene.
    const audit = await page.evaluate(() => window.__arena?.audit?.() ?? null);
    if (audit && !audit.ok) throw new Error(`Robot Rumble: a hero is hittable or in the arena: ${JSON.stringify(audit)}`);

    // Dance party's page loads from its card's link. (The app keeps no route
    // for the hero screen, so going back would land on the gallery.)
    await page.goto(`${BASE_URL}${games.dance}`);
    await page.waitForFunction(() => window.__ready !== undefined, null, { timeout: 90000 });
    const ready = await page.evaluate(() => window.__ready);
    if (ready !== true) throw new Error(`Dance party did not start: ${ready}`);
    await page.waitForTimeout(DEMO ? 3000 : 1500);
    await snap(page, 'dance-party');
    mark('end');
    return `"${title}" opened into the intro; a tap skipped it; jump played ${jumpMs} ms and backflip ${flipMs} ms after the tap; no scroll; Play is the bottom-most button, its chooser opens both games with the same hero, a Robot Rumble round began (no hero hittable${audit ? `, ${audit.crowd} cheering` : ''}) and Dance party started`;
  });

  await step(page, 'class', async () => {
    // A teacher short of credits pays money for exactly the seats a class
    // needs. The seats arrive on the class by the signed webhook, and never
    // touch the teacher's own balance.
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    const me = await robotApi('/api/auth/me');
    const balance = me.credits;

    // Teacher home is a row on the account sheet; it turns teacher mode on.
    if (!me.is_teacher) {
      await page.getByRole('button', { name: 'Account' }).click();
      await page.getByRole('button', { name: /teacher home/i }).click();
    }
    const newClass = page.locator('.cls-new-class');
    await newClass.waitFor({ timeout: 30000 });
    await linger(page, 1500);

    // The price the app quotes must be the one packs.py sets.
    const listed = await robotApi('/api/classes');
    const price = listed.seat_price;
    if (!price) throw new Error('GET /api/classes offers no seat_price: the class-seats variant is not configured');
    if (price.order_cents !== 50 || price.seat_cents !== 125) {
      throw new Error(`seat_price is ${JSON.stringify(price)}, want order_cents 50 and seat_cents 125 ($0.50 + $1.25 a seat)`);
    }
    // More seats than the robot's credits cover, so money is the way to pay.
    const heroCost = listed.hero_cost;
    const seats = Math.min(price.max_seats, Math.max(5, Math.floor(balance / heroCost) + 1));
    const want = `$${((price.order_cents + price.seat_cents * seats) / 100).toFixed(2)}`;

    await newClass.click();
    // The first class asks for the school once.
    const schoolName = page.locator('#cls-school');
    const title = page.locator('#cls-title');
    await schoolName.or(title).first().waitFor({ timeout: 15000 });
    let school = 'already set';
    if (await schoolName.isVisible()) {
      await type(page, '#cls-school', 'Robot Primary');
      await page.locator('.cls-school-types').getByRole('radio', { name: 'Primary school' }).click();
      await linger(page, 800);
      await page.locator('.cls-school-save').click();
      school = 'Robot Primary, primary school';
    }

    await title.waitFor({ timeout: 15000 });
    const className = `Robot ${stamp}`;
    await type(page, '#cls-title', className);
    // The Students stepper, tapped down (or up) to the count.
    const value = page.locator('.cls-new-sheet .cls-stepper-value');
    for (let i = 0; i < 80; i++) {
      const n = Number(await value.inputValue());
      if (n === seats) break;
      await page.locator('.cls-new-sheet .cls-stepper').getByRole('button', { name: n > seats ? 'Fewer' : 'More' }).click();
    }
    if (Number(await value.inputValue()) !== seats) throw new Error(`the Students stepper stuck at ${await value.inputValue()}, want ${seats}`);
    await page.locator('.cls-ages').getByRole('radio', { name: '7–8' }).click();
    await linger(page, 1200);

    const paySeats = page.locator('.cls-pay-seats');
    await paySeats.waitFor({ timeout: 10000 });
    const offer = (await paySeats.innerText()).trim();
    if (offer !== `Pay ${want} for ${seats} seats`) throw new Error(`the bar offers "${offer}", want "Pay ${want} for ${seats} seats"`);
    await paySeats.click();
    const payMoney = page.locator('.cls-pay-money');
    await payMoney.waitFor();
    const confirm = (await payMoney.innerText()).trim();
    if (confirm !== `Pay ${want}`) throw new Error(`the dialog's button reads "${confirm}", want "Pay ${want}"`);
    await snap(page, 'class-pay');
    await linger(page, 1500);
    // The checkout the app opens, read as it passes: the page leaves for Lemon
    // Squeezy at once, and a response body is gone with the page.
    let buy = null;
    await page.route('**/api/classes/buy', async (route) => {
      const res = await route.fetch();
      buy = { status: res.status(), text: await res.text() };
      await route.fulfill({ response: res, body: buy.text });
    });
    await payMoney.click();
    await page.waitForURL(/lemonsqueezy\.com/, { timeout: 60000 }).catch(() => {});
    await page.unroute('**/api/classes/buy');
    if (!buy) throw new Error('tapping Pay never asked for a checkout');
    if (buy.status !== 201) throw new Error(`POST /api/classes/buy answered ${buy.status}: ${buy.text}`);
    const checkout = JSON.parse(buy.text);
    if (checkout.seats !== seats || checkout.price_display !== want) {
      throw new Error(`the checkout is for ${checkout.seats} seats at ${checkout.price_display}, want ${seats} at ${want}`);
    }

    await payOnLemonSqueezy(page, user.email, { marks: false });
    // Back on our site, on the class, which watches its seats arrive.
    const back = Date.now();
    if (!new URL(page.url()).search.includes(`class_paid=${checkout.class_id}`) && !(await page.locator('.cls-class').count())) {
      throw new Error(`came back from the checkout to ${page.url()}, not to the class`);
    }
    const start = page.locator('.cls-start');
    const note = page.locator('.cls-class .tb-bar-note');
    const deadline = back + 60000;
    while (Date.now() < deadline) {
      if ((await note.innerText().catch(() => '')).startsWith(`${seats} of ${seats} seats left`) && await start.isVisible().catch(() => false)) break;
      await page.waitForTimeout(500);
    }
    const shown = await note.innerText().catch(() => '(no bar)');
    if (!shown.startsWith(`${seats} of ${seats} seats left`)) throw new Error(`a minute after paying the class shows "${shown}", want ${seats} of ${seats} seats left`);
    const landed = ((Date.now() - back) / 1000).toFixed(1);
    await snap(page, 'class-seats-in');

    // The API agrees, and the money bought seats, not credits.
    const cls = await robotApi(`/api/classes/${checkout.class_id}`);
    if (cls.seats !== seats || cls.title !== className) throw new Error(`the API has "${cls.title}" with ${cls.seats} seats, want "${className}" with ${seats}`);
    const after = (await robotApi('/api/auth/me')).credits;
    if (after !== balance) throw new Error(`the teacher's balance moved ${balance} -> ${after}: class seats must never land on it`);

    // Start the class: the code to copy off the board, and the QR to scan.
    await start.click();
    await page.locator('.cls-start-confirm').click();
    const pinBox = page.locator('.cls-join-card .cls-pin');
    await pinBox.waitFor({ timeout: 15000 });
    const pin = (await pinBox.locator('.cls-pin-box').allInnerTexts()).join('');
    if (!/^\d{6}$/.test(pin)) throw new Error(`the class code reads "${pin}", want 6 digits`);
    const qr = page.locator('.cls-join-card svg.cls-qr');
    if (!(await qr.isVisible())) throw new Error('no QR code on the live class');
    const live = await robotApi(`/api/classes/${checkout.class_id}`);
    if (live.live?.pin !== pin) throw new Error(`the screen shows code ${pin}, the API ${live.live?.pin}`);
    await linger(page, 3000);
    await snap(page, 'class-live');

    // A student joins on a phone of their own (no account) and makes a hero;
    // the teacher opens it from the class: the gallery's hero page, its steps
    // while it is made, then live, read-only. The robot's drawing in its
    // default style is in the staging result cache, as in 'create', so this
    // hero calls no provider; the class's seats pay for it.
    const kidName = 'Robo';
    const kidCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' });
    let kidReady = '';
    try {
      const kid = await kidCtx.newPage();
      await kid.goto(`${BASE_URL}/join/${pin}`, { waitUntil: 'domcontentloaded' });
      await kid.locator('.cls-name-input').fill(kidName);
      await kid.locator('.cls-ages').getByRole('radio', { name: '7', exact: true }).click();
      await kid.locator('.cls-go').click();
      await kid.locator('.cls-draw').waitFor({ timeout: 30000 });
      await kid.locator('.cls-draw input[type=file]').setInputFiles(DRAWING);
      await kid.locator('.cls-make').click();
      await kid.locator('.cls-draw').waitFor({ state: 'detached', timeout: 60000 });
      await snap(kid, 'class-student');

      const tile = page.getByRole('button', { name: new RegExp(`^Open ${kidName}.*'s hero$`) });
      await tile.waitFor({ timeout: 30000 });
      await tile.click();
      await page.locator('.tb-hero-screen').waitFor({ timeout: 30000 });
      const startedAt = Date.now();
      const ready = page.locator('.tb-hero-screen[data-state="ready"]');
      while (Date.now() - startedAt < PIPELINE_TIMEOUT_MS && !(await ready.isVisible().catch(() => false))) {
        if (await page.locator('.tb-failed').count()) {
          throw new Error(`the student's hero failed at "${await page.locator('.tb-failed').getAttribute('data-step')}"`);
        }
        await page.waitForTimeout(5000);
      }
      if (!(await ready.isVisible().catch(() => false))) throw new Error(`the student's hero not ready after ${PIPELINE_TIMEOUT_MS / 60000} min`);
      kidReady = `${((Date.now() - startedAt) / 1000).toFixed(0)}s`;
      // The teacher looks and shares; making it again, renaming or deleting is the owner's.
      if (await page.locator('.tb-make-own').count()) throw new Error('the teacher is offered "Make your own" on a student\'s hero');
      if (!(await page.locator('.tb-share').isVisible()) || !(await page.locator('.tb-play').isVisible())) {
        throw new Error(`no Share and Play on the student's hero: ${await describe(page)}`);
      }
      await page.locator('.tb-hero-screen canvas').first().waitFor({ timeout: 60000 });
      await snap(page, 'class-hero');
      await page.locator('.tb-back').click();
      await pinBox.waitFor({ timeout: 15000 });
    } finally {
      await kidCtx.close();
    }

    await page.locator('.cls-end').click();
    await page.locator('.cls-end-confirm').click();
    await start.waitFor({ timeout: 15000 });

    // Leave teacher mode as it was found.
    if (!me.is_teacher) {
      await page.getByRole('button', { name: 'Back to classes' }).click();
      await newClass.waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: 'Account' }).click();
      await page.getByRole('button', { name: /teacher home/i }).click();
      await newClass.waitFor({ state: 'detached', timeout: 15000 });
    }
    return `school: ${school}; "${className}", ${seats} seats at ${want} (teacher price, from GET /api/classes); paid on Lemon Squeezy, seats in ${landed}s after returning; API seats=${cls.seats}, balance unchanged at ${after}; started: code ${pin} and a QR; student "${kidName}" joined and made a hero, ready in ${kidReady}, opened from the class live in 3D; ended`;
  });
} catch {
  exitCode = 1;
} finally {
  // Leave no trace. Every run makes the same hero from the same drawing, and
  // ten identical robots in the public gallery is exactly what a visitor
  // should never see; every run also signs up a fresh account (that tests
  // sign-up), and fifty robot_* accounts in the admin Users list hide the
  // real people. So the run deletes its own heroes, then its own account,
  // through the same endpoints a person uses - also when a step failed.
  // Never when signed in to an existing account (LOGIN_AS): that account and
  // its heroes are a person's, not this run's.
  await cleanup();
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
