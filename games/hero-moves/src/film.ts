/**
 * Hero Story Film and Hero Greeting — a kid's hero starring in a short film
 * rendered by our own engine, in the browser, for nothing.
 *
 *   film.html?vrm=/api/files/<u>/<c>/opt_avatar.vrm&name=Blue%20Bolt&artist=Maya&age=6&story=birthday
 *   greeting.html?vrm=...&name=...&artist=Itai&occasion=birthday&to=Savta
 *
 * Same `?vrm=` and `?name=` as the Dance party page (src/ownhero.ts), plus who
 * drew it. With no `?vrm=` a sample hero plays. `?render=1` strips the page to
 * the bare film and exposes `window.__film` for tools/render-film.mjs, which
 * steps it frame by frame into an MP4.
 *
 * Fake door: the film freezes at the story's `paywallAt` (about 15 s) on
 * "Unlock {hero}'s full movie — $9". The button records the click and says
 * thank you; there is no checkout. `?paywall=0` plays straight through.
 */
import './ui/toybox.css'
import './ui/film.css'
import { el } from './ui/dom'
import { icon, tbButton, tbChips, tbNav } from './ui/tb'
import { OWN_HERO, goBack } from './ownhero'
import { Film } from './film/director'
import { OCCASIONS, STORIES, fill, type Names, type Script } from './film/script'
import { renderWav, scheduleScore } from './film/music'
import { deliver, recorderType, startRecording, type Recording } from './film/recorder'
import { canExport, exportFilm } from './film/exporter'

const params = new URLSearchParams(location.search)
const MODE: 'film' | 'greeting' = document.body.dataset.mode === 'greeting' ? 'greeting' : 'film'
const RENDER = params.get('render') === '1'
const W = Number(params.get('w') ?? 720), H = Number(params.get('h') ?? 1280)

// ---------------------------------------------------------------- who
const sampleFiles = import.meta.glob('../assets/avatars/Crayon_Kid.*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const sample = (ext: string) => Object.entries(sampleFiles).find(([k]) => k.endsWith(ext))?.[1] ?? ''

const heroUrl = OWN_HERO ?? sample('.opt.vrm')
const names: Names = {
  hero: params.get('name') || (OWN_HERO ? 'Your hero' : 'Crayon Kid'),
  artist: params.get('artist') || (OWN_HERO ? 'you' : 'Sam'),
  age: params.get('age') || undefined,
  to: params.get('to') || undefined,
  from: params.get('from') || undefined,
}
/** The drawing sits next to the hero's VRM on the backend; same-origin only, like the VRM. */
function drawingUrl(): string | null {
  const raw = params.get('drawing')
  if (raw) {
    try { const u = new URL(raw, location.href); if (u.origin === location.origin) return u.href } catch { /* ignore */ }
  }
  if (OWN_HERO) return OWN_HERO.replace(/[^/]+$/, 'original.jpg')
  return sample('.thumb.webp')
}
const LINK = params.get('link') || 'https://heromaker.up.railway.app'

function scriptFor(id: string): Script {
  if (MODE === 'greeting') {
    const o = OCCASIONS.find((x) => x.id === id) ?? OCCASIONS[0]
    if (!params.get('to')) names.to = o.to
    return o.script
  }
  return STORIES.find((s) => s.id === id) ?? STORIES[0]
}
let choice = params.get(MODE === 'greeting' ? 'occasion' : 'story') ?? (MODE === 'greeting' ? OCCASIONS[0].id : STORIES[0].id)

async function fonts() {
  try {
    await Promise.all([
      document.fonts.load('64px Barriecito'), document.fonts.load('800 26px Nunito'), document.fonts.load('600 20px Fredoka'),
    ])
  } catch { /* the canvas falls back to Fredoka/Nunito/system */ }
}

const make = (script: Script, progress?: (f: number, what: string) => void) => Film.create({
  script, names, heroUrl, drawingUrl: drawingUrl(), width: W, height: H, link: LINK,
  watermark: MODE === 'greeting',
}, progress)

// ---------------------------------------------------------------- offline render
if (RENDER) {
  document.body.classList.add('film-render')
  ;(async () => {
    await fonts()
    const film = await make(scriptFor(choice))
    document.getElementById('app')!.append(film.canvas)
    ;(window as any).__film = {
      duration: film.duration,
      title: film.title,
      frame: (t: number) => film.render(t),
      jpeg: (q = 0.93) => film.canvas.toDataURL('image/jpeg', q),
      png: () => film.canvas.toDataURL('image/png'),
      wav: async () => {
        const blob = await renderWav(film.plan)
        const buf = new Uint8Array(await blob.arrayBuffer())
        let s = ''
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        return btoa(s)
      },
    }
    ;(window as any).__ready = true
  })().catch((e) => { console.error(e); (window as any).__error = String(e) })
} else {
  boot()
}

// ---------------------------------------------------------------- player
function boot() {
  const app = document.getElementById('app')!
  const title = el('div', { class: 'tb-header-title' }, names.hero)
  const header = el('header', { class: 'tb-header' },
    el('div', { class: 'tb-header-side' }, tbNav('back', 'Back', goBack)),
    title,
    el('div', { class: 'tb-header-side tb-header-side--end' }))

  const frame = el('div', { class: 'film-frame' })
  const loading = el('div', { class: 'film-loading' })
  const ringPct = el('b', {}, '0%')
  const ringWhat = el('span', {}, 'Finding your hero')
  loading.append(el('div', { class: 'film-ring' }, ringPct), ringWhat)
  const bigPlay = el('button', { class: 'film-bigplay', type: 'button' })
  bigPlay.setAttribute('aria-label', 'Play')
  bigPlay.innerHTML = icon('play', 40)
  bigPlay.hidden = true
  frame.append(loading, bigPlay)
  const body = el('main', { class: 'tb-screen-body film-body' }, frame)

  const options = MODE === 'greeting'
    ? OCCASIONS.map((o) => ({ value: o.id, label: o.label }))
    : STORIES.map((s) => ({ value: s.id, label: s.label }))
  let chips = tbChips(options, choice, pick)
  const chipRow = el('div', { class: 'film-chips' }, chips)
  const save = tbButton(MODE === 'greeting' ? 'Save video' : 'Save teaser', { kind: 'secondary', onClick: () => void record() })
  const play = tbButton('Play', { kind: 'primary', icon: 'play', onClick: () => toggle() })
  const note = el('div', { class: 'tb-bar-note' })
  note.hidden = true
  const bar = el('footer', { class: 'tb-bar' }, chipRow, note, el('div', { class: 'tb-bar-row' }, save, play))
  app.append(el('div', { class: 'tb-screen tb-screen--fit film-screen' }, header, body, bar))

  let film: Film | null = null
  let script = scriptFor(choice)
  let audio: AudioContext | null = null
  let started = 0
  let from = 0
  let at = 0
  let playing = false
  let unlocked = params.get('paywall') === '0' || MODE === 'greeting'
  let recording: Recording | null = null
  let exporting = false
  let stopAt = Infinity

  const setPlayLabel = (label: string, ic: 'play' | 'pause' | 'redo') => {
    play.innerHTML = `${icon(ic)}<span>${label}</span>`
  }

  const now = () => (playing && audio ? from + (audio.currentTime - started) : at)
  /** The frame shown while nothing plays: the title card, or the greeting mid-dance. */
  const poster = () => Math.min((film?.duration ?? 1) - 0.1, MODE === 'greeting' ? 2.2 : 1.9)

  async function load() {
    playing = false
    loading.hidden = false
    bigPlay.hidden = true
    film?.canvas.remove()
    film?.dispose()
    film = null
    await fonts()
    film = await make(script, (f, what) => { ringPct.textContent = `${Math.round(f * 100)}%`; ringWhat.textContent = what; loading.style.setProperty('--p', String(f)) })
    title.textContent = MODE === 'greeting' ? fill(script.title, names) : film.title
    document.title = title.textContent
    frame.prepend(film.canvas)
    at = poster()
    film.render(at)
    at = 0
    loading.hidden = true
    bigPlay.hidden = false
    setPlayLabel('Play', 'play')
    if (params.get('autoplay') === '1') toggle()
  }

  function startAudio(t: number, tap?: MediaStreamAudioDestinationNode) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctor || !film) return null
    const ctx: AudioContext = new Ctor()
    const out = ctx.createGain()
    out.connect(ctx.destination)
    if (tap) out.connect(tap)
    scheduleScore(ctx, out, film.plan, t, ctx.currentTime + 0.08)
    started = ctx.currentTime + 0.08
    return ctx
  }

  function toggle() {
    if (!film) return
    if (playing) return pause()
    if (at >= film.duration - 0.05) at = 0
    begin(at)
  }

  function begin(t: number, tap?: MediaStreamAudioDestinationNode, ctx?: AudioContext) {
    if (!film) return
    from = t
    audio = ctx ?? startAudio(t, tap)
    if (!audio) { started = performance.now() / 1000 }
    playing = true
    bigPlay.hidden = true
    setPlayLabel('Pause', 'pause')
    requestAnimationFrame(tick)
  }

  function pause() {
    at = now()
    playing = false
    void audio?.close()
    audio = null
    bigPlay.hidden = false
    setPlayLabel('Play', 'play')
  }

  function tick() {
    if (!playing || !film) return
    let t = audio ? now() : from + (performance.now() / 1000 - started)
    const gate = unlocked ? Infinity : (script.paywallAt ?? Infinity)
    if (t >= Math.min(gate, stopAt)) {
      t = Math.min(gate, stopAt)
      film.render(t)
      at = t
      playing = false
      void audio?.close()
      audio = null
      if (recording) return void finishRecording()
      setPlayLabel('Play', 'play')
      return paywall()
    }
    if (t >= film.duration) {
      film.render(film.duration)
      at = film.duration
      playing = false
      void audio?.close()
      audio = null
      if (recording) return void finishRecording()
      setPlayLabel('Watch again', 'redo')
      return
    }
    film.render(t)
    if (!audio) at = t
    requestAnimationFrame(tick)
  }

  async function pick(id: string) {
    if (recording) return
    choice = id
    script = scriptFor(id)
    chips.replaceWith(chips = tbChips(options, choice, pick))
    await load()
  }

  // ------------------------------------------------------------ save video
  async function record() {
    if (!film || recording || exporting) return
    if (playing) pause()
    if (canExport()) {
      // Frame-stepped into the browser's encoders: smooth on any device.
      exporting = true
      save.disabled = true
      play.disabled = true
      const end = unlocked ? film.duration : (script.paywallAt ?? film.duration)
      try {
        const out = await exportFilm(film, { end, onProgress: (f) => { note.hidden = false; note.textContent = `Making your video... ${Math.round(f * 100)}%` } })
        film.render(at > 0.5 && at < film.duration - 0.6 ? at : poster())
        const slug = `${names.hero}-${script.id}`.replace(/[^A-Za-z0-9]+/g, '-')
        ;(window as any).__saved = { type: out.blob.type, size: out.blob.size, frames: out.frames, seconds: out.seconds }
        const how = await deliver(out.blob, slug)
        flash(how === 'shared' ? 'Shared!' : `Saved ${(out.blob.size / 1e6).toFixed(1)} MB video`)
      } catch (e) {
        console.error(e)
        flash('This browser cannot save video yet.')
      } finally {
        exporting = false
        save.disabled = false
        play.disabled = false
      }
      return
    }
    if (!recorderType()) { flash('This browser cannot save video yet.'); return }
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
    const ctx: AudioContext | null = Ctor ? new Ctor() : null
    const tap = ctx ? ctx.createMediaStreamDestination() : null
    recording = startRecording(film.canvas, tap?.stream ?? null)
    stopAt = unlocked ? Infinity : (script.paywallAt ?? Infinity)
    save.disabled = true
    play.disabled = true
    flash(MODE === 'greeting' ? 'Recording your greeting...' : 'Recording the teaser...')
    if (ctx && tap) {
      const out = ctx.createGain(); out.connect(ctx.destination); out.connect(tap)
      scheduleScore(ctx, out, film.plan, 0, ctx.currentTime + 0.08)
      started = ctx.currentTime + 0.08
    }
    begin(0, undefined, ctx ?? undefined)
  }

  async function finishRecording() {
    const r = recording!
    recording = null
    stopAt = Infinity
    const blob = await r.stop()
    save.disabled = false
    play.disabled = false
    setPlayLabel('Watch again', 'redo')
    const slug = `${names.hero}-${script.id}`.replace(/[^A-Za-z0-9]+/g, '-')
    ;(window as any).__saved = { type: blob.type, size: blob.size }
    const how = await deliver(blob, slug)
    flash(how === 'shared' ? 'Shared!' : `Saved ${(blob.size / 1e6).toFixed(1)} MB video`)
  }

  let noteTimer = 0
  function flash(text: string) {
    note.textContent = text
    note.hidden = false
    clearTimeout(noteTimer)
    noteTimer = window.setTimeout(() => { note.hidden = true }, 5000)
  }

  // ------------------------------------------------------------ fake door
  function paywall() {
    const price = params.get('price') || '$9'
    const scrim = el('div', { class: 'tb-scrim film-paywall' })
    const close = () => { scrim.remove(); bigPlay.hidden = false }
    const thanks = el('p', { class: 'tb-muted film-thanks' })
    thanks.hidden = true
    const buy = tbButton(`Unlock for ${price}`, { kind: 'primary', onClick: () => {
      logDoor('click')
      buy.disabled = true
      thanks.hidden = false
      thanks.textContent = 'Thank you! Full movies are almost ready. We will email you first.'
    } })
    const later = tbButton('Not now', { kind: 'secondary', onClick: () => { logDoor('dismiss'); close() } })
    const sheet = el('div', { class: 'tb-sheet film-paywall-sheet' },
      el('div', { class: 'tb-sheet-grip' }),
      el('div', { class: 'tb-eyebrow' }, 'To be continued'),
      el('h2', { class: 'tb-h1' }, `Unlock ${names.hero}'s full movie`),
      el('p', { class: 'tb-muted' }, `The whole ${Math.round(film?.duration ?? 45)}-second story, yours to keep and share.`),
      thanks,
      el('div', { class: 'film-paywall-actions' }, later, buy))
    scrim.append(sheet)
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close() })
    document.body.append(scrim)
    logDoor('view')
  }

  function logDoor(event: string) {
    // The fake door's whole point is this number. Stored locally for the demo;
    // the product posts it to the backend with the hero and story ids.
    const key = `hm-film-door-${event}`
    try { localStorage.setItem(key, String(Number(localStorage.getItem(key) ?? 0) + 1)) } catch { /* private mode */ }
    ;(window as any).__door = [...((window as any).__door ?? []), { event, story: script.id, at: Date.now() }]
    console.info('[fake-door]', event, script.id)
  }

  bigPlay.addEventListener('click', () => toggle())
  ;(window as any).__player = { toggle, record, now, get film() { return film } }
  load().catch((e) => { ringWhat.textContent = 'This hero could not load.'; console.error(e) })
}
