import * as THREE from 'three'
import './ui/style.css'
import { Stage } from './stage/stage'
import { PlayCamera } from './stage/camera'
import { loadHero, type Hero } from './avatar/loader'
import { PoseTracker } from './pose/tracker'
import { PoseSolver } from './pose/solver'
import { Game, beatSeconds, TIMING, type Phase } from './game/game'
import { Hud } from './ui/hud'
import { el } from './ui/dom'
import { damp } from './core/math'
import type { Skeleton } from './pose/keypoints'

/**
 * A published page streams its heroes in as base64 blocks after the engine, so
 * the build-time URL map is dead weight there — and worse, it would advertise
 * heroes whose files are not on that origin at all. `import.meta.env.MODE` is
 * replaced with a literal at build time, so this folds away entirely.
 */
const STREAMED = import.meta.env.MODE === 'artifact'

const avatarFiles = (STREAMED ? {} : import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
})) as Record<string, string>
const thumbFiles = import.meta.glob('../assets/avatars/*.thumb.webp', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const ALL_HEROES = [
  { id: 'Crayon_Kid', name: 'Crayon Kid' },
  { id: 'Yummy_Bear', name: 'Yummy Bear' },
  { id: 'Superstar', name: 'Superstar' },
  { id: 'Gingerella', name: 'Gingerella' },
  { id: 'Skelly', name: 'Skelly' },
  { id: 'Cloudy', name: 'Cloudy' },
]

/**
 * Where a hero's bytes come from.
 *
 * In development the build inlines every VRM and hands back a URL. A published
 * page cannot afford that: the whole engine, the pose model and six avatars in
 * one script means nothing paints until the last byte has parsed. There, the
 * packer appends one base64 block per hero *after* the engine, so the game is
 * on screen and choosing a hero while the rest is still arriving.
 */
function heroSource(id: string): string | null {
  const block = document.getElementById(`hm-avatar-${id}`)
  if (block?.textContent) return `data:application/octet-stream;base64,${block.textContent.trim()}`
  return Object.entries(avatarFiles).find(([k]) => k.includes(`${id}.opt`))?.[1] ?? null
}

/** Only heroes whose bytes are actually present; a published page may ship a subset. */
const ROSTER = ALL_HEROES.filter((h) => heroSource(h.id) !== null)

let announceFirstHero: (() => void) | null = null
/** Resolves as soon as one hero can be posed, so boot never waits for all of them. */
const firstHeroReady = ROSTER.length
  ? Promise.resolve()
  : new Promise<void>((resolve) => { announceFirstHero = resolve })

// Called by the packed page once a hero's block has finished arriving.
;(window as unknown as Record<string, unknown>).__hmAvatar = (id: string) => {
  const entry = ALL_HEROES.find((h) => h.id === id)
  if (!entry || ROSTER.some((r) => r.id === id)) return
  ROSTER.push(entry)
  renderPicker()
  announceFirstHero?.()
  announceFirstHero = null
}

const boot = {
  step: (label: string) => (window as { __hdStep?: (l: string) => void }).__hdStep?.(label),
  done: () => (window as { __hdDone?: () => void }).__hdDone?.(),
  fail: (m: string) => (window as { __hdFail?: (m: string) => void }).__hdFail?.(m),
}

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const stage = new Stage()
scene.add(stage.group)
const play = new PlayCamera()
const tracker = new PoseTracker()
const game = new Game()
const hud = new Hud()

let hero: Hero | null = null
let solver: PoseSolver | null = null
let selected = 0
/** Coach poses are driven through the same solver, from the move's skeleton. */
let coachSolver: PoseSolver | null = null

// ---------------------------------------------------------------- screens
const titleLayer = el('div', { class: 'layer sheet', id: 'title' })
const resultsLayer = el('div', { class: 'layer sheet', id: 'results', hidden: true })
app.append(titleLayer, hud.hud, hud.countdownLayer, resultsLayer)

const heroName = el('h2', {}, ROSTER[0]?.name ?? 'Loading heroes…')
const pickerEl = el('div', { class: 'picker', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px' })
const startBtn = el('button', { class: 'btn', onclick: () => beginRun() }, 'START DANCING')
const camNote = el('p', { class: 'hint' }, '')

titleLayer.append(
  el('div', { class: 'card' },
    el('h1', {}, el('em', {}, 'HeroMaker presents'), 'Hero Moves'),
    el('p', { class: 'tag' }, 'Your hero shows a move. You copy it. It copies you back.'),
    heroName,
    pickerEl,
    el('div', { class: 'actions' }, startBtn),
    camNote,
  ),
)

function renderPicker() {
  pickerEl.replaceChildren(...ROSTER.map((r, i) => {
    const thumb = Object.entries(thumbFiles).find(([k]) => k.includes(`${r.id}.thumb`))?.[1]
    const btn = el('button', {
      class: 'btn secondary',
      style: `padding:6px 4px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px${
        i === selected ? ';outline:3px solid var(--pop)' : ''}`,
      onclick: () => selectHero(i),
    })
    if (thumb) btn.append(el('img', { src: thumb, alt: r.name, width: 54, height: 54, style: 'border-radius:8px' }))
    btn.append(el('span', {}, r.name))
    return btn
  }))
  heroName.textContent = ROSTER[selected]?.name ?? 'Loading heroes…'
}

// ---------------------------------------------------------------- results
const resultTitle = el('h1', {}, 'NICE MOVES!')
const resultStats = el('div', { class: 'stats' })
const resultList = el('div', { style: 'display:flex;flex-direction:column;gap:2px' })
const againBtn = el('button', { class: 'btn', onclick: () => beginRun() }, 'DANCE AGAIN')
const changeBtn = el('button', { class: 'btn secondary', onclick: () => showTitle() }, 'CHANGE HERO')
resultsLayer.append(
  el('div', { class: 'card' }, resultTitle, resultStats, resultList,
    el('div', { class: 'actions' }, againBtn, changeBtn)),
)

function showTitle() {
  titleLayer.hidden = false
  resultsLayer.hidden = true
  hud.hud.hidden = true
  hud.countdownLayer.hidden = true
  game.state.phase = 'title'
  play.setPresentation(true)
  reframe()
}

function showResults() {
  const s = game.state
  const acc = game.accuracy
  resultTitle.textContent = acc >= 0.85 ? 'SUPERSTAR!' : acc >= 0.65 ? 'NICE MOVES!' : 'GOOD EFFORT!'
  resultStats.replaceChildren(
    el('div', { class: 'stat' }, el('b', {}, Math.round(s.score).toLocaleString('en-US')), el('span', {}, 'score')),
    el('div', { class: 'stat' }, el('b', {}, `${Math.round(acc * 100)}%`), el('span', {}, 'accuracy')),
    el('div', { class: 'stat' }, el('b', {}, `×${s.bestCombo}`), el('span', {}, 'best combo')),
  )
  resultList.replaceChildren(...s.results.map((r) =>
    el('div', { class: 'scoreline' },
      el('span', {}, r.move.name),
      el('span', { class: 'num' }, `${Math.round(r.score * 100)}%`),
      el('span', { class: `g g-${r.grade}` }, r.grade))))
  resultsLayer.hidden = false
  hud.hud.hidden = true
  reframe()
}

// ---------------------------------------------------------------- flow
game.onPhase = (p: Phase) => {
  hud.countdownLayer.hidden = p !== 'countdown'
  hud.hud.hidden = p === 'title' || p === 'results'
  titleLayer.hidden = p !== 'title'
  if (p === 'results') showResults()
  // Cards cover the stage, so step the hero out from behind them.
  play.setPresentation(p === 'title' || p === 'results')
  reframe()
}
game.onGrade = (r) => hud.showGrade(r)

async function selectHero(i: number) {
  selected = i
  renderPicker()
  const entry = ROSTER[i]
  if (!entry) return
  const url = heroSource(entry.id)
  if (!url) return
  if (hero) { scene.remove(hero.root); hero.dispose() }
  hero = await loadHero(url)
  scene.add(hero.root)
  solver = new PoseSolver(hero.rig, 0.35)
  coachSolver = new PoseSolver(hero.rig, 0.28)
  resize()
}

async function beginRun(rounds = 0) {
  if (tracker.state !== 'ready') {
    camNote.textContent = 'Getting the pose tracker ready…'
    await startLoadingTracker()
    camNote.textContent = ''
    const state = await tracker.start()
    camNote.textContent =
      state === 'ready' ? ''
      : state === 'denied' ? `${tracker.error} — allow the camera and press start again.`
      : 'No camera available on this device.'
    if (state !== 'ready') return
  }
  game.start(clock, rounds)
}

function resize() {
  const w = app.clientWidth, h = app.clientHeight
  renderer.setSize(w, h, false)
  if (!hero) return
  const card = document.querySelector('.layer.sheet:not([hidden]) .card')
  const headroom = card ? card.getBoundingClientRect().top : h * 0.45
  play.frame({
    heroHeight: hero.height, heroWidth: hero.width, aspect: w / h,
    portrait: h > w, headroom, viewportH: h, viewportW: w,
  })
}
addEventListener('resize', resize)

/** Re-solve framing once the DOM has settled after a screen change. */
function reframe() { requestAnimationFrame(() => requestAnimationFrame(resize)) }

// ---------------------------------------------------------------- loop
let last = performance.now()
let heroBob = 0
/**
 * Stretches game time. Only used for capture: this sandbox has no GPU, so
 * MoveNet runs at ~1 fps instead of the 60+ it manages on real hardware, and a
 * beat would pass with barely a sample in it. Recording slowed down and then
 * speeding the footage back up shows the game at the rate a player sees, using
 * the real pipeline throughout.
 */
let timeScale = 1
/** Game clock, which advances at `timeScale` and drives everything timed. */
let clock = 0

renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now
  // Two clocks on purpose. Animation is stepped by a tightly clamped dt so a
  // stalled frame cannot fling the rig across the screen. The game clock is
  // stepped by the real gap, so choreography keeps wall-clock time however
  // slowly the page renders — on a machine with no GPU the old shared clamp
  // ran the music at a tenth speed and the run never reached its last move.
  const dt = Math.min(0.1, elapsed) * timeScale
  clock += Math.min(0.5, elapsed) * timeScale
  const t = clock
  const beat = (t / beatSeconds) % 1

  void tracker.update(now)
  const s = game.state
  const live: Skeleton | null = tracker.state === 'ready' ? tracker.skeleton : null
  game.update(t, live)

  if (hero) {
    // Coach beat: the avatar performs the move on its own, from the very same
    // skeleton the player will be scored against.
    if (s.phase === 'coach' && coachSolver) {
      coachSolver.apply(s.move.skeleton, dt)
    } else if (live && solver && (s.phase === 'copy' || s.phase === 'grade' || s.phase === 'countdown')) {
      solver.apply(live, dt)
    }
    heroBob = damp(heroBob, Math.abs(Math.sin(beat * Math.PI)) * 0.03, 10, dt)
    hero.root.position.y = heroBob
    hero.vrm.update(dt)
  }

  if (s.phase === 'countdown') {
    hud.setCountdown(Math.ceil((1 - s.phaseProgress) * TIMING.countdownBeats))
  }
  hud.update(s)
  hud.setFps(tracker.fps, tracker.lastInferenceMs)
  hud.drawCamera(tracker.video, live)

  stage.update(dt, beat)
  play.update(dt, beat)
  renderer.render(scene, play.camera)
  ;(window as { __frames?: number }).__frames = ((window as { __frames?: number }).__frames ?? 0) + 1
})

/**
 * Model bytes come from a block in the page for the published build, where no
 * fetch of any kind is permitted, and from a plain file during development.
 */
let announceModelBlock: (() => void) | null = null
/**
 * The pose model is 6.4 MB, and nothing needs it until somebody presses start.
 * On a published page it therefore streams in *behind* the engine and the
 * heroes, and this resolves when its block lands. Locally there is no block and
 * the file is fetched instead.
 */
const modelBlockReady = new Promise<void>((resolve) => { announceModelBlock = resolve })
;(window as unknown as Record<string, unknown>).__hmPoseModel = () => {
  announceModelBlock?.()
  announceModelBlock = null
}

async function loadPoseModelSpec() {
  if (STREAMED) await modelBlockReady
  const node = document.getElementById('pose-model')
  if (node?.textContent) {
    const spec = JSON.parse(node.textContent)
    node.remove()          // over 6 MB of base64; do not keep a second copy
    return spec
  }
  const res = await fetch(new URL('pose-model.json', location.href))
  if (!res.ok) throw new Error(`pose model unavailable (${res.status})`)
  return res.json()
}

/**
 * Loading the tracker does not block the title screen: a player picks a hero
 * while it arrives, and `beginRun` waits on this instead.
 */
let trackerReady: Promise<void> | null = null
function startLoadingTracker() {
  trackerReady ??= loadPoseModelSpec()
    .then((spec) => tracker.loadModel(spec))
    .then(() => { boot.step('Pose tracker ready') })
  return trackerReady
}

// ---------------------------------------------------------------- boot
;(async () => {
  try {
    boot.step('Waking up the stage…')
    await firstHeroReady
    renderPicker()
    await selectHero(0)

    startLoadingTracker().catch((err) => boot.fail((err as Error).message))

    play.setPresentation(true)
    resize()
    reframe()
    boot.done()
    ;(window as { __ready?: unknown }).__ready = true
  } catch (err) {
    const message = (err as Error).message
    boot.fail(message)
    ;(window as { __ready?: unknown }).__ready = `error:${message}`
  }
})()

// Hooks the recording and test harnesses drive.
;(window as unknown as Record<string, unknown>).__api = {
  start: (rounds?: number) => beginRun(rounds ?? 0),
  pick: (i: number) => selectHero(i),
  state: () => game.state,
  setTimeScale: (n: number) => {
    timeScale = n
    // Keep CSS transitions on the same clock as the game; see --time-scale.
    document.documentElement.style.setProperty('--time-scale', String(n))
  },
  phase: () => game.state.phase,
  tracker: () => ({ state: tracker.state, fps: tracker.fps, ms: tracker.lastInferenceMs }),
}
