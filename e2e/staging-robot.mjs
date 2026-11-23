// The staging robot: drives the real site the way a customer would, end to end.
//
//   landing page -> heroes gallery -> sign up -> buy credits (test mode of
//   whichever provider sells: grow_sandbox's own TEST page - one Fail, then
//   every pack - or Lemon Squeezy's checkout) -> upload a drawing -> every pipeline stage completes -> the
//   hero is in "My Creations" -> its page: the carousel, then moves -> Play ->
//   the game chooser -> Dance party, and the camera-free Robot Rumble ->
//   I run classes (the account sheet) -> My classes, on the switch under the header -> a new class whose seats it cannot cover from its credits,
//   paid for in money (test mode) -> the seats land on the class (not on
//   the robot's balance) -> Start class shows a PIN and a QR -> a student
//   joins on a phone and makes a hero -> the teacher opens it from the class
//   -> the same name from a second phone waits for the teacher, who removes it
//   -> Gallery shows the live class as one strip, one tap back to it
//   -> End class -> I run classes off: the switch goes
//   -> analytics: the run left its events in our own table, every one marked
//   as a robot's (so in no graph), PostHog was never loaded, and a fresh
//   browser arriving through ?via=test-fair is recorded with that door
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
// provider cost) and TEST-mode purchases, which are free: on Lemon Squeezy a
// credit pack (PACK) and a class's seats; on grow_sandbox (packs priced in
// ILS, checkout at /api/payments/sandbox/) one checkout ended with Fail, every
// pack on sale (or just PACK, if it names one) and a class's seats. The
// provider is read from GET /api/v1/packs, so either works unchanged.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkHeroLayout } from './hero-layout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const DRAWING = path.join(HERE, '..', 'marketing', 'concepts', 'assets', 'pairs', 'crayon-kid-drawing.jpg');
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
const ALL_STEPS = ['landing', 'gallery', 'signup', 'free', 'buy', 'create', 'profile', 'game', 'class', 'analytics'];
const STEPS = (process.env.STEPS || ALL_STEPS.join(',')).split(',').map((s) => s.trim());
const PIPELINE_TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS || 25 * 60 * 1000);
// DEMO=1 records a video of the same journey at a human pace, with a visible
// cursor, on a phone-sized portrait screen, and marks where the long pipeline wait starts and
// ends so e2e/cut-demo.sh can fast-forward it. The checks are identical.
const DEMO = process.env.DEMO === '1';
// A staging hero with a made toy, for the toy slide's layout (its own hero
// has none: making one spends a provider's credits). TOY_HERO=none skips it.
const TOY_HERO = (process.env.TOY_HERO ?? 'b4acf85a-a135-462d-b19b-5c4fc0d50793').trim();
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

/**
 * Leave a hero's page: its Back where there is one (a desktop, or a hero
 * opened from a class), else the logo (a phone: Raz, 2026-11-22).
 */
async function backFromHero(p) {
  const back = p.locator('.tb-hero-screen .tb-back');
  if (await back.isVisible().catch(() => false)) await back.click();
  else await p.locator('.tb-hero-screen > .tb-header .tb-logo').click();
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
    // The visible Continue (a phone-sized page has more than one), pressed
    // again if the first press did not take us back.
    const back = (u) => u.toString().startsWith(BASE_URL);
    for (let attempt = 1; attempt <= 3 && !back(new URL(page.url())); attempt++) {
      await page.getByRole('button', { name: /^continue/i }).or(page.getByRole('link', { name: /^continue/i }))
        .filter({ visible: true }).first().click({ timeout: 15000 }).catch(() => {});
      await page.waitForURL(back, { timeout: attempt === 3 ? 60000 : 20000 }).catch(() => {});
    }
    if (!back(new URL(page.url()))) throw new Error(`Continue did not come back from checkout: still at ${page.url().slice(0, 80)}`);
  }
}

// ---------------------------------------------------------------------------
// grow_sandbox: our own TEST checkout page (backend/app/api/payments_sandbox.py),
// served on the site's own origin under /api/payments/sandbox/checkout/<order>.
// It says "TEST - no real money" and has two buttons: Pay makes the SERVER
// send itself a signed callback, Fail marks the order failed. Either way it
// redirects back to the site.
// ---------------------------------------------------------------------------
const SANDBOX_PATH = '/api/payments/sandbox/checkout/';
const SANDBOX_TITLE = 'TEST checkout - no real money';
const CHECKOUT_URL = (u) => /lemonsqueezy\.com/.test(u.hostname) || u.pathname.startsWith(SANDBOX_PATH);

// Which provider sells here, read from what the API returns: grow_sandbox
// prices its packs in ILS, Lemon Squeezy in USD. Staging may go back to Lemon
// Squeezy, so nothing assumes either.
async function paymentsProvider() {
  const r = await fetch(`${BASE_URL}/api/v1/packs`);
  if (!r.ok) throw new Error(`GET /api/v1/packs answered ${r.status}`);
  const packs = await r.json();
  if (!Array.isArray(packs) || !packs.length) throw new Error(`nothing is on sale: GET /api/v1/packs returned ${JSON.stringify(packs)}`);
  return { name: packs.some((p) => p.currency === 'ILS') ? 'grow_sandbox' : 'lemonsqueezy', packs };
}

// "₪10", "₪10.50": the backend's agorot_display.
const ilsDisplay = (agorot) => `₪${Math.floor(agorot / 100)}${agorot % 100 ? `.${String(agorot % 100).padStart(2, '0')}` : ''}`;

// On the TEST page: check it is ours and says what it sells, press `button`
// ("Pay" or "Fail"), and come back to the site. Returns the order's page URL.
async function payOnSandbox(page, { button = 'Pay', amount = null, marks: marking = true } = {}) {
  await page.waitForURL((u) => u.pathname.startsWith(SANDBOX_PATH), { timeout: 60000 });
  await page.waitForLoadState('domcontentloaded');
  const orderUrl = page.url();
  if (!orderUrl.startsWith(BASE_URL)) throw new Error(`the TEST checkout is not on the site's own origin: ${orderUrl}`);
  const title = await page.title();
  if (title !== SANDBOX_TITLE) throw new Error(`the checkout page is titled "${title}", want "${SANDBOX_TITLE}"`);
  if (amount !== null) {
    const shown = (await page.locator('.amount').innerText()).trim();
    if (shown !== amount) throw new Error(`the TEST checkout asks for ${shown}, want ${amount}`);
  }
  await snap(page, `checkout-sandbox-${button.toLowerCase()}`);
  if (marking) mark('checkout');
  await linger(page, 1500);
  await page.getByRole('button', { name: button, exact: true }).click();
  await page.waitForURL((u) => u.toString().startsWith(BASE_URL) && !u.pathname.startsWith(SANDBOX_PATH), { timeout: 60000 });
  if (marking && button === 'Pay') mark('paid');
  return orderUrl;
}

// The robot's receipts, read back over the API.
const receipts = () => robotApi('/api/v1/receipts');

// The buy step on grow_sandbox, through the same Buy credits sheet: one
// checkout ended with Fail (nothing granted, no receipt), then every pack on
// sale (or just PACK, when it names one) paid, each adding exactly its
// credits and one receipt.
async function buyOnSandbox(page, packs) {
  const openSheet = async () => {
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    await page.locator('.header-auth-user-button').click();
    await page.getByRole('button', { name: /buy credits/i }).click();
  };
  const packCard = async (pack) => {
    const card = page.locator(`.buy-credits-pack[data-pack="${pack.slug}"]`);
    await card.waitFor({ timeout: 20000 });
    const price = (await card.locator('.buy-credits-pack-price').innerText()).trim();
    if (price !== pack.price_display) throw new Error(`the ${pack.slug} pack shows "${price}", want "${pack.price_display}"`);
    const credits = (await card.locator('.buy-credits-pack-credits').innerText()).trim();
    if (credits !== `${pack.credits} credits`) throw new Error(`the ${pack.slug} pack shows "${credits}", want "${pack.credits} credits"`);
    return card;
  };
  const balance = async () => (await robotApi('/api/v1/me')).credits;
  const wanted = packs.some((p) => p.slug === PACK) ? packs.filter((p) => p.slug === PACK) : packs;
  mark('buy_start');

  // Fail: back on the site, nothing granted and no receipt.
  const start = await balance();
  const startReceipts = await receipts();
  const failPack = [...packs].sort((a, b) => a.price_cents - b.price_cents)[0];
  await openSheet();
  await (await packCard(failPack)).click();
  const failedOrder = await payOnSandbox(page, { button: 'Fail', amount: failPack.price_display, marks: false });
  if (new URL(page.url()).searchParams.get('checkout') !== 'failed') throw new Error(`Fail came back to ${page.url()}, without checkout=failed`);
  await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
  await page.waitForTimeout(5000);
  await snap(page, 'checkout-failed-back');
  const shownAfterFail = await creditsShown(page);
  const afterFail = await balance();
  if (afterFail !== start || shownAfterFail !== start) throw new Error(`a failed checkout moved the balance ${start} -> ${afterFail} (shown ${shownAfterFail})`);
  if ((await receipts()).length !== startReceipts.length) throw new Error('a failed checkout left a receipt');
  // The order itself is failed for good: its page offers no Pay any more.
  await page.goto(failedOrder, { waitUntil: 'domcontentloaded' });
  const status = (await page.locator('.status').innerText().catch(() => '')).trim();
  if (status !== 'This order is failed.') throw new Error(`the failed order's page says "${status}", want "This order is failed."`);
  if (await page.getByRole('button', { name: 'Pay', exact: true }).count()) throw new Error('a failed order still offers Pay');
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });

  // Pay: each pack adds exactly its credits, and one receipt that says so.
  const bought = [];
  for (const [i, pack] of wanted.entries()) {
    const before = await balance();
    const receiptsBefore = await receipts();
    await openSheet();
    const card = await packCard(pack);
    if (DEMO) { await card.hover(); await page.waitForTimeout(2500); }
    await card.click();
    await payOnSandbox(page, { amount: pack.price_display, marks: i === 0 });
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    const want = before + pack.credits;
    const back = Date.now();
    let shown = await creditsShown(page).catch(() => before);
    while (Date.now() - back < 60000 && shown < want) {
      await page.waitForTimeout(2000);
      shown = await creditsShown(page).catch(() => before);
    }
    const landed = ((Date.now() - back) / 1000).toFixed(1);
    if (shown !== want) throw new Error(`after paying ${pack.price_display} for ${pack.slug} the balance shows ${shown}, want ${before} + ${pack.credits} = ${want}`);
    // Exactly: still the same a moment later, and the API agrees.
    await page.waitForTimeout(3000);
    const api = await balance();
    if (api !== want) throw new Error(`after paying for ${pack.slug} the API balance is ${api}, want exactly ${want}`);
    if (i === 0) mark('credits');
    const list = await receipts();
    if (list.length !== receiptsBefore.length + 1) throw new Error(`paying for ${pack.slug} left ${list.length - receiptsBefore.length} new receipts, want 1`);
    const r = list[0];
    if (r.pack !== pack.slug || r.credits !== pack.credits || r.paid_display !== pack.price_display || r.class_id) {
      throw new Error(`the receipt for ${pack.slug} reads ${JSON.stringify(r)}, want pack ${pack.slug}, ${pack.credits} credits, ${pack.price_display}`);
    }
    await snap(page, `bought-${pack.slug}`);
    bought.push(`${pack.slug} ${pack.price_display} +${pack.credits} in ${landed}s (receipt ${r.paid_display}${r.test_mode ? ', test' : ''})`);
  }
  if (DEMO) { await page.locator('.header-auth-credits').hover(); await page.waitForTimeout(3000); }
  mark('credits_end');
  return `grow_sandbox TEST checkout: Fail granted nothing (balance ${start}, no receipt, order failed); paid ${bought.join('; ')}; balance ${start} -> ${await balance()}`;
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
// VIEWPORT=390x844 runs it at another size (a phone-sized check of a new screen).
const SIZE = /^(\d+)x(\d+)$/.exec(process.env.VIEWPORT || "");
const VIEW = DEMO ? { width: 540, height: 1170 } : SIZE ? { width: +SIZE[1], height: +SIZE[2] } : { width: 1280, height: 900 };
const context = await browser.newContext({
  viewport: VIEW, locale: 'en-US', timezoneId: 'America/New_York',
  ...(DEMO ? { isMobile: true, hasTouch: true, recordVideo: { dir: OUT, size: VIEW } } : {}),
});
if (DEMO) await context.addInitScript(CURSOR_SCRIPT);
const page = await context.newPage();
// Analytics: an automated browser must never load PostHog (the analytics step).
const posthogRequests = [];
context.on('request', (r) => { if (/posthog/i.test(new URL(r.url()).hostname) || /\/assets\/posthog-/.test(r.url())) posthogRequests.push(r.url()); });
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
// Pay after the reveal (backend FREE_PAINTING, E-006): read from /me at
// sign-up. When on, the 'free' step makes the hero with 0 credits, its
// painting is free, it pauses before 3D, and 'create' finishes that same hero
// after 'buy' has paid. When off, the robot runs as it always has.
let freePainting = false;
let freeHeroUrl = null;

/** The two questions (the WhoFor board), over the first hero being made. */
async function answerTwoQuestions(page) {
  const ask = page.getByRole('dialog', { name: 'Two quick questions' });
  await ask.waitFor({ timeout: 20000 });
  const asked = await ask.locator('.tb-ask-title').allInnerTexts();
  if (asked.join(' | ') !== "What's it for? | Who drew it?") throw new Error(`the two questions read [${asked.join(' | ')}]`);
  await ask.getByRole('button', { name: 'A gift' }).click();
  await ask.getByRole('button', { name: 'A kid' }).click();
  const picked = await ask.locator('[aria-pressed="true"]').allInnerTexts();
  if (picked.join(',') !== 'A gift,A kid') throw new Error(`chosen answers read [${picked.join(', ')}]`);
  await snap(page, 'who-for');
  await linger(page, 1500);
  await ask.getByRole('button', { name: 'Done' }).click();
  await ask.waitFor({ state: 'detached', timeout: 5000 });
  const traits = await page.evaluate(() => localStorage.getItem('hm_traits'));
  if (traits !== '{"purpose":"gift","who":"kid"}') throw new Error(`the answers were kept as ${traits}`);
}

/**
 * Wait on the hero screen until `done` is visible. A failed stage throws,
 * unless it is `pauseAt` failing with `pauseCode`: then that pause is the
 * answer, and this returns 'paused'.
 */
async function waitForHero(page, done, { pauseAt = null, pauseCode = null } = {}) {
  const deadline = Date.now() + PIPELINE_TIMEOUT_MS;
  let lastLine = '';
  while (Date.now() < deadline) {
    if (done && await done.isVisible().catch(() => false)) return 'done';
    // Out of credits is a paywall, not a failure: the hero screen shows it as
    // tb-making[data-paywall] (no red, no cross), not tb-failed.
    const paused = page.locator('.tb-making[data-paywall]');
    if (await paused.count()) {
      const name = await paused.getAttribute('data-step').catch(() => '?');
      if (pauseAt && name === pauseAt && pauseCode === 'not_enough_credits') return 'paused';
      const label = await paused.locator('.tb-status-name').innerText().catch(() => '?');
      throw new Error(`hero paused for credits at "${name}" (${label}), not the expected ${pauseAt}/${pauseCode}`);
    }
    const failed = page.locator('.tb-failed');
    if (await failed.count()) {
      const name = await failed.getAttribute('data-step').catch(() => '?');
      const code = await failed.getAttribute('data-error').catch(() => '?');
      if (pauseAt && name === pauseAt && code === pauseCode) return 'paused';
      const label = await failed.locator('.tb-status-name').innerText().catch(() => '?');
      throw new Error(`stage "${name}" failed (${code}): ${label}`);
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
  throw new Error(`hero not done after ${PIPELINE_TIMEOUT_MS / 60000} min; last: ${lastLine}`);
}

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
  const r = await fetch(`${BASE_URL}/api/v1/login`, {
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
    const list = await (await fetch(`${BASE_URL}/api/v1/gallery?view=mine`, { headers: auth })).json();
    const mine = (list.data || []).filter((c) => c.mine && c.owner?.username === user.username);
    for (const c of mine) {
      const r = await fetch(`${BASE_URL}/api/v1/heroes/${c.id}`, { method: 'DELETE', headers: auth });
      console.log(`cleanup: deleted hero ${c.id} -> ${r.status}`);
      if (!r.ok) throw new Error(`hero ${c.id} could not be deleted (${r.status})`);  // a bug
      heroes++;
    }
    const r = await fetch(`${BASE_URL}/api/v1/me`, {
      method: 'DELETE',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: user.username }),
    });
    console.log(`cleanup: deleted account ${user.username} -> ${r.status}`);
    if (r.status !== 204) throw new Error(`account ${user.username} could not be deleted (${r.status})`);
    // The deleted account's token must stop working: that is the promise.
    const after = await fetch(`${BASE_URL}/api/v1/me`, { headers: auth });
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
    // Staging never looks like production (frontend/apply-env-look.sh): its
    // own icon, app name and a STAGING tag. Production's look is read from
    // the registry, never copied here.
    const prod = JSON.parse(readFileSync(path.join(HERE, '../devops/railway/project.json'), 'utf8')).environments.production.urls.frontend;
    const env = await page.evaluate(() => document.documentElement.dataset.env);
    if (env !== 'staging') throw new Error(`staging is not marked as staging (data-env=${env}): it looks like production`);
    // What Android installs is what Chrome reads as this page's manifest, so
    // ask Chrome, not the server. It must also never be a cached copy: the
    // service worker and a long cache once kept a staging install named and
    // drawn like production.
    const cdp = await page.context().newCDPSession(page);
    const appManifest = await cdp.send('Page.getAppManifest');
    await cdp.detach();
    const manifest = JSON.parse(appManifest.data || '{}');
    if (!/staging/i.test(manifest.short_name || '')) throw new Error(`installed staging app is named "${manifest.short_name}", like production (${appManifest.url})`);
    if (!/[?&]env=staging/.test(appManifest.url)) throw new Error(`staging's manifest is ${appManifest.url}, the URL the service worker precaches`);
    const manifestCache = (await page.request.get(appManifest.url)).headers()['cache-control'] || '';
    if (!/no-cache|no-store|max-age=0/.test(manifestCache)) throw new Error(`the manifest is cacheable ("${manifestCache}"): installed apps would keep an old name and icon`);
    // The installed app's icon is staging's own; the in-app logo keeps
    // production's picture, with the tag.
    const icon = manifest.icons?.[0]?.src || '';
    const [ours, theirs] = await Promise.all([new URL(icon, appManifest.url).href, `${prod}/app-icon.png`].map(async (u) => (await page.request.get(u)).body()));
    if (ours.equals(theirs)) throw new Error(`staging's installed app uses production's icon (${icon})`);
    const tag = await page.evaluate(() => getComputedStyle(document.querySelector('.tb-logo'), '::after').content);
    if (!/staging/i.test(tag)) throw new Error(`no STAGING tag on the logo (${tag})`);
    // The promise above the gallery (Landing.tsx): its three pictures load,
    // its own buttons are on screen and the bar is away; scrolled past them,
    // Make a hero is in the bar.
    await page.locator('.tb-landing').waitFor({ timeout: 15000 });
    const pics = await page.$$eval('.tb-landing-pic img', (imgs) => imgs.map((i) => (i.complete && i.naturalWidth > 0 ? '' : i.src)));
    await page.waitForFunction(() => [...document.querySelectorAll('.tb-landing-pic img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 })
      .catch(() => { throw new Error(`landing pictures did not load: ${pics.filter(Boolean).join(', ')}`); });
    if (!(await page.locator('.tb-landing-make:visible').count())) throw new Error('the landing shows no Make a hero');
    await page.locator('.tb-bar--away').waitFor({ state: 'attached', timeout: 5000 })
      .catch(() => { throw new Error('the bar shows under the landing\'s own buttons'); });
    await page.locator('.tb-screen-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.locator('.tb-new-hero').waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => { throw new Error('scrolled past the landing, Make a hero is not in the bar'); });
    await page.locator('.tb-screen-body').evaluate((el) => { el.scrollTop = 0; });
    await linger(page, 3500);
    mark('landing');
    return `HTTP ${res.status()}, looks like staging ("${manifest.short_name}", own icon); the landing's 3 pictures loaded, its buttons on screen and the bar away, then in the bar once scrolled`;
  });

  await step(page, 'gallery', async () => {
    const items = page.locator('.creation-gallery-item');
    await items.first().waitFor({ timeout: 45000 });
    const n = await items.count();
    // Signed out the gallery is Editors' choice alone: no chips, and the
    // public listing holds only starred heroes (All heroes is admin-only).
    if (await page.locator('.tb-gallery-chips').count()) throw new Error('signed-out gallery shows filter chips');
    const pub = await (await page.request.get(BASE_URL + '/api/v1/gallery')).json();
    const leaked = (pub.data || []).filter((c) => !c.featured);
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
    // A hero has its own address, and the browser's (Android's) Back returns
    // to the gallery: it once left the site for about:blank.
    const heroPath = new URL(page.url()).pathname;
    if (!/^\/hero\/[^/]+$/.test(heroPath)) throw new Error(`an open hero is at ${heroPath}, not /hero/<id>`);
    await page.goBack();
    await items.first().waitFor({ timeout: 15000 }).catch(() => {});
    const back = new URL(page.url());
    if (back.origin !== new URL(BASE_URL).origin || back.pathname !== '/') throw new Error(`Back from a hero left the app: ${page.url()}`);
    return `${n} Editors' choice heroes shown, no chips signed out; opened one at ${heroPath}, and Back returned to the gallery`;
  });

  await step(page, 'signup', async () => {
    mark('signup_start');
    await page.locator('.header-auth-button').click();
    // The grown-up check comes first, the first time in a browser (the
    // GrownUp board): Not yet goes back with no sign-in sheet; asked again,
    // Yes goes on to it.
    const grownUp = page.getByRole('dialog', { name: 'Is a grown-up with you?' });
    await grownUp.waitFor({ timeout: 15000 });
    if (await page.locator('#username').count()) throw new Error('the sign-in sheet opened before the grown-up check');
    await snap(page, 'grown-up-check');
    await linger(page, 1200);
    await grownUp.getByRole('button', { name: 'Not yet' }).click();
    await grownUp.waitFor({ state: 'detached', timeout: 5000 });
    if (await page.locator('#username').count()) throw new Error('"Not yet" opened the sign-in sheet');
    await page.locator('.header-auth-button').click();
    await grownUp.getByRole('button', { name: 'Yes' }).click();
    await page.locator('#username').waitFor({ timeout: 15000 });
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
    // The account keeps the time a grown-up said Yes.
    const adult = await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        const me = await (await fetch('/api/v1/me', { headers: { Authorization: `Bearer ${localStorage.getItem('heromaker_jwt_token')}` } })).json();
        if (me.adult_confirmed_at) return me.adult_confirmed_at;
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    });
    if (!adult) throw new Error('the account did not keep the time the grown-up said Yes (adult_confirmed_at)');
    freePainting = await page.evaluate(async () => (await (await fetch('/api/v1/me', { headers: { Authorization: `Bearer ${localStorage.getItem('heromaker_jwt_token')}` } })).json()).free_painting === true);
    const balance = await creditsShown(page);
    // With no credits, Make a hero goes to Buy credits first, saying why: no
    // photo is taken or uploaded for a hero that cannot be paid for.
    let gate = freePainting ? '; free first painting due (FREE_PAINTING on)' : '';
    if (balance === 0 && !DEMO && !freePainting) {
      await page.locator('.tb-new-hero').click();
      const why = page.locator('.buy-credits-why');
      await why.waitFor({ timeout: 15000 });
      if (await page.getByRole('dialog', { name: 'New hero' }).count()) throw new Error('Make a hero opened the photo sheet with 0 credits');
      gate = `; Make a hero with 0 credits opened Buy credits ("${(await why.innerText()).trim()}")`;
      await page.keyboard.press('Escape');
      await why.waitFor({ state: 'detached', timeout: 5000 });
    }
    return `grown-up check: Not yet went back, Yes went on, kept on the account (${adult}); ${user.username}, balance ${balance}${gate}`;
  });

  await step(page, 'free', async () => {
    if (!freePainting) return 'skipped: no free painting for this account (FREE_PAINTING off)';
    if (await creditsShown(page) !== 0) throw new Error('the free painting needs an account with 0 credits');
    // With 0 credits, Make a hero opens the photo sheet, not Buy credits
    // (and records make_started, as it does for a paying account).
    await page.locator('.tb-new-hero').click();
    const sheet = page.getByRole('dialog', { name: 'New hero' });
    await sheet.waitFor({ timeout: 15000 });
    if (await page.locator('.buy-credits-why').count()) throw new Error('Make a hero opened Buy credits for the free painting');
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached', timeout: 5000 });
    const input = page.locator('.header-upload-buttons input[type=file]');
    await input.setInputFiles(DRAWING);
    const go = page.locator('button.post-upload-action-primary');
    await go.waitFor({ timeout: 60000 });
    if (await page.locator('.post-upload-actions-modal .tb-btn-trail').count()) throw new Error('Make my hero shows a credit cost for the free painting');
    if (await page.locator('.post-upload-actions-modal .tb-bar-note').count()) throw new Error(`the make sheet says "${await page.locator('.post-upload-actions-modal .tb-bar-note').innerText()}" for the free painting`);
    await go.click();
    await page.locator('.tb-hero-screen').waitFor({ timeout: 60000 });
    freeHeroUrl = page.url();
    mark('pipeline_start');
    await answerTwoQuestions(page);
    // The painting is made for free, then the hero waits for payment before 3D.
    const how = await waitForHero(page, null, { pauseAt: 'meshy_3d', pauseCode: 'not_enough_credits' });
    if (how !== 'paused') throw new Error('the free hero did not pause before 3D');
    // Raz (2026-11-23): the paywall is not a failure. The painting, proud: no
    // red, no cross, no "failed"; "It's painted!" and the way on.
    const wall = await page.evaluate(() => ({
      title: document.querySelector('.tb-paywall-title')?.textContent?.trim(),
      failedWord: /fail/i.test(document.querySelector('.tb-hero-screen')?.innerText || ''),
      cross: document.querySelectorAll('.tb-failed, .tb-status-name--failed, .tb-step-dot--failed, .tb-slide-failed-mark').length,
      slide: document.querySelector('.tb-live-stage')?.getAttribute('data-slide'),
      bring: [...document.querySelectorAll('.tb-bring-to-life')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
    }));
    if (wall.title !== 'It’s painted!' || wall.failedWord || wall.cross || wall.slide !== 'painting' || !/^Bring it to life\s*· \d+ credits$/.test(wall.bring[0] || '')) {
      throw new Error(`the paywall is not Maya's: ${JSON.stringify(wall)}`);
    }
    await snap(page, 'free-painting-paused');
    const balance = await creditsShown(page);
    if (balance !== 0) throw new Error(`balance after the free painting is ${balance}, want 0`);
    // Home again, as after any other step: the paused hero's own Buy credits
    // button would be a second match for the buy step's menu row.
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    return 'with 0 credits: Make my hero (no cost shown), the painting made free, paused before 3D (not_enough_credits), balance still 0';
  });

  await step(page, 'buy', async () => {
    const provider = await paymentsProvider();
    if (provider.name === 'grow_sandbox') return buyOnSandbox(page, provider.packs);
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
    if (freeHeroUrl) {
      // Paid now: the paused free hero goes on from 3D with its paywall
      // button, "Bring it to life · N credits" (Maya's design, #350).
      await page.goto(freeHeroUrl);
      const again = page.getByRole('button', { name: /Bring it to life/ });
      await again.waitFor({ timeout: 30000 });
      await again.click();
      // The pause stays on screen until the retry is picked up; only then
      // does a failed stage mean anything.
      await page.locator('.tb-making[data-paywall], .tb-failed').waitFor({ state: 'detached', timeout: 60000 });
      await waitForHero(page, page.locator('.tb-hero-screen[data-state="ready"]'));
      mark('pipeline_end');
      heroName = await page.locator('.tb-live-stage .tb-live-name .tb-tile-name').first().innerText().catch(() => null);
      mark('ready_end');
      return `the free hero, paid for, went on with Try again; all stages completed; "${heroName || 'hero'}" shown ready to play`;
    }
    mark('upload');
    const input = page.locator('.header-upload-buttons input[type=file]');
    await input.setInputFiles(DRAWING);
    const go = page.locator('button.post-upload-action-primary');
    await go.waitFor({ timeout: 60000 });
    if (await go.isDisabled()) throw new Error(`Go is disabled: ${await describe(page)}`);
    // The style picker: four cards, Pixar picked. The robot keeps Pixar on
    // purpose - its drawing's Pixar painting is in the staging result cache.
    const cards = page.locator('.tb-styles .tb-style');
    await cards.first().waitFor({ timeout: 15000 });
    const styles = await cards.evaluateAll((els) => els.map((el) => `${el.dataset.style}${el.getAttribute('aria-checked') === 'true' ? '*' : ''}`));
    if (styles.join(',') !== 'pixar*,lego,minecraft,anime') throw new Error(`style cards are [${styles.join(', ')}], want pixar* (picked), lego, minecraft, anime`);
    await linger(page, 2500);
    await go.click();
    await page.locator('.tb-hero-screen').waitFor({ timeout: 60000 });
    mark('pipeline_start');
    // The two questions: over the first hero being made, once per browser,
    // after it is paid for. Both are asked here (not a class).
    await answerTwoQuestions(page);
    await waitForHero(page, page.locator('.tb-hero-screen[data-state="ready"]'));
    mark('pipeline_end');
    // The hero's name is on its name card, over the stage (the header is the site's).
    heroName = await page.locator('.tb-live-stage .tb-live-name .tb-tile-name').first().innerText().catch(() => null);
    if (DEMO) {
      await page.waitForTimeout(1500);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 320); await page.waitForTimeout(900); }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(1500);
    }
    mark('ready_end');
    return `the two questions asked over the hero being made, answered A gift / A kid, Done; all stages completed; "${heroName || 'hero'}" shown ready to play`;
  });

  await step(page, 'profile', async () => {
    await backFromHero(page);
    // A fresh hero is not starred, so it is not in Editors' choice (the
    // default view): it is found under My heroes. (A teacher, LOGIN_AS, may
    // be on My classes, which has no chips: the switch goes to Gallery first.)
    const gallerySeg = page.locator('.tb-switchbar .tb-seg-gallery');
    if (await gallerySeg.count()) await gallerySeg.click();
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
    // The hero's page is a carousel of the drawing, the painting and the live
    // hero. A ready hero opens on how it was made (Raz, 2026-10-25): the
    // drawing, then the painting once loaded, then the live hero once the 3D
    // has; then it is swipe only. Recorded from the first frame of the page.
    // Every change is recorded with the value it replaced, so slides that
    // follow each other within one task are all seen (not just the last).
    await page.evaluate(() => {
      window.__intro = [];
      window.__states = [];
      const push = (v) => { if (v && window.__intro.at(-1) !== v) window.__intro.push(v); };
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'attributes' && r.attributeName === 'data-slide' && r.target.classList.contains('tb-live-stage')) {
            push(r.oldValue);
            push(r.target.getAttribute('data-slide'));
          } else if (r.type === 'childList') {
            for (const n of r.addedNodes) {
              const s = n.nodeType === 1 && (n.matches('.tb-live-stage') ? n : n.querySelector('.tb-live-stage'));
              if (s) push(s.getAttribute('data-slide'));
            }
          }
        }
        const st = document.querySelector('.tb-hero-screen')?.getAttribute('data-state');
        const seen = `${st}|${document.querySelector('.tb-live-stage')?.getAttribute('data-slides')}`;
        if (st && window.__states.at(-1)?.seen !== seen) window.__states.push({ seen, t: Math.round(performance.now()) });
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-slide', 'data-state', 'data-slides'] });
    });
    await page.locator('.creation-gallery-item.creation-gallery-status-completed').first().click();
    const stage = page.locator('.tb-live-stage');
    await stage.waitFor({ timeout: 20000 });
    const slideNow = () => stage.getAttribute('data-slide');
    await page.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-slide') === 'hero', null, { timeout: 90000 })
      .catch(async () => { throw new Error(`the opening never reached the hero: ${JSON.stringify(await page.evaluate(() => window.__intro))}`); });
    const intro = (await page.evaluate(() => window.__intro)).join(' > ');
    if (intro !== 'drawing > painting > hero') throw new Error(`the hero's page opened ${intro}, not drawing > painting > hero; screen states ${JSON.stringify(await page.evaluate(() => window.__states))}`);
    // The chapters replace the dots (Raz, 2026-11-22): one tile per slide,
    // the hero's own chosen now; the site's header (the logo) stays.
    const chapters = await page.evaluate(() => ({
      tiles: [...document.querySelectorAll('.tb-chapter')].map((c) => c.dataset.chapter).join(','),
      chosen: document.querySelector('.tb-chapter[aria-current="true"]')?.dataset.chapter,
      slides: document.querySelector('.tb-live-stage').getAttribute('data-slides').replace(/-[a-z]+/g, ''),
      dots: document.querySelectorAll('.tb-hero-screen .tb-carousel-dot').length,
      logo: !!document.querySelector('.tb-hero-screen > .tb-header .tb-logo'),
    }));
    if (chapters.tiles !== chapters.slides || chapters.chosen !== 'hero' || chapters.dots) throw new Error(`the chapters are ${JSON.stringify(chapters)}`);
    if (!chapters.logo) throw new Error("the hero's page has lost the site's header (no logo)");
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
    const title = (await page.locator('.tb-live-stage .tb-live-name .tb-tile-name').first().innerText()).trim();
    if (!title) throw new Error("the name card shows no hero name");

    // A swipe moves one slide, and the carousel goes round: hero, drawing,
    // painting, hero.
    const swipe = async () => {
      const box = await stage.boundingBox();
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * 0.75, y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * (0.75 - 0.06 * i), y);
      await page.mouse.up();
      await page.waitForTimeout(450);
      return slideNow();
    };
    // The owner's hero has a fourth slide after the hero, its action figure
    // (ActionFigure.tsx): read the order from the stage, then go round it.
    const slideList = (await stage.getAttribute('data-slides')).split(',');
    const h = slideList.indexOf('hero');
    const fromHero = [...slideList.slice(h + 1), ...slideList.slice(0, h + 1)];
    if (slideList.slice(0, 3).join(',') !== 'drawing,painting,hero') throw new Error(`the slides are ${slideList.join(',')}`);
    const order = [];
    for (let i = 0; i < fromHero.length; i++) order.push(await swipe());
    if (order.join(',') !== fromHero.join(',')) throw new Error(`swiping went hero > ${order.join(' > ')}, not ${fromHero.join(' > ')}`);
    await snap(page, 'carousel');
    if (slideList.includes('figure')) {
      // On the action figure: its buy button (or its parts, once bought), in the dock.
      // Its controls live in the stage's fixed dock (one layer per slide), not on the slide.
      const figure = stage.locator('[data-dock="figure"]');
      if ((await figure.locator('.tb-figure-buy, .tb-figure-dock').count()) < 1) throw new Error('the action figure slide has nothing in its dock');
    }
    // A tap on the drawing opens it full screen; Back returns to the drawing.
    for (let i = 0; i < slideList.length && (await slideNow()) !== 'drawing'; i++) await swipe();
    await stage.locator('.tb-slide[data-slide="drawing"] .tb-slide-open').click();
    await page.locator('.tb-drawing-full').waitFor({ timeout: 5000 });
    await page.goBack();
    await page.locator('.tb-drawing-full').waitFor({ state: 'detached', timeout: 5000 });
    if ((await slideNow()) !== 'drawing') throw new Error(`Back from the full drawing landed on "${await slideNow()}"`);
    if (DEMO) await page.waitForTimeout(2000);
    // ONE drawing (Raz: "It needs to be exactly like the same element... Don't
    // duplicate"): held part-way through a slow swipe, either way, and while
    // it lands, never two pictures of the drawing on the stage. (The chapters
    // beside it show the drawing too: they are not on the stage.)
    const drawingsInView = () => page.evaluate(() => {
      const st = document.querySelector('.tb-live-stage').getBoundingClientRect();
      return [...document.querySelectorAll('.tb-live-stage img')].filter((im) => {
        if (!/original\.jpg/.test(im.currentSrc || im.src)) return false;
        let o = 1;
        for (let e = im; e && e !== document.body; e = e.parentElement) {
          const c = getComputedStyle(e);
          if (c.visibility === 'hidden' || c.display === 'none') return false;
          o *= +c.opacity;
        }
        const r = im.getBoundingClientRect();
        return o >= 0.05 && r.width > 4 && r.right > st.left + 2 && r.left < st.right - 2;
      }).length;
    });
    // ONE name card (Raz: "Why 2 label elements if it's same label? Keep it
    // there"): one element in the DOM, at most one in view, and it never
    // moves sideways while the slides pass under it. It is on every slide,
    // over the card's bottom start (Raz, 2026-11-22).
    const nameCard = () => page.evaluate(() => {
      const st = document.querySelector('.tb-live-stage');
      const cards = [...st.querySelectorAll('.tb-live-name:not(.tb-figure-dock)')];
      const seen = cards.filter((c) => {
        let o = 1;
        for (let e = c; e && e !== document.body; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.visibility === 'hidden' || cs.display === 'none') return false;
          o *= +cs.opacity;
        }
        return o >= 0.05;
      });
      return { inDom: cards.length, seen: seen.length, x: cards[0] ? cards[0].getBoundingClientRect().left : null };
    });
    const cardAtRest = await nameCard();
    const checkCard = (c, way) => {
      if (c.inDom !== 1 || c.seen > 1) throw new Error(`a slow swipe ${way} had ${c.inDom} name cards (${c.seen} in view), not one`);
      if (Math.abs(c.x - cardAtRest.x) > 1) throw new Error(`a slow swipe ${way} moved the name card ${Math.round(c.x - cardAtRest.x)}px sideways`);
    };
    const held = async (fromShare, share, way) => {
      const box = await stage.boundingBox();
      const y = box.y + box.height * 0.45;
      const x0 = box.x + box.width * fromShare;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + box.width * share * i / 10, y);
      await page.waitForTimeout(120);
      const n = await drawingsInView();
      checkCard(await nameCard(), way);
      await page.mouse.up();
      const landing = [];
      for (let i = 0; i < 4; i++) { await page.waitForTimeout(70); landing.push(await drawingsInView()); }
      await page.waitForTimeout(300);
      return [n, ...landing];
    };
    // From the drawing: a short one that snaps back, then a quarter and three
    // quarters each way, ending on the drawing.
    for (const [fromShare, share, way] of [[0.9, -0.12, 'that snaps back'], [0.9, -0.25, 'to the painting'], [0.1, 0.25, 'back to the drawing'],
      [0.9, -0.5, 'to the painting'], [0.1, 0.5, 'back to the drawing'],
      [0.9, -0.75, 'to the painting'], [0.1, 0.75, 'back to the drawing']]) {
      const seen = await held(fromShare, share, way);
      if (seen.some((n) => n > 1) || seen[0] !== 1) throw new Error(`a slow swipe ${way} showed ${seen.join('/')} drawings, not one`);
    }
    if ((await slideNow()) !== 'drawing') throw new Error(`the slow swipes ended on "${await slideNow()}", not the drawing`);
    // The moves are the live hero's own controls, inside its slide (Raz: "we
    // can't make the drawing do a flip or dance"): none in view on the
    // drawing or the painting, all four on the hero.
    const movesInView = () => page.evaluate(() => {
      const st = document.querySelector('.tb-live-stage').getBoundingClientRect();
      return [...document.querySelectorAll('.tb-move')].filter((m) => {
        const b = m.getBoundingClientRect();
        let o = 1;
        for (let e = m; e && e !== document.body; e = e.parentElement) o *= +getComputedStyle(e).opacity;
        return !m.closest('[inert]') && o >= 0.5 && b.width > 0 && b.left >= st.left - 1 && b.right <= st.right + 1 && b.top >= st.top - 1 && b.bottom <= st.bottom + 1;
      }).length;
    });
    const movesSeen = { drawing: await movesInView() };
    if (movesSeen.drawing !== 0) throw new Error(`${movesSeen.drawing} moves show on the drawing`);
    if ((await swipe()) !== 'painting') throw new Error(`a swipe from the drawing landed on "${await slideNow()}"`);
    movesSeen.painting = await movesInView();
    if (movesSeen.painting !== 0) throw new Error(`${movesSeen.painting} moves show on the painting`);
    // The name card stays put on every slide; the moves come in with the
    // hero and go with it: held part-way between the painting and the hero,
    // either way, the name card is fully there, and half way the moves are not.
    const dockAt = async (fromShare, share) => {
      const box = await stage.boundingBox();
      const y = box.y + box.height * 0.45;
      const x0 = box.x + box.width * fromShare;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(x0 + box.width * share * i / 10, y);
      await page.waitForTimeout(120);
      const o = await page.evaluate(() => {
        const eff = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return 0;
          let v = 1;
          for (let e = el; e && e !== document.body; e = e.parentElement) v *= +getComputedStyle(e).opacity;
          return v;
        };
        return { card: eff('.tb-live-stage [data-dock="name"] .tb-live-name'), moves: eff('.tb-live-stage [data-dock="moves"] .tb-hero-moves') };
      });
      await page.mouse.up();
      await page.waitForTimeout(450);
      return o;
    };
    // Each held swipe (past the snap point) lands: to the hero, then back to
    // the painting, so every pair starts and ends on the painting.
    for (const share of [0.25, 0.5, 0.75]) {
      for (const [fromShare, signed, from, way] of [[0.9, -share, 'painting', 'to the hero'], [0.1, share, 'hero', 'back to the painting']]) {
        if ((await slideNow()) !== from) throw new Error(`before a held swipe ${way} the stage was on "${await slideNow()}"`);
        const o = await dockAt(fromShare, signed);
        if (o.card < 0.98) throw new Error(`held ${share * 100}% ${way}, the name card faded to ${o.card.toFixed(2)}`);
        if (share === 0.5 && o.moves > 0.05) throw new Error(`held half way ${way}, the moves still show (${o.moves.toFixed(2)})`);
      }
    }
    if ((await swipe()) !== 'hero') throw new Error(`a swipe from the painting landed on "${await slideNow()}"`);
    await page.locator('.tb-move:not([disabled])').first().waitFor({ timeout: 90000 });
    movesSeen.hero = await movesInView();
    if (movesSeen.hero !== 4) throw new Error(`${movesSeen.hero} of 4 moves inside the live hero's stage`);
    // The hero's page (proposal A): the name card at the card's bottom start,
    // the moves one column at its bottom end, inside the card; Share and Play
    // one row of one width, Play last, below the card (taller than wide) or in
    // the rail beside it (wider than tall, as at the robot's 1280x900).
    const shape = await page.evaluate(() => {
      const st = document.querySelector('.tb-live-stage').getBoundingClientRect();
      const name = document.querySelector('.tb-live-stage .tb-live-name').getBoundingClientRect();
      const moves = [...document.querySelectorAll('.tb-live-stage .tb-move')].map((m) => m.getBoundingClientRect());
      const share = document.querySelector('.tb-hero-foot .tb-share')?.getBoundingClientRect();
      const play = document.querySelector('.tb-hero-foot .tb-play')?.getBoundingClientRect();
      return {
        nameIn: name.left > st.left && name.bottom < st.bottom && name.left - st.left < st.width / 3,
        namePad: [Math.round(name.left - st.left), Math.round(st.bottom - name.bottom)],
        column: moves.every((m) => Math.abs(m.left - moves[0].left) < 1 && Math.abs(m.width - moves[0].width) < 1 && m.right < st.right && m.bottom < st.bottom && m.left > st.left + st.width / 2),
        // Share then Play, one row, one width, Share first; adjacent to the
        // card: below it (taller than wide) or in the rail beside it (wider).
        foot: !!share && !!play && Math.abs(share.width - play.width) < 1 && Math.abs(share.top - play.top) < 1 && share.left < play.left && (share.top >= st.bottom - 1 || share.left >= st.right - 1),
      };
    });
    if (!shape.nameIn || Math.abs(shape.namePad[0] - shape.namePad[1]) > 2) throw new Error(`the name card is not at the card's bottom start: ${JSON.stringify(shape)}`);
    if (!shape.column) throw new Error(`the moves are not one column at the card's bottom end: ${JSON.stringify(shape)}`);
    if (!shape.foot) throw new Error(`Share and Play are not side by side, one width, below or beside the card: ${JSON.stringify(shape)}`);
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
    // Four moves, no more (Raz: only Dance, Wave, Flip and Punch), and a tap
    // on one plays it at once, on the hero's own slide.
    const moves = await page.locator('.tb-move').evaluateAll((els) => els.map((e) => e.getAttribute('data-move')).join(','));
    if (moves !== 'dance,bodyroll,backflip,punch') throw new Error(`the moves are ${moves}`);
    await page.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-shown') === 'hero', null, { timeout: 90000 });
    const punchMs = await tapToMove('punch');
    if (punchMs > 800) throw new Error(`punch started ${punchMs} ms after the tap, not at once`);
    if ((await slideNow()) !== 'hero') throw new Error(`a move left the hero's slide for "${await slideNow()}"`);
    await page.waitForTimeout(DEMO ? 300 : 500);
    const flipMs = await tapToMove('backflip');
    await page.waitForTimeout(700);
    await snap(page, 'hero-moving');
    // When a move ends the hero goes back to its idle dance by itself.
    await page.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-playing') === '', null, { timeout: 30000 });
    if (DEMO) {
      await tapToMove('dance');
      await page.waitForFunction(() => document.querySelector('.tb-live-stage')?.getAttribute('data-playing') === '', null, { timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    // Nothing overlaps on any slide, the picture is centred in the card, the
    // name card and the moves sit in its corners, the chapters and Share and
    // Play beside or under it (hero-layout.mjs; Raz: "elements override each
    // other its awful"). At the robot's own size, a big desktop, a phone and
    // a phone on its side, then back.
    let layoutSizes = '';
    if (!DEMO) {
      // 360: the narrowest common Android phone (a label cut there once: "Make the action figu").
      const sizes = [VIEW, { width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 360, height: 780 }, { width: 844, height: 390 }];
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.waitForTimeout(800);
        const bad = (await checkHeroLayout(page)).filter((s) => s.problems.length);
        if (bad.length) throw new Error(`at ${size.width}x${size.height}: ${bad.map((s) => `${s.slide}: ${s.problems.join('; ')}`).join(' | ')}`);
      }
      await page.setViewportSize(VIEW);
      await page.waitForTimeout(800);
      layoutSizes = sizes.map((v) => `${v.width}x${v.height}`).join(', ');
    }

    // The toy slide, together and taken apart, on a hero that has a toy: the
    // same rules, its two buttons one size, its arrows drawn (the approved
    // "Hero · toy" boards), on a phone and a laptop.
    let toyLayout = '';
    if (!DEMO && TOY_HERO && TOY_HERO !== 'none') {
      const toy = await context.newPage();
      try {
        for (const size of [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
          await toy.setViewportSize(size);
          await toy.goto(`${BASE_URL}/hero/${TOY_HERO}`, { waitUntil: 'load' });
          await toy.waitForFunction(() => {
            const m = document.querySelector('.tb-dock-layer--moves');
            return m && getComputedStyle(m).opacity === '1';
          }, null, { timeout: 120000 });
          if (!/(^|,)figure(,|$)/.test(await toy.locator('.tb-live-stage').getAttribute('data-slides'))) {
            throw new Error(`the toy hero ${TOY_HERO} has no toy slide (set TOY_HERO to a staging hero with a made toy)`);
          }
          const got = await checkHeroLayout(toy, { settle: 1500 });
          if (!got.some((s) => s.slide === 'figure taken apart')) throw new Error(`at ${size.width}x${size.height}: the toy has no Take apart button`);
          const bad = got.filter((s) => s.problems.length);
          if (bad.length) throw new Error(`the toy hero at ${size.width}x${size.height}: ${bad.map((s) => `${s.slide}: ${s.problems.join('; ')}`).join(' | ')}`);
        }
      } finally {
        await toy.close();
      }
      toyLayout = '; the toy slide, together and taken apart, at 390x844 and 1280x900: nothing overlaps or touches an edge, its two buttons one size, its arrows drawn';
    }

    // Play is the bottom-most button on the page. It opens the game chooser:
    // two games, each opened with the same hero parameters. Only buttons a
    // person can see count: off-screen slides (their full-screen openers sit
    // a stage away) and faded-out dock layers are not on the page for them.
    const lowest = await page.evaluate(() => {
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) return false;
        let o = 1;
        for (let e = el; e && e !== document.body; e = e.parentElement) {
          const c = getComputedStyle(e);
          if (c.visibility === 'hidden' || c.display === 'none') return false;
          o *= +c.opacity;
        }
        return o > 0;
      };
      const play = document.querySelector('.tb-hero-screen .tb-play');
      const playBottom = play.getBoundingClientRect().bottom;
      // (A picture's full-screen opener is the picture itself, not a button.)
      const below = [...document.querySelectorAll('.tb-hero-screen button, .tb-hero-screen a')]
        .filter((el) => el !== play && !el.matches('.tb-slide-open') && shown(el) && el.getBoundingClientRect().bottom > playBottom + 1);
      return below.length ? below[0].className : 'tb-play';
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

    // "Back to your hero" lands on the hero's own page, not the gallery.
    const heroAt = games.arena.match(/[?&]back=([^&]+)/);
    await page.locator('.rr-back-slot .tb-nav, .rr-back-slot button').first().click();
    await page.waitForURL((u) => u.pathname.startsWith('/hero/'), { timeout: 30000 });
    await page.locator('.tb-hero-screen').waitFor({ timeout: 30000 });
    if (heroAt && new URL(page.url()).pathname !== decodeURIComponent(heroAt[1])) throw new Error(`Back from Robot Rumble landed on ${page.url()}`);

    // Dance party's page loads from its card's link.
    await page.goto(`${BASE_URL}${games.dance}`);
    await page.waitForFunction(() => window.__ready !== undefined, null, { timeout: 90000 });
    const ready = await page.evaluate(() => window.__ready);
    if (ready !== true) throw new Error(`Dance party did not start: ${ready}`);
    await page.waitForTimeout(DEMO ? 3000 : 1500);
    await snap(page, 'dance-party');
    mark('end');
    return `"${title}" opened drawing > painting > hero, the drawing on its small card; swiping went drawing > painting > hero; the drawing opened full screen and Back returned to it; no moves on the drawing or the painting, all 4 inside the hero's stage; punch ${punchMs} ms and backflip ${flipMs} ms after the tap; no scroll; nothing overlaps on any slide${layoutSizes ? ` at ${layoutSizes}` : ''}${toyLayout}; Play is the bottom-most button, its chooser opens both games with the same hero, a Robot Rumble round began (no hero hittable${audit ? `, ${audit.crowd} cheering` : ''}), its Back returned to the hero's page, and Dance party started`;
  });

  await step(page, 'class', async () => {
    // A teacher short of credits pays money for exactly the seats a class
    // needs. The seats arrive on the class by the signed webhook, and never
    // touch the teacher's own balance.
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
    await page.locator('.header-auth-credits').waitFor({ timeout: 30000 });
    const me = await robotApi('/api/v1/me');
    const balance = me.credits;

    // A group leader's home has two places, on a switch under the header:
    // Gallery and My classes. The first time, "I run classes" on the account
    // sheet turns group mode on and lands on My classes; after that it is
    // one tap. My classes is never a chip.
    const switchBar = page.locator('.tb-switchbar');
    const classesTab = switchBar.getByRole('tab', { name: 'My classes' });
    const galleryTab = switchBar.getByRole('tab', { name: 'Gallery' });
    if (await page.locator('.tb-gallery-chips').getByRole('tab', { name: 'My classes' }).count()) throw new Error('My classes is a chip again: it belongs on the switch');
    if (!me.is_teacher) {
      if (await switchBar.count()) throw new Error('a non-teacher is shown the Gallery / My classes switch');
      await page.getByRole('button', { name: 'Account' }).click();
      const toggle = page.getByRole('switch', { name: 'I run classes' });
      if ((await toggle.getAttribute('aria-checked')) !== 'false') throw new Error('"I run classes" is not off for a creator');
      await snap(page, 'class-account-off');
      await toggle.click();
    } else {
      await classesTab.click();
    }
    const newClass = page.locator('.cls-new-class');
    await newClass.waitFor({ timeout: 30000 });
    if ((await classesTab.getAttribute('aria-selected')) !== 'true') throw new Error('New class shows, but My classes is not the one selected on the switch');
    if (await page.locator('.tb-gallery-chips').count()) throw new Error('My classes shows the gallery chips');
    const segH = (await classesTab.boundingBox())?.height ?? 0;
    if (segH < 44) throw new Error(`the My classes segment is ${segH}px tall, under the 44px tap target`);
    await linger(page, 1500);

    // The price the app quotes must be the one packs.py sets.
    const listed = await robotApi('/api/v1/classes');
    const price = listed.seat_price;
    if (!price) throw new Error('GET /api/v1/classes offers no seat_price: the class-seats variant is not configured');
    // grow_sandbox sells seats in shekels (10 ILS a seat, 10 seats at least);
    // Lemon Squeezy in dollars ($0.50 + $1.25 a seat).
    const sandbox = price.currency === 'ILS';
    if (sandbox) {
      if (price.order_cents !== 0 || price.seat_cents !== 1000 || price.min_seats !== 10) {
        throw new Error(`seat_price is ${JSON.stringify(price)}, want order_cents 0, seat_cents 1000 and min_seats 10 (₪10 a seat, 10 at least)`);
      }
    } else if (price.order_cents !== 50 || price.seat_cents !== 125) {
      throw new Error(`seat_price is ${JSON.stringify(price)}, want order_cents 50 and seat_cents 125 ($0.50 + $1.25 a seat)`);
    }
    // More seats than the robot's credits cover, so money is the way to pay.
    const heroCost = listed.hero_cost;
    const seats = Math.min(price.max_seats, Math.max(5, price.min_seats || 0, Math.floor(balance / heroCost) + 1));
    const totalCents = price.order_cents + price.seat_cents * seats;
    const want = sandbox ? ilsDisplay(totalCents) : `$${(totalCents / 100).toFixed(2)}`;
    // What the class screen offers, sign and all: "₪100" on grow_sandbox,
    // "$6.75" on Lemon Squeezy.
    const offersRight = (text, prefix, suffix) => text === `${prefix}${want}${suffix}`;
    const receiptsBefore = sandbox ? await receipts() : null;

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
    if (!offersRight(offer, 'Pay ', ` for ${seats} seats`)) throw new Error(`the bar offers "${offer}", want "Pay ${want} for ${seats} seats"`);
    await paySeats.click();
    const payMoney = page.locator('.cls-pay-money');
    await payMoney.waitFor();
    const confirm = (await payMoney.innerText()).trim();
    if (!offersRight(confirm, 'Pay ', '')) throw new Error(`the dialog's button reads "${confirm}", want "Pay ${want}"`);
    await snap(page, 'class-pay');
    await linger(page, 1500);
    // The checkout the app opens, read as it passes: the page leaves for the
    // checkout at once, and a response body is gone with the page.
    let buy = null;
    await page.route('**/api/v1/classes/buy', async (route) => {
      const res = await route.fetch();
      buy = { status: res.status(), text: await res.text() };
      await route.fulfill({ response: res, body: buy.text });
    });
    await payMoney.click();
    await page.waitForURL(CHECKOUT_URL, { timeout: 60000 }).catch(() => {});
    await page.unroute('**/api/v1/classes/buy');
    if (!buy) throw new Error('tapping Pay never asked for a checkout');
    if (buy.status !== 201) throw new Error(`POST /api/v1/classes/buy answered ${buy.status}: ${buy.text}`);
    const checkout = JSON.parse(buy.text);
    if (checkout.seats !== seats || checkout.price_display !== want) {
      throw new Error(`the checkout is for ${checkout.seats} seats at ${checkout.price_display}, want ${seats} at ${want}`);
    }

    const onSandbox = new URL(checkout.checkout_url).pathname.startsWith(SANDBOX_PATH);
    if (onSandbox !== sandbox) throw new Error(`seat_price is in ${price.currency || 'USD'} but the checkout opened at ${checkout.checkout_url}`);
    if (sandbox) await payOnSandbox(page, { amount: want, marks: false });
    else await payOnLemonSqueezy(page, user.email, { marks: false });
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
    const cls = await robotApi(`/api/v1/classes/${checkout.class_id}`);
    if (cls.seats !== seats || cls.title !== className) throw new Error(`the API has "${cls.title}" with ${cls.seats} seats, want "${className}" with ${seats}`);
    const after = (await robotApi('/api/v1/me')).credits;
    if (after !== balance) throw new Error(`the teacher's balance moved ${balance} -> ${after}: class seats must never land on it`);
    if (sandbox) {
      // One receipt, for this class's seats, at the shekel price.
      const list = await receipts();
      const mine = list.filter((r) => r.class_id === checkout.class_id);
      if (list.length !== receiptsBefore.length + 1 || mine.length !== 1) throw new Error(`paying for the seats left ${list.length - receiptsBefore.length} new receipts (${mine.length} for the class), want 1`);
      if (mine[0].seats !== seats || mine[0].paid_display !== want) throw new Error(`the seats' receipt reads ${JSON.stringify(mine[0])}, want ${seats} seats at ${want}`);
    }

    // Start the class: the code to copy off the board, and the QR to scan.
    await start.click();
    await page.locator('.cls-start-confirm').click();
    const pinBox = page.locator('.cls-join-card .cls-pin');
    await pinBox.waitFor({ timeout: 15000 });
    const pin = (await pinBox.locator('.cls-pin-box').allInnerTexts()).join('');
    if (!/^\d{6}$/.test(pin)) throw new Error(`the class code reads "${pin}", want 6 digits`);
    const qr = page.locator('.cls-join-card svg.cls-qr');
    if (!(await qr.isVisible())) throw new Error('no QR code on the live class');
    const live = await robotApi(`/api/v1/classes/${checkout.class_id}`);
    if (live.live?.pin !== pin) throw new Error(`the screen shows code ${pin}, the API ${live.live?.pin}`);
    await linger(page, 3000);
    await snap(page, 'class-live');

    // The dual person mid-lesson: back to My classes (the live class pinned
    // first), over to their own Gallery, and one tap on the live strip
    // brings the class back.
    await page.getByRole('button', { name: 'Back to classes' }).click();
    await page.locator(`.cls-card--live[data-class="${className}"]`).waitFor({ timeout: 15000 });
    await galleryTab.click();
    const strip = page.locator('.cls-strip');
    await strip.waitFor({ timeout: 15000 });
    if (!(await strip.innerText()).includes(className)) throw new Error(`the live strip reads "${await strip.innerText()}", want the class "${className}"`);
    await snap(page, 'class-live-strip');
    await linger(page, 1500);
    await strip.click();
    await pinBox.waitFor({ timeout: 15000 });
    if ((await pinBox.locator('.cls-pin-box').allInnerTexts()).join('') !== pin) throw new Error('the live strip opened a class with another code');

    // A student joins on a phone of their own (no account) and makes a hero;
    // the teacher opens it from the class: the gallery's hero page, its steps
    // while it is made, then live, read-only. The robot's drawing in its
    // default style is in the staging result cache, as in 'create', so this
    // hero calls no provider; the class's seats pay for it.
    const kidName = 'Robo';
    const kidCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' });
    let kidReady = '';
    let kidAsked = '';
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
      // The student's browser is asked too while the hero is made, but only
      // "Who drew it?": it is a class. With the staging cache the hero can be
      // ready before the question would show; then there is nothing to ask.
      const kidAsk = kid.getByRole('dialog', { name: 'Two quick questions' });
      kidAsked = 'the hero was ready before the question showed';
      if (await kidAsk.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
        const titles = await kidAsk.locator('.tb-ask-title').allInnerTexts();
        if (titles.join(' | ') !== 'Who drew it?') throw new Error(`a student was asked [${titles.join(' | ')}]; a class is not asked what it is for`);
        await kidAsk.getByRole('button', { name: 'A kid' }).click();
        await snap(kid, 'class-student-who-drew');
        await kidAsk.getByRole('button', { name: 'Done' }).click();
        await kidAsk.waitFor({ state: 'detached', timeout: 5000 });
        kidAsked = 'asked only "Who drew it?"';
      }

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
      await backFromHero(page);
      await pinBox.waitFor({ timeout: 15000 });
    } finally {
      await kidCtx.close();
    }

    // The same name from a second phone: the same child twice, or a second
    // Robo? It waits for the teacher, as "Robo 2", and the teacher can take
    // any card off the board (⋯ beside it, Remove). Makes no hero.
    const twinCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' });
    try {
      const twin = await twinCtx.newPage();
      await twin.goto(`${BASE_URL}/join/${pin}`, { waitUntil: 'domcontentloaded' });
      await twin.locator('.cls-name-input').fill(kidName);
      await twin.locator('.cls-go').click();
      await twin.getByText('Almost!').waitFor({ timeout: 30000 });
      const twinMore = page.getByRole('button', { name: `More for ${kidName} 2` });
      await twinMore.waitFor({ timeout: 30000 });
      const twinCard = page.locator('.cls-tile-wrap', { has: twinMore });
      if ((await twinCard.getAttribute('data-state')) !== 'waiting') throw new Error(`a second "${kidName}" from another phone is "${await twinCard.getAttribute('data-state')}" on the board, want waiting for the teacher`);
      await snap(page, 'class-same-name');
      await twinMore.click();
      await page.getByRole('button', { name: 'Remove from class' }).click();
      await page.locator('.cls-remove-confirm').click();
      await twinMore.waitFor({ state: 'detached', timeout: 15000 });
      const joinedNow = await page.locator('.cls-stat', { hasText: 'joined' }).innerText();
      if (!/^\s*1 joined/.test(joinedNow)) throw new Error(`after removing the duplicate the board says "${joinedNow}", want 1 joined`);
    } finally {
      await twinCtx.close();
    }

    await page.locator('.cls-end').click();
    await page.locator('.cls-end-confirm').click();
    await start.waitFor({ timeout: 15000 });

    // Back from the class lands on My classes, the class among its cards.
    await page.getByRole('button', { name: 'Back to classes' }).click();
    await newClass.waitFor({ timeout: 15000 });
    if ((await classesTab.getAttribute('aria-selected')) !== 'true') throw new Error('Back from the class did not land on My classes');
    await page.locator(`.cls-card[data-class="${className}"]`).waitFor({ timeout: 15000 });
    await snap(page, 'class-tab');

    // Gallery and back: the chips and Make a hero under Gallery, New class under My classes.
    await galleryTab.click();
    await page.locator('.tb-new-hero').waitFor({ timeout: 15000 });
    if (!(await page.locator('.tb-gallery-chips').count())) throw new Error('Gallery on the switch shows no chips');
    await classesTab.click();
    await newClass.waitFor({ timeout: 15000 });

    // Leave group mode as it was found: the same switch on the account sheet.
    // The switch under the header goes; the classes are kept.
    if (!me.is_teacher) {
      await page.getByRole('button', { name: 'Account' }).click();
      const toggle = page.getByRole('switch', { name: 'I run classes' });
      if ((await toggle.getAttribute('aria-checked')) !== 'true') throw new Error('"I run classes" is not on for a group leader');
      await snap(page, 'class-account-on');
      await toggle.click();
      await switchBar.waitFor({ state: 'detached', timeout: 15000 });
      await page.locator('.tb-new-hero').waitFor({ timeout: 15000 });
    }
    return `school: ${school}; "${className}", ${seats} seats at ${want} (teacher price, from GET /api/v1/classes); paid on ${sandbox ? 'the grow_sandbox TEST checkout (one receipt)' : 'Lemon Squeezy'}, seats in ${landed}s after returning; API seats=${cls.seats}, balance unchanged at ${after}; started: code ${pin} and a QR; student "${kidName}" joined and made a hero (${kidAsked}), ready in ${kidReady}, opened from the class live in 3D; a second "${kidName}" from another phone waited as "${kidName} 2" and was removed from the board; the live strip on Gallery led back to it; ended; group mode off again`;
  });

  // Analytics (docs/analytics/REQUIREMENTS.md): the run above must have left
  // its trail in our own events table, marked as a robot's (so it is in no
  // graph), and must never have loaded PostHog. The robot reads back only its
  // own browser's events, through the same public address as everything else.
  await step(page, 'analytics', async () => {
    const passed = (name) => results.some((r) => r.name === name && r.status === 'passed');
    const mine = async (p) => {
      const visitor = await p.evaluate(() => localStorage.getItem('hm_visitor'));
      if (!visitor) throw new Error('this browser has no analytics id (hm_visitor): the client never ran');
      const r = await p.request.get(`${BASE_URL}/api/v1/events/mine?visitor=${encodeURIComponent(visitor)}`);
      if (!r.ok()) throw new Error(`GET /api/v1/events/mine answered ${r.status()}`);
      return (await r.json()).events;
    };
    // The client sends about two seconds after the last event.
    await page.waitForTimeout(3500);
    const events = await mine(page);
    const names = new Set(events.map((e) => e.name));
    if (events.length === 0) throw new Error('no analytics events were recorded for this run (is ANALYTICS_ENABLED set on this environment?)');
    const notRobot = events.filter((e) => !e.robot).map((e) => e.name);
    if (notRobot.length) throw new Error(`the robot's events are not marked as a robot's, so they would be in the graphs: ${[...new Set(notRobot)].join(', ')}`);
    // What each step that passed must have left behind. The backend's own
    // events (a purchase, a finished hero) are there too: they join the
    // visitor the account was seen on.
    const expected = {
      landing: ['visit'],
      signup: ['adult_confirmed', 'signin_shown', 'signin_done'],
      buy: ['credits_shown', 'checkout_started', 'purchase_done'],
      create: ['make_started', 'photo_chosen', 'make_choice', 'survey_answered', 'hero_ready'],
      profile: ['hero_opened', 'hero_slide_viewed'],
      game: ['game_started'],
    };
    const missing = Object.entries(expected)
      .filter(([name]) => passed(name))
      .flatMap(([name, wanted]) => wanted.filter((w) => !names.has(w)).map((w) => `${w} (${name})`));
    if (missing.length) throw new Error(`events missing from the run: ${missing.join(', ')}; recorded: ${[...names].join(', ')}`);
    if (posthogRequests.length) throw new Error(`the robot loaded PostHog: ${posthogRequests.slice(0, 3).join(', ')}`);

    // A door: a fresh browser arriving through ?via=test-fair is recorded
    // with that door (and as a robot, so "test-fair" is in no graph either).
    const doorCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
    let door;
    try {
      const visitor = await doorCtx.newPage();
      await visitor.goto(`${BASE_URL}/?via=test-fair`, { waitUntil: 'domcontentloaded' });
      await visitor.getByRole('button', { name: 'HeroMaker home' }).waitFor();
      await visitor.waitForTimeout(3500);
      const seen = await mine(visitor);
      door = seen.find((e) => e.name === 'visit');
      if (!door) throw new Error(`a visit through ?via=test-fair recorded no visit: ${JSON.stringify(seen)}`);
      if (door.door !== 'test-fair' || !door.robot) throw new Error(`a visit through ?via=test-fair was recorded as ${JSON.stringify(door)}`);
    } finally {
      await doorCtx.close();
    }
    return `${events.length} events of this run recorded, all marked robot (in no graph): ${[...names].join(', ')}; PostHog never loaded; a visit through ?via=test-fair recorded with door "${door.door}" on ${door.device}`;
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
