import * as THREE from 'three'
import '../ui/toybox.css'
import './arena.css'
import { icon, tbButton, tbGrip, tbNav } from '../ui/tb'
import { parseHero, type Hero } from '../avatar/loader'
import { OWN_HERO, OWN_NAME, goBack } from '../ownhero'
import { Controls, type Input } from './controls'
import { Game, ROUND_SECONDS, type Phase } from './game'
import { MOVE_FILES } from './moves'
import { isToy } from './things'
import { Sfx } from './sfx'
import { Crowd, CROWD_MAX, crowdSources, loadFan } from './crowd'
import { ARENA, World } from './world'

/**
 * Robot Rumble: a camera-free arena game starring the player's own hero.
 *
 * Opened by the HeroMaker app exactly like Dance party — `?vrm=<same-origin
 * opt_avatar.vrm>&name=<hero name>` — and, with no `?vrm`, on one of the
 * sample heroes shipped with this build (`?sample=Superstar` picks one).
 * `?class=<id>` names the class a class hero's classmates come from (the
 * game also finds it on its own for the class's teacher); `?crowd=N` caps
 * the stands (default 6, 0 for none).
 *
 * The page is the app's Toy Box screen: header with a round back button,
 * the stage, a bottom bar. The bar holds the start card, then the thumb
 * stick and the two buttons, then the score card.
 */

const params = new URLSearchParams(location.search)
const MANUAL = params.get('manual') === '1'
const DPR = Number(params.get('dpr')) || Math.min(devicePixelRatio, 2)
const CROWD_SIZE = params.has('crowd') ? Math.max(0, Math.min(CROWD_MAX, Number(params.get('crowd')) || 0)) : CROWD_MAX

const samples = import.meta.glob('../../assets/avatars/*.opt.vrm', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const sampleUrl = (name: string) =>
  Object.entries(samples).find(([k]) => k.includes(`/${name}.opt.vrm`))?.[1]
const SAMPLE = params.get('sample') || 'Crayon_Kid'
const HERO_URL = OWN_HERO ?? sampleUrl(SAMPLE) ?? Object.values(samples)[0]
const HERO_NAME = OWN_HERO ? OWN_NAME : (params.get('name') || SAMPLE.replace(/_/g, ' '))

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// ------------------------------------------------------------------ DOM

document.documentElement.classList.add('tb-no-scroll')
const app = document.getElementById('app')!
app.innerHTML = `
  <div class="tb-screen tb-screen--fit rr-screen" data-phase="loading">
    <header class="tb-header">
      <div class="tb-header-side rr-back-slot"></div>
      <div class="tb-header-title rr-title">Robot Rumble</div>
      <div class="tb-header-side tb-header-side--end rr-pills">
        <div class="tb-credits rr-pill rr-score" aria-label="Score">${icon('star', 18)}<span class="rr-score-value">0</span></div>
        <div class="tb-credits rr-pill rr-timer" role="timer" aria-label="Time left">${icon('clock', 18)}<span class="rr-timer-value">1:15</span></div>
      </div>
    </header>
    <div class="rr-stage">
      <div class="rr-pops"></div>
      <div class="tb-credits rr-pill rr-combo" aria-hidden="true">${icon('punch', 18)}<span class="rr-combo-value"></span></div>
      <div class="rr-count" aria-live="assertive"></div>
      <div class="rr-loading" role="status">
        <div class="rr-ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" class="rr-ring-track"/><circle cx="32" cy="32" r="28" class="rr-ring-fill"/></svg><span class="rr-ring-pct">0%</span></div>
        <div class="tb-muted rr-loading-what">Getting ${esc(HERO_NAME)} ready</div>
      </div>
    </div>
    <div class="tb-bar rr-bar">
      <div class="rr-card rr-card--start tb-panel">
        <div class="tb-eyebrow">Robot Rumble</div>
        <div class="tb-h1 rr-hero-name">${esc(HERO_NAME)}</div>
        <div class="rr-line">Bop them before they reach your toys!</div>
        <div class="rr-chips">
          <span class="tb-chip rr-chip">${icon('punch', 18)}Punch</span>
          <span class="tb-chip rr-chip">${icon('jump', 18)}+${icon('punch', 18)}Smash</span>
        </div>
        <div class="rr-start-slot"></div>
      </div>
      <div class="rr-card rr-card--end tb-panel">
        <div class="tb-eyebrow rr-end-eyebrow">Time’s up!</div>
        <div class="rr-end-score"><span class="rr-end-value">0</span><span class="rr-end-label">points</span></div>
        <div class="rr-line rr-end-best">Best 0</div>
        <div class="rr-end-buttons"></div>
      </div>
    </div>
  </div>`

const screen = app.querySelector<HTMLElement>('.rr-screen')!
const stageEl = app.querySelector<HTMLElement>('.rr-stage')!
const bar = app.querySelector<HTMLElement>('.rr-bar')!
const popsEl = app.querySelector<HTMLElement>('.rr-pops')!
const comboEl = app.querySelector<HTMLElement>('.rr-combo')!
const comboValue = app.querySelector<HTMLElement>('.rr-combo-value')!
const countEl = app.querySelector<HTMLElement>('.rr-count')!
const scoreEl = app.querySelector<HTMLElement>('.rr-score-value')!
const timerEl = app.querySelector<HTMLElement>('.rr-timer')!
const timerValue = app.querySelector<HTMLElement>('.rr-timer-value')!
// The app's own parts (ui/tb.ts): the round back button, the big pill buttons,
// the sheet grip. Primary last, as in every bottom bar of the app.
app.querySelector('.rr-back-slot')!.append(tbNav('back', 'Back to your hero', goBack))
for (const card of app.querySelectorAll('.rr-card')) card.prepend(tbGrip())
const startBtn = tbButton('Start', { icon: 'play' })
startBtn.classList.add('rr-start')
startBtn.disabled = true
app.querySelector('.rr-start-slot')!.replaceWith(startBtn)
const againBtn = tbButton('Play again', { icon: 'redo' })
againBtn.classList.add('rr-again')
app.querySelector('.rr-end-buttons')!.append(tbButton('Back', { kind: 'secondary', onClick: goBack }), againBtn)
const ringFill = app.querySelector<SVGCircleElement>('.rr-ring-fill')!
const ringPct = app.querySelector<HTMLElement>('.rr-ring-pct')!

const controls = new Controls(bar, stageEl)
const sfx = new Sfx()

// ------------------------------------------------------------------ 3D

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
let pixelRatio = DPR
renderer.setPixelRatio(pixelRatio)
stageEl.prepend(renderer.domElement)
renderer.domElement.className = 'rr-canvas'

const world = new World()
const crowd = new Crowd(world.scene, CROWD_SIZE)
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60)
let game: Game | null = null
let size = { w: 1, h: 1 }

function resize() {
  const w = Math.max(1, stageEl.clientWidth)
  const h = Math.max(1, stageEl.clientHeight)
  if (w === size.w && h === size.h) return
  size = { w, h }
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(stageEl)

// ---- camera: three-quarters from the front, always. Two framings, blended:
// the showcase (hero big, menu and end) and the arena (play).
const cam = { pos: new THREE.Vector3(0, 3, 9), look: new THREE.Vector3(0, 1, 0), show: 1, shake: 0 }
function aimCamera(dt: number, snap = false) {
  const g = game
  const aspect = size.w / size.h
  // The stage, not the phone: a 360x640 phone leaves a squarish stage.
  const portrait = aspect < 1.3
  const hx = g?.pos.x ?? 0, hz = g?.pos.z ?? 0.6
  const heroH = g?.hero.height ?? 1.7

  // Arena framing: see enough of the floor around the hero to meet what is
  // coming, follow the hero part of the way so the near edge stays in view.
  const vfov = portrait ? 50 : 40
  const tanV = Math.tan(THREE.MathUtils.degToRad(vfov / 2))
  const halfW = portrait ? 1.75 * Math.max(1, aspect / 0.75) : 5.2
  const dist = THREE.MathUtils.clamp(halfW / (tanV * aspect), 6.0, 12)
  const elev = THREE.MathUtils.degToRad(portrait ? 24 : 27)
  // Follow the hero most of the way, so the tiles slide by as it runs, but
  // stop short of the walls so they come into view at the room's edges.
  const tx = THREE.MathUtils.clamp(hx * (portrait ? 0.85 : 0.6), ARENA.minX + halfW * 0.55, ARENA.maxX - halfW * 0.55)
  // Look a little ahead of the hero, toward the camera: the robots' doorway
  // is the front edge, and it should be on screen, not under the controls.
  const tz = THREE.MathUtils.lerp(0.3, hz, 0.8) + (portrait ? 0.15 : 0.1)
  const playLook = new THREE.Vector3(tx, 0.95, tz)
  const playPos = playLook.clone().add(new THREE.Vector3(0, Math.sin(elev) * dist, Math.cos(elev) * dist))

  // Showcase framing: the hero fills about half the stage height, seen from
  // a little above and to the side — the three-quarter view a toy box shows.
  const showFov = portrait ? 34 : 30
  const tanS = Math.tan(THREE.MathUtils.degToRad(showFov / 2))
  const sd = Math.max((heroH * 0.62 / 0.5) / 2 / tanS, ((g?.hero.width ?? 1) * 0.75) / (tanS * aspect)) + 0.8
  const showLook = new THREE.Vector3(hx, heroH * 0.52, hz)
  const yaw = 0.32
  const showPos = showLook.clone().add(new THREE.Vector3(Math.sin(yaw) * sd, heroH * 0.25 + 0.3, Math.cos(yaw) * sd))

  const k = cam.show
  const fov = THREE.MathUtils.lerp(vfov, showFov, k)
  const pos = playPos.clone().lerp(showPos, k)
  const look = playLook.clone().lerp(showLook, k)
  const rate = snap ? 1 : 1 - Math.exp(-5 * dt)
  cam.pos.lerp(pos, rate)
  cam.look.lerp(look, rate)
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix() }
  camera.position.copy(cam.pos)
  if (cam.shake > 0) {
    const s = cam.shake * 0.12
    camera.position.x += (Math.random() - 0.5) * s
    camera.position.y += (Math.random() - 0.5) * s
    cam.shake = Math.max(0, cam.shake - dt * 3)
  }
  camera.lookAt(cam.look)
  if (g) g.cameraPos.copy(camera.position)
}

// ------------------------------------------------------------------ popups

interface Pop { el: HTMLElement; at: THREE.Vector3; t: number }
const pops: Pop[] = []
const _v = new THREE.Vector3()
function popup(at: THREE.Vector3, text: string, tone: string) {
  const el = document.createElement('div')
  el.className = `rr-pop rr-pop--${tone}`
  el.textContent = text
  popsEl.appendChild(el)
  pops.push({ el, at: at.clone(), t: 0 })
  while (pops.length > 8) pops.shift()!.el.remove()
}
function updatePops(dt: number) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]
    p.t += dt
    const life = 0.9
    if (p.t > life) { p.el.remove(); pops.splice(i, 1); continue }
    _v.copy(p.at).setY(p.at.y + p.t * 0.9).project(camera)
    const x = (_v.x * 0.5 + 0.5) * size.w
    const y = (-_v.y * 0.5 + 0.5) * size.h
    const grow = p.t < 0.12 ? 0.6 + 0.4 * (p.t / 0.12) * 1.15 : 1
    const fade = p.t > life - 0.25 ? (life - p.t) / 0.25 : 1
    // Kept clear of the stage edges, so a name never runs off the side.
    const cx = Math.min(Math.max(x, p.el.offsetWidth / 2 + 8), size.w - p.el.offsetWidth / 2 - 8)
    p.el.style.transform = `translate(${cx}px, ${y}px) translate(-50%, -100%) scale(${grow})`
    p.el.style.opacity = String(fade)
  }
}

// ------------------------------------------------------------------ state

const BEST_KEY = 'heromaker.robotRumble.best'
function readBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0 } catch { return 0 }
}
function writeBest(v: number) {
  try { localStorage.setItem(BEST_KEY, String(v)) } catch { /* private mode: best lasts the visit */ }
}

let phase: Phase | 'loading' = 'loading'
let countdown = 0
let endAt = 0
let hitStop = 0
let cheers = 0
let lastShownSecond = -1
const perf = { frames: 0, ms: 0, worst: 0, calls: 0, fps: 0, dropped: false }

function setPhase(p: Phase) {
  phase = p
  screen.dataset.phase = p
  if (game) game.phase = p
  controls.setEnabled(p === 'play' || p === 'countdown')
  ;(window as unknown as { __phase?: string }).__phase = p
}

function start(seed = Math.floor(Math.random() * 1e9)) {
  if (!game) return
  sfx.unlock()
  game.reset(seed)
  for (const p of pops.splice(0)) p.el.remove()
  countdown = 2.4
  setPhase('countdown')
  game.phase = 'countdown'
}

function finish() {
  if (!game) return
  setPhase('end')
  endAt = performance.now()
  game.celebrate()
  crowd.celebrate()
  sfx.fanfare()
  const best = readBest()
  const isBest = game.score > best
  if (isBest) writeBest(game.score)
  app.querySelector('.rr-end-value')!.textContent = game.score.toLocaleString('en-US')
  app.querySelector('.rr-end-eyebrow')!.textContent = isBest && game.score > 0 ? 'New best!' : 'Time’s up!'
  const s = game.stats
  const bopped = s.robots + s.mushrooms + s.bouncies + s.crates + s.balloons
  app.querySelector('.rr-end-best')!.textContent = isBest
    ? `${bopped} bopped`
    : `Best ${best.toLocaleString('en-US')} · ${bopped} bopped`
  // A thumb still hammering Punch when time runs out must not land on Back:
  // the card's buttons wake up a moment after it appears.
  // (Inert rather than disabled, so they do not flash grey.)
  const endButtons = app.querySelector<HTMLElement>('.rr-end-buttons')!
  endButtons.inert = true
  setTimeout(() => {
    endButtons.inert = false
    againBtn.focus({ preventScroll: true })
  }, 900)
}

startBtn.addEventListener('click', () => start())
againBtn.addEventListener('click', () => start())

// ------------------------------------------------------------------ the frame

let last = performance.now()
let gameClock = 0
const NO_INPUT: Input = { x: 0, y: 0, punch: false, jump: false }

function frame(dtReal: number, render = true) {
  const t0 = performance.now()
  resize()
  // Animation dt is clamped so a stalled frame cannot fling the rig; the
  // countdown and the round clock run on wall time (see Game.update), capped
  // only so a backgrounded tab does not lose the round in one frame.
  const clockDt = Math.min(dtReal, 0.25)
  let dt = Math.min(dtReal, 1 / 20)
  gameClock += dt
  if (hitStop > 0) { hitStop -= dt; dt *= 0.08 }

  if (game) {
    if (phase === 'countdown') {
      const before = Math.ceil(countdown)
      countdown -= clockDt
      const n = Math.ceil(countdown)
      countEl.textContent = countdown > 0.4 ? String(Math.min(3, n)) : 'Go!'
      countEl.classList.toggle('is-on', countdown > -0.5)
      if (n !== before && countdown > 0) sfx.tick()
      if (countdown <= 0) { setPhase('play'); sfx.tick() }
    } else if (countEl.classList.contains('is-on') && (phase !== 'play' || countdown < -0.5)) {
      countEl.classList.remove('is-on')
    }
    if (phase === 'play') countdown -= clockDt

    const input = phase === 'play' ? controls.read() : (controls.read(), NO_INPUT)
    game.update(dt, input, clockDt)
    if (phase === 'play' && game.remaining <= 0) finish()

    // End: cheer, then dance until the player chooses.
    if (phase === 'end' && !game.moves.playing && game.moves.has('dance')) game.moves.play('dance', { loop: true, fadeIn: 0.3 })

    // HUD
    scoreEl.textContent = game.score.toLocaleString('en-US')
    const rem = phase === 'play' ? game.remaining : phase === 'countdown' ? ROUND_SECONDS : 0
    const sec = Math.ceil(rem)
    if (sec !== lastShownSecond) {
      lastShownSecond = sec
      timerValue.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
      timerEl.classList.toggle('is-low', phase === 'play' && sec <= 10)
      if (phase === 'play' && sec <= 5 && sec > 0) sfx.tick()
    }
    const mult = game.multiplier
    if (game.combo >= 2) comboValue.textContent = `${game.combo} hits${mult > 1 ? ` · x${mult}` : ''}`
    comboEl.classList.toggle('is-on', game.combo >= 2 && phase === 'play')
  }
  const showTarget = phase === 'play' || phase === 'countdown' ? 0 : 1
  cam.show += (showTarget - cam.show) * (1 - Math.exp(-(showTarget ? 2.2 : 3.2) * dt))
  aimCamera(dt)
  camera.updateMatrixWorld()
  crowd.update(dt, camera)
  updatePops(dt)
  if (render) renderer.render(world.scene, camera)

  // Performance: frame cost and draw calls, and a cheaper pixel ratio if the
  // device cannot keep up (never in manual/recording mode).
  const ms = performance.now() - t0
  perf.frames++
  perf.ms += ms
  perf.worst = Math.max(perf.worst, dtReal * 1000)
  perf.calls = renderer.info.render.calls
}

function loop() {
  const now = performance.now()
  const dt = (now - last) / 1000
  last = now
  frame(dt)
  // Degrade once if the device is slow: two seconds averaging under ~40 fps.
  fpsWindow.push(dt)
  if (fpsWindow.length > 120) fpsWindow.shift()
  if (!perf.dropped && fpsWindow.length === 120 && phase === 'play') {
    const avg = fpsWindow.reduce((a, b) => a + b, 0) / fpsWindow.length
    perf.fps = 1 / avg
    if (avg > 1 / 40 && pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio * 0.7)
      renderer.setPixelRatio(pixelRatio)
      size = { w: 0, h: 0 }
      perf.dropped = true
    }
  }
}
const fpsWindow: number[] = []
if (!MANUAL) renderer.setAnimationLoop(loop)

// ------------------------------------------------------------------ boot

async function download(url: string, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`hero file: ${r.status}`)
  const total = Number(r.headers.get('content-length')) || 0
  const reader = r.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    onProgress(total ? Math.min(0.95, got / total) : Math.min(0.9, got / 2e6))
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out.buffer
}

function setProgress(f: number) {
  const c = 2 * Math.PI * 28
  ringFill.style.strokeDasharray = `${c}`
  ringFill.style.strokeDashoffset = `${c * (1 - f)}`
  ringPct.textContent = `${Math.round(f * 100)}%`
}

;(async () => {
  try {
    setProgress(0)
    const buf = await download(HERO_URL, (f) => setProgress(f * 0.85))
    const hero: Hero = await parseHero(buf)
    setProgress(0.9)
    game = new Game(hero, world, sfx, {
      popup,
      shake: (a) => { cam.shake = Math.max(cam.shake, a) },
      hitStop: (s) => { hitStop = Math.max(hitStop, s) },
      // The stands jump up when the player scores.
      scored: (_kind, big) => {
        if (crowd.cheer(big) && big) sfx.cheer()
        cheers++
      },
    })
    game.reset()
    const loaded = await game.moves.load()
    setProgress(1)
    if (!game.moves.ready) throw new Error('the moves did not load')
    setPhase('menu')
    resize()
    aimCamera(0, true)
    startBtn.disabled = false
    ;(window as unknown as { __ready?: unknown; __moves?: number }).__moves = loaded
    ;(window as unknown as { __ready?: unknown }).__ready = true
    // The crowd: other heroes cheering from the stands, one after another
    // behind the player's. The game never waits for them, and plays the same
    // with empty stands.
    void (async () => {
      const w = window as unknown as { __crowd?: number; __crowdFrom?: string[] }
      if (CROWD_SIZE > 0) {
        try {
          const from: string[] = []
          for (const src of await crowdSources(OWN_HERO ?? HERO_URL, samples, CROWD_SIZE, params.get('class'))) {
            if (await loadFan(crowd, src)) from.push(src.from)
          }
          w.__crowdFrom = from
        } catch { /* empty stands */ }
      }
      w.__crowd = crowd.size
    })()
  } catch (err) {
    const message = (err as Error).message
    screen.dataset.phase = 'error'
    app.querySelector('.rr-loading-what')!.textContent = 'This hero can’t play right now.'
    ;(window as unknown as { __ready?: unknown }).__ready = `error:${message}`
  }
})()

// ------------------------------------------------------------------ harness

/**
 * For tools/arena-*.mjs: read the game, start it with a seed, and in
 * `?manual=1` step it frame by frame so a slow software renderer still
 * records smooth footage.
 */
;(window as unknown as Record<string, unknown>).__arena = {
  start: (seed?: number) => start(seed),
  step: (n = 1, dt = 1 / 30, render = true) => { for (let i = 0; i < n; i++) frame(dt, render && i === n - 1) },
  state: () => {
    if (!game) return null
    const project = (p: THREE.Vector3) => {
      const v = p.clone().project(camera)
      const r = renderer.domElement.getBoundingClientRect()
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }
    }
    /** An object's bounding box on screen, in page pixels. */
    const screenBox = (o: THREE.Object3D) => {
      o.updateWorldMatrix(true, true)
      const b = new THREE.Box3().setFromObject(o)
      const pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => project(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)))
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y)
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
    }
    return {
      phase, time: game.time, remaining: game.remaining, score: game.score, combo: game.combo,
      hero: { x: game.pos.x, y: game.pos.y, z: game.pos.z, heading: game.heading, airborne: game.airborne, playing: game.moves.playing, height: game.hero.height, width: game.hero.width, radius: game.radius, screen: project(game.pos) },
      crowd: {
        size: crowd.size, onScreen: crowd.onScreen, cheers, cards: crowd.board.size,
        // Screen boxes, for the harness's "in shot, clear of heads" check.
        fans: crowd.fans.map((f) => ({ name: f.name, from: f.from, on: f.on, x: f.base.x, y: f.base.y, z: f.base.z, screen: project(f.base), box: screenBox(f.hero.root) })),
        drawings: crowd.board.cards.map((c) => screenBox(c)),
      },
      things: game.things.filter((t) => !t.dead && !t.dying).map((t) => ({ kind: t.kind, age: t.age, x: t.pos.x, y: t.pos.y, z: t.pos.z, vx: t.vel.x, vz: t.vel.z, hp: t.hp, screen: project(t.pos) })),
      stats: game.stats,
      facing: { front: game.facing.front, total: game.facing.total, detail: game.facing.detail },
      perf: { frames: perf.frames, avgMs: perf.frames ? perf.ms / perf.frames : 0, worstFrameMs: perf.worst, drawCalls: perf.calls, fps: perf.fps, pixelRatio, triangles: renderer.info.render.triangles },
      clock: gameClock,
      files: MOVE_FILES,
    }
  },
  resetPerf: () => { perf.frames = 0; perf.ms = 0; perf.worst = 0 },
  /**
   * The rule Raz set, as a check: nothing the player can hit is a hero, or a
   * child's drawing. Every live target is a generated toy with no skinned
   * mesh in it; no fan and no pinned drawing is inside the game's tree (the
   * only one the punch reads) or inside any target; every fan is in the
   * stands (on a letter block or a grandstand row, behind the court and
   * within its width); every drawing hangs on the back wall.
   */
  audit: () => {
    const g = game?.audit() ?? { things: 0, kinds: [], bad: [] }
    const under = (o: THREE.Object3D, root: THREE.Object3D) => { let q: THREE.Object3D | null = o; while (q) { if (q === root) return true; q = q.parent } return false }
    const fansInGame = game ? crowd.fans.filter((f) => under(f.hero.root, game!.root)).length : 0
    const targets = game ? game.things.filter((t) => !t.dead).map((t) => t.obj) : []
    const cardsHittable = crowd.board.cards.filter((c) => (game && under(c, game.root)) || targets.some((t) => under(c, t))).length
    const seated = crowd.seated()
    const onWall = crowd.board.onWall()
    // The detector itself, shown a real hero: it must say "not a toy".
    const detects = (!game || !isToy(game.hero.root)) && crowd.fans.every((f) => !isToy(f.hero.root))
    return {
      ok: g.bad.length === 0 && fansInGame === 0 && cardsHittable === 0 && seated && onWall && detects,
      ...g, crowd: crowd.size, drawings: crowd.board.size, fansInGame, cardsHittable, crowdSeated: seated, drawingsOnWall: onWall, detectorCatchesHeroes: detects,
    }
  },
}
