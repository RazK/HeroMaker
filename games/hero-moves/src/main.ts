import * as THREE from 'three'
import './ui/style.css'
import { Stage } from './stage/stage'
import { PlayCamera } from './stage/camera'
import { loadHero, type Hero } from './avatar/loader'
import { PoseTracker } from './pose/tracker'
import { PoseSolver } from './pose/solver'
import { Game, secondsPerBeat, type Phase } from './game/game'
import { routineMoves } from './game/song'
import { warmPictograms } from './ui/pictogram'
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
  // A second hero arriving is what makes a partner possible at all.
  if (ROSTER.length === 2) void selectLeader(1)
  renderPicker()
  // The picker grows a row as heroes land, so the card gets taller and the
  // strip the pair is framed against gets shorter. Without this the framing
  // stays solved for a one-hero card and heads leave the top of the frame.
  reframe()
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

/**
 * Two performers, and neither ever changes job.
 *
 * The previous version had one avatar demonstrate a move and then mirror the
 * player. Same body, same mark, same light — so which of the two it was doing
 * at any moment was unreadable, and it played like a race condition. Here the
 * leader dances the routine and never once reacts to the camera, while the
 * player's hero is driven by the camera from the first frame to the last. You
 * learn which is which by watching for two seconds, and no wording is needed.
 */
interface Performer {
  hero: Hero | null
  solver: PoseSolver | null
  index: number
  root: THREE.Group
  label: HTMLElement
}

const makePerformer = (labelClass: string): Performer => ({
  hero: null, solver: null, index: 0,
  root: new THREE.Group(),
  label: el('div', { class: `nameplate ${labelClass}` }),
})

const leader = makePerformer('leader')
const player = makePerformer('player')
scene.add(leader.root, player.root)

/** Which side of the picker a tap applies to. */
let picking: 'player' | 'leader' = 'player'

/** Lights up under the player's feet with how well they are matching. */
const matchRing = new THREE.Mesh(
  new THREE.RingGeometry(0.42, 0.56, 40),
  new THREE.MeshBasicMaterial({ color: '#ff4d8d', transparent: true, opacity: 0, side: THREE.DoubleSide }),
)
matchRing.rotation.x = -Math.PI / 2
matchRing.position.y = 0.02
player.root.add(matchRing)

// ---------------------------------------------------------------- screens
const titleLayer = el('div', { class: 'layer sheet', id: 'title' })
const resultsLayer = el('div', { class: 'layer sheet', id: 'results', hidden: true })
const nameplates = el('div', { class: 'layer', id: 'nameplates', hidden: true })
nameplates.append(leader.label, player.label)
app.append(titleLayer, hud.hud, nameplates, hud.countdownLayer, resultsLayer)

const pickerEl = el('div', { class: 'picker' })
const startBtn = el('button', { class: 'btn', onclick: () => beginRun() }, 'START DANCING')
const camNote = el('p', { class: 'hint' }, '')

const whoBtns = (['player', 'leader'] as const).map((who) =>
  el('button', {
    class: 'seg',
    onclick: () => { picking = who; renderPicker() },
  }, who === 'player' ? 'You' : 'Your partner'))
const segmented = el('div', { class: 'segmented' }, ...whoBtns)

titleLayer.append(
  el('div', { class: 'card' },
    el('h1', {}, el('em', {}, 'HeroMaker presents'), 'Hero Moves'),
    el('p', { class: 'tag' }, 'Your partner dances. You copy. Both of them are yours.'),
    segmented,
    pickerEl,
    el('div', { class: 'actions' }, startBtn),
    camNote,
  ),
)

function renderPicker() {
  const chosen = picking === 'player' ? player.index : leader.index
  const other = picking === 'player' ? leader.index : player.index
  for (const [i, b] of whoBtns.entries()) {
    b.classList.toggle('on', (i === 0) === (picking === 'player'))
  }
  pickerEl.replaceChildren(...ROSTER.map((r, i) => {
    const thumb = Object.entries(thumbFiles).find(([k]) => k.includes(`${r.id}.thumb`))?.[1]
    const btn = el('button', {
      class: `pick${i === chosen ? ' on' : ''}${i === other ? ' taken' : ''}`,
      onclick: () => (picking === 'player' ? selectPlayer(i) : selectLeader(i)),
    })
    if (thumb) btn.append(el('img', { src: thumb, alt: r.name, width: 54, height: 54 }))
    btn.append(el('span', {}, r.name))
    return btn
  }))
}

// ---------------------------------------------------------------- results
const resultTitle = el('h1', {}, 'NICE MOVES!')
const resultStats = el('div', { class: 'stats' })
const resultList = el('div', { class: 'scorelist' })
const againBtn = el('button', { class: 'btn', onclick: () => beginRun() }, 'DANCE AGAIN')
const changeBtn = el('button', { class: 'btn secondary', onclick: () => showTitle() }, 'CHANGE HEROES')
resultsLayer.append(
  el('div', { class: 'card' }, resultTitle, resultStats, resultList,
    el('div', { class: 'actions' }, againBtn, changeBtn)),
)

function showTitle() {
  titleLayer.hidden = false
  resultsLayer.hidden = true
  hud.hud.hidden = true
  nameplates.hidden = true
  hud.countdownLayer.hidden = true
  game.state.phase = 'title'
  play.setPresentation(true)
  play.setAzimuth(0)
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
  // One line per distinct move, best attempt, since a routine repeats them.
  const best = new Map<string, { name: string; score: number; grade: string }>()
  for (const r of s.results) {
    const prev = best.get(r.move.id)
    if (!prev || r.score > prev.score) best.set(r.move.id, { name: r.move.name, score: r.score, grade: r.grade })
  }
  resultList.replaceChildren(...[...best.values()].map((r) =>
    el('div', { class: 'scoreline' },
      el('span', {}, r.name),
      el('span', { class: 'num' }, `${Math.round(r.score * 100)}%`),
      el('span', { class: `g g-${r.grade}` }, r.grade))))
  resultsLayer.hidden = false
  hud.hud.hidden = true
  nameplates.hidden = true
  reframe()
}

// ---------------------------------------------------------------- flow
game.onPhase = (p: Phase) => {
  hud.countdownLayer.hidden = p !== 'countdown'
  hud.hud.hidden = p === 'title' || p === 'results'
  nameplates.hidden = p === 'title' || p === 'results'
  titleLayer.hidden = p !== 'title'
  if (p === 'results') showResults()
  // Cards cover the stage, so step the pair out from behind them.
  play.setPresentation(p === 'title' || p === 'results')
  reframe()
}
game.onGrade = (r) => hud.showGrade(r)

async function loadInto(p: Performer, i: number, smoothing: number) {
  p.index = i
  const entry = ROSTER[i]
  if (!entry) return
  const url = heroSource(entry.id)
  if (!url) return
  if (p.hero) { p.root.remove(p.hero.root); p.hero.dispose() }
  p.hero = await loadHero(url)
  p.root.add(p.hero.root)
  p.solver = new PoseSolver(p.hero.rig, smoothing)
  p.label.textContent = entry.name
  layoutStage()
  resize()
}

// The leader is smoothed harder: it is performing a known routine, so it should
// glide between shapes. The player is smoothed less, so mirroring feels live.
const selectPlayer = (i: number) => loadInto(player, i, 0.4).then(renderPicker)
const selectLeader = (i: number) => loadInto(leader, i, 0.22).then(renderPicker)

/**
 * Places the pair. The leader stands upstage and to one side, the player
 * downstage on the other — different marks and different depths, so the two
 * never read as the same character, and so a three-quarter camera has
 * something to separate.
 */
function layoutStage() {
  const portrait = app.clientHeight > app.clientWidth
  const sep = portrait ? 0.62 : 0.95
  leader.root.position.set(-sep, 0, -0.5)
  player.root.position.set(sep, 0, 0.45)
  // A few degrees inward, so they read as dancing together rather than as two
  // separate exhibits. Small enough that both faces stay toward the camera.
  leader.root.rotation.y = 0.13
  player.root.rotation.y = -0.1
}

async function beginRun(moves = 0) {
  if (tracker.state !== 'ready') {
    camNote.textContent = 'Getting the pose tracker ready…'
    await startLoadingTracker()
    camNote.textContent = ''
    const state = await tracker.start()
    // An embedded preview is never granted camera permission by its host, so
    // the useful thing to say there is not "allow the camera" — the viewer has
    // nothing to allow. Say where the game can actually be played instead.
    const embedded = window.self !== window.top
    camNote.textContent =
      state === 'ready' ? ''
      : state === 'denied' && embedded
        ? 'This preview cannot reach the camera. Open the downloaded file directly to play.'
      : state === 'denied' ? `${tracker.error} — allow the camera and press start again.`
      : 'No camera available on this device.'
    if (state !== 'ready') return
  }
  game.start(clock, moves)
}

function resize() {
  const w = app.clientWidth, h = app.clientHeight
  renderer.setSize(w, h, false)
  const heroes = [leader.hero, player.hero].filter(Boolean) as Hero[]
  if (!heroes.length) return
  layoutStage()
  const card = document.querySelector('.layer.sheet:not([hidden]) .card')
  const headroom = card ? card.getBoundingClientRect().top : h * 0.45
  const widest = Math.max(...heroes.map((x) => x.width))
  play.frame({
    heroHeight: Math.max(...heroes.map((x) => x.height)),
    spanX: Math.abs(player.root.position.x - leader.root.position.x) + widest,
    spanZ: Math.abs(player.root.position.z - leader.root.position.z) + widest * 0.5,
    aspect: w / h, portrait: h > w, headroom, viewportH: h, viewportW: w,
  })
}
addEventListener('resize', resize)

/** Re-solve framing once the DOM has settled after a screen change. */
function reframe() { requestAnimationFrame(() => requestAnimationFrame(resize)) }

/** Put a nameplate over a performer's head, in screen space. */
const plateAt = new THREE.Vector3()
function placeNameplate(p: Performer) {
  if (!p.hero) return
  plateAt.set(0, p.hero.height * 1.06, 0).applyMatrix4(p.root.matrixWorld).project(play.camera)
  const w = app.clientWidth, h = app.clientHeight
  const behind = plateAt.z > 1
  p.label.style.opacity = behind ? '0' : '1'
  p.label.style.transform =
    `translate(-50%,-100%) translate(${(plateAt.x * 0.5 + 0.5) * w}px, ${(-plateAt.y * 0.5 + 0.5) * h}px)`
}

// ---------------------------------------------------------------- loop
let last = performance.now()
let bob = 0
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
  // stalled frame cannot fling a rig across the screen. The game clock is
  // stepped by the real gap, so choreography keeps wall-clock time however
  // slowly the page renders — on a machine with no GPU the old shared clamp
  // ran the music at a tenth speed and the run never reached its last move.
  const dt = Math.min(0.1, elapsed) * timeScale
  clock += Math.min(0.5, elapsed) * timeScale

  void tracker.update(now)
  const live: Skeleton | null = tracker.state === 'ready' ? tracker.skeleton : null
  game.update(clock, live)
  const s = game.state
  const beat = s.phase === 'title' ? (clock / secondsPerBeat(game.song.bpm)) % 1 : s.beatPhase

  // The leader performs the routine. It never sees the camera.
  if (s.move && leader.solver) leader.solver.apply(s.move.skeleton, dt)
  // The player is the camera, always — including through the count-in, so the
  // first thing anybody sees is their own hero moving when they move.
  if (live && player.solver) player.solver.apply(live, dt)

  bob = damp(bob, Math.abs(Math.sin(beat * Math.PI)) * 0.03, 10, dt)
  for (const p of [leader, player]) {
    if (!p.hero) continue
    p.hero.root.position.y = bob
    p.hero.vrm.update(dt)
  }

  // How well the player is matching, on the floor at their feet rather than in
  // a bar at the edge, so it is unmistakably about them.
  const m = matchRing.material as THREE.MeshBasicMaterial
  const dancing = s.phase === 'dancing'
  m.opacity = damp(m.opacity, dancing ? 0.25 + s.liveScore * 0.55 : 0, 6, dt)
  m.color.set(s.liveScore >= 0.75 ? '#3ddc97' : s.liveScore >= 0.5 ? '#ffd23f' : '#ff4d8d')

  // Swing to a three-quarter view once a phrase, so the pair reads as solid
  // bodies on a stage rather than as two flat cut-outs.
  if (dancing) {
    const phrase = Math.floor(Math.max(0, s.beat) / 16) % 4
    play.setAzimuth([0, 26, 0, -26][phrase])
  }

  if (s.phase === 'countdown') {
    hud.setCountdown(Math.ceil(-s.songTime / secondsPerBeat(game.song.bpm)))
  }
  hud.update(s)
  hud.setFps(tracker.fps, tracker.lastInferenceMs)
  hud.drawCamera(tracker.video, live)

  stage.update(dt, beat)
  play.update(dt, beat)
  renderer.render(scene, play.camera)
  if (!nameplates.hidden) { placeNameplate(leader); placeNameplate(player) }
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
 * Loading the tracker does not block the title screen: a player picks heroes
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
    warmPictograms(routineMoves(game.song))
    await selectPlayer(0)
    if (ROSTER.length > 1) await selectLeader(1)
    renderPicker()

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
  start: (moves?: number) => beginRun(moves ?? 0),
  pick: (i: number) => selectPlayer(i),
  pickLeader: (i: number) => selectLeader(i),
  state: () => game.state,
  setTimeScale: (n: number) => {
    timeScale = n
    // Keep CSS transitions on the same clock as the game; see --time-scale.
    document.documentElement.style.setProperty('--time-scale', String(n))
  },
  phase: () => game.state.phase,
  tracker: () => ({ state: tracker.state, fps: tracker.fps, ms: tracker.lastInferenceMs }),
}
