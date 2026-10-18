/**
 * Shared harness for the class stage tools (classshot, record-class).
 *
 * The page reads every hero through the app's own origin (/api/files/...),
 * which the dev server does not have. So the browser's /api requests are
 * answered here, either from a local copy of the files (CLASS_FILES=<dir>,
 * laid out <user>/<creation>/<file>, fast and repeatable for rendering) or
 * fetched live from staging (CLASS_API=https://..., for an honest load time).
 *
 *   CHROMIUM_PROXY=http://host:port   proxy for the browser's outside requests, if it needs one
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pwPath = process.env.PLAYWRIGHT ?? '/opt/node22/lib/node_modules/playwright'
export const { chromium } = require(pwPath)

const TYPES = { '.vrm': 'model/gltf-binary', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }

export async function launch() {
  // A proxy, if one is set, only for the outside world: Playwright otherwise
  // sends loopback through it too, and the dev server is on loopback.
  const proxy = process.env.CHROMIUM_PROXY
  return chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    ...(proxy ? { proxy: { server: proxy, bypass: '<loopback>,127.0.0.1,localhost' } } : {}),
  })
}

/** A page; HTTPS errors ignored because a sandbox may re-sign TLS (Google Fonts). */
export const newPage = (browser, viewport) =>
  browser.newPage({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true })

export async function routeApi(page, { files = process.env.CLASS_FILES, api = process.env.CLASS_API } = {}) {
  const log = []
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const t0 = Date.now()
    if (files) {
      const rel = url.pathname.replace(/^\/api\/files\//, '')
      const p = path.join(files, rel)
      if (url.pathname.startsWith('/api/files/') && !rel.includes('..') && fs.existsSync(p)) {
        const body = fs.readFileSync(p)
        log.push({ path: url.pathname, bytes: body.length, ms: Date.now() - t0 })
        return route.fulfill({ status: 200, body, headers: { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream', 'content-length': String(body.length) } })
      }
      return route.fulfill({ status: 404, body: 'not cached' })
    }
    if (api) {
      const resp = await route.fetch({ url: api + url.pathname + url.search, maxRedirects: 5 })
      const body = await resp.body()
      log.push({ path: url.pathname, bytes: body.length, ms: Date.now() - t0 })
      return route.fulfill({ status: resp.status(), body, headers: { 'content-type': resp.headers()['content-type'] ?? 'application/octet-stream', 'content-length': String(body.length) } })
    }
    return route.continue()
  })
  return log
}

export async function openStage(browser, { url, width, height, files, api }) {
  const page = await newPage(browser, { width, height })
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text()) })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  const log = await routeApi(page, { files, api })
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 })
  const wall = Date.now() - t0
  await waitForFonts(page)
  return { page, log, wall }
}

/**
 * The pages load Google Fonts without blocking render, so a recorder has to
 * wait for the stylesheet and then ask for the faces it is about to paint.
 */
export async function waitForFonts(page) {
  await page.waitForFunction(() => [...document.styleSheets].some((s) => s.href?.includes('fonts.googleapis') && s.media.mediaText !== 'print'), null, { timeout: 60000 })
    .catch(() => console.log('fonts stylesheet never arrived'))
  await page.evaluate(() => Promise.all([
    document.fonts.load('600 40px Fredoka', 'אבג abc'), document.fonts.load('700 20px Rubik', 'אבג'),
    document.fonts.load('800 20px Rubik', 'אבג'), document.fonts.load('400 30px Barriecito', 'HeroMaker'),
  ]).then(() => document.fonts.ready))
}
