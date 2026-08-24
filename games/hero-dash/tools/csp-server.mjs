import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Serves the packed artifact behind a CSP close to the published sandbox's,
 * wrapped in a host document the same way claude.ai wraps it.
 *
 * The published page fails in ways a plain static server never reproduces —
 * most importantly `connect-src` refusing fetch() to `data:` URIs — so this is
 * the only local check that actually means anything for an artifact.
 */
const file = process.argv[2] ?? 'dist/hero-dash.artifact.html'
const port = Number(process.argv[3] ?? 5197)

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data:",
  "media-src data: blob:",   // getUserMedia streams are blob-backed
  "connect-src 'self'",          // note: no data: — this is the trap
  "frame-ancestors *",
].join('; ')

const frag = fs.readFileSync(path.resolve(file), 'utf8')
const split = frag.indexOf('<div id="app">')
const page =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>*{margin:0;padding:0}</style>' +
  frag.slice(0, split) +
  '</head><body>' + frag.slice(split) + '</body></html>'

http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': CSP,
  })
  res.end(page)
}).listen(port, '127.0.0.1', () => {
  console.log(`artifact-like server on http://127.0.0.1:${port}/`)
  console.log(`CSP: ${CSP}`)
})
