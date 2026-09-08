import * as THREE from 'three'
import './ui/style.css'
import './ui/party.css'
import { Stage } from './stage/stage'
import { PlayCamera } from './stage/camera'
import { loadHero, type Hero } from './avatar/loader'
import { PoseTracker } from './pose/tracker'
import { PoseSolver } from './pose/solver'
import { PartyGame, LENGTHS, makeRoutine, type PartyPhase, type LengthId, type Player } from './game/party'
import { Performer, loadAllClips } from './anim/performer'
import { PartyHud } from './ui/partyhud'
import { Audio } from './core/audio'
import { el } from './ui/dom'
import { damp } from './core/math'
import { bodyConfidence, type Skeleton } from './pose/keypoints'
import { classify } from './pose/vocab'

/**
 * Hero Moves — one to three players, one lane each.
 *
 * There is no coach and no demonstrator. The strip says what is coming and
 * when; each hero mirrors its own player and nothing else. That is the whole
 * fix for the confusion the two-character version had — with only one role on
 * stage there is nothing to mistake it for.
 */

const STREAMED = import.meta.env.MODE === 'artifact'

const avatarFiles = (STREAMED ? {} : import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
})) as Record<string, string>
const thumbFiles = import.meta.glob('../assets/avatars/*.thumb.webp', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>
const animFiles = import.meta.glob('../assets/animations/*', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const animUrl = (file: string): string => {
  const stem = file.replace(/\.[^.]+$/, '')
  return Object.entries(animFiles).find(([k]) => k.includes(`/${stem}`))?.[1] ?? file
}

const ALL_HEROES = [
  { id: 'Crayon_Kid', name: 'Crayon Kid' },
  { id: 'Yummy_Bear', name: 'Yummy Bear' },
  { id: 'Superstar', name: 'Superstar' },
  { id: 'Gingerella', name: 'Gingerella' },
  { id: 'Skelly', name: 'Skelly' },
  { id: 'Cloudy', name: 'Cloudy' },
]

function heroSource(id: string): string | null {
  const block = document.getElementById(`hm-avatar-${id}`)
  if (block?.textContent) return `data:application/octet-stream;base64,${block.textContent.trim()}`
  return Object.entries(avatarFiles).find(([k]) => k.includes(`${id}.opt`))?.[1] ?? null
}

const ROSTER = ALL_HEROES.filter((h) => heroSource(h.id) !== null)

let announceFirstHero: (() => void) | null = null
const firstHeroReady = ROSTER.length
  ? Promise.resolve()
  : new Promise<void>((resolve) => { announceFirstHero = resolve })

;(window as unknown as Record<string, unknown>).__hmAvatar = (id: string) => {
  const entry = ALL_HEROES.find((h) => h.id === id)
  if (!entry || ROSTER.some((r) => r.id === id)) return
  ROSTER.push(entry)
  renderMenu()
  announceFirstHero?.()
  announceFirstHero = null
}

const boot = {
  step: (label: string) => (window as { __hdStep?: (l: string) => void }).__hdStep?.(label),
  done: () => (window as { __hdDone?: () => void }).__hdDone?.(),
  fail: (m: string) => (window as { __hdFail?: (m: string) => void }).__hdFail?.(m),
}

const app = document.getElementById('app')!
/**
 * Quality, and giving it up gracefully.
 *
 * This is a rhythm game: when a device cannot keep up, the thing that must not
 * be spent is the beat. Frames that take longer than a beat make the routine
 * run slow and the scoring windows drift, which is a broken game — while
 * dropping shadows is a slightly flatter one. So the renderer watches its own
 * frame times and gives up the expensive things before it gives up the tempo.
 *
 * `?lite=1` starts there, for the recording harnesses and for anyone who wants
 * it: antialiasing can only be chosen at construction, so it is the one thing
 * the automatic path cannot drop later.
 */
const LITE = new URLSearchParams(location.search).get('lite') === '1'
const renderer = new THREE.WebGLRenderer({ antialias: !LITE, powerPreference: 'high-performance' })
renderer.setPixelRatio(LITE ? 1 : Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = !LITE
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
const game = new PartyGame()
const hud = new PartyHud()
const audio = new Audio()

/** One lane on stage: a hero, its solver, and its clip player. */
interface Lane {
  hero: Hero | null
  solver: PoseSolver | null
  anim: Performer | null
  heroIndex: number
  root: THREE.Group
  loading: number
}
const MAX_PLAYERS = 3
const lanes: Lane[] = Array.from({ length: MAX_PLAYERS }, () => ({
  hero: null, solver: null, anim: null, heroIndex: 0,
  root: new THREE.Group(), loading: 0,
}))
for (const l of lanes) scene.add(l.root)

/** Menu selection. */
let playerCount = 1
let lengthId: LengthId = 'normal'
const picks = [0, 1, 2]

// ---------------------------------------------------------------- screens
const menuLayer = el('div', { class: 'layer sheet', id: 'title' })
const pauseLayer = el('div', { class: 'layer sheet', id: 'pause', hidden: true })
const resultsLayer = el('div', { class: 'layer sheet', id: 'results', hidden: true })
app.append(hud.hud, hud.platesLayer, hud.countdownLayer, menuLayer, pauseLayer, resultsLayer)

// ---- menu ------------------------------------------------------------------
const countRow = el('div', { class: 'segmented' })
const pickerWrap = el('div', { class: 'stack-2' })
const lengthRow = el('div', { class: 'segmented' })
const menuCam = el('canvas', { width: 300, height: 84, class: 'menu-cam' }) as HTMLCanvasElement
const camHint = el('p', { class: 'hint' }, 'Camera off — press start and allow it')
const startBtn = el('button', { class: 'btn', onclick: () => beginRun() }, 'START DANCING')
const camWrap = el('div', { class: 'menu-camwrap off' }, menuCam, camHint)

menuLayer.append(
  el('div', { class: 'card' },
    el('h1', {}, el('em', {}, 'HeroMaker presents'), 'Hero Moves'),
    camWrap,
    el('div', { class: 'reel-label' }, 'Players'),
    countRow,
    pickerWrap,
    el('div', { class: 'reel-label' }, 'Round length'),
    lengthRow,
    el('div', { class: 'actions' }, startBtn),
  ),
)

function renderMenu() {
  countRow.replaceChildren(...[1, 2, 3].map((n) =>
    el('button', {
      class: `seg${n === playerCount ? ' on' : ''}`,
      onclick: () => { playerCount = n; audio.uiClick(); applyCount(); renderMenu() },
    }, n === 1 ? '1 player' : `${n} players`)))

  lengthRow.replaceChildren(...LENGTHS.map((l) =>
    el('button', {
      class: `seg${l.id === lengthId ? ' on' : ''}`,
      onclick: () => { lengthId = l.id; audio.uiClick(); renderMenu() },
      title: l.blurb,
    }, l.label)))

  pickerWrap.replaceChildren(...Array.from({ length: playerCount }, (_, i) =>
    el('div', { class: `pick-row lane-${i}` },
      el('div', { class: 'pick-tag' }, `P${i + 1}`),
      el('div', { class: 'pick-strip' }, ...ROSTER.map((r, k) => {
        const thumb = Object.entries(thumbFiles).find(([t]) => t.includes(`${r.id}.thumb`))?.[1]
        const taken = picks.slice(0, playerCount).some((p, j) => p === k && j !== i)
        const b = el('button', {
          class: `pick${picks[i] === k ? ' on' : ''}${taken ? ' taken' : ''}`,
          onclick: () => { picks[i] = k; audio.uiClick(); void loadLane(i, k); renderMenu() },
          title: r.name,
        })
        if (thumb) b.append(el('img', { src: thumb, alt: r.name, width: 44, height: 44 }))
        // The strip scrolls, so the chosen hero has to be brought into view or
        // a player cannot see what they picked.
        if (picks[i] === k) queueMicrotask(() => {
          const strip = b.parentElement
          if (!strip) return
          const left = b.offsetLeft - (strip.clientWidth - b.offsetWidth) / 2
          strip.scrollLeft = Math.max(0, left)
        })
        return b
      })))))
}

/** Show and load exactly `playerCount` heroes, and lay the stage out for them. */
function applyCount() {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    lanes[i].root.visible = i < playerCount
    if (i < playerCount && !lanes[i].hero) void loadLane(i, picks[i])
  }
  hud.sizeCamera(playerCount)
  layoutStage()
  resize()
}

// ---- pause -----------------------------------------------------------------
pauseLayer.append(
  el('div', { class: 'card' },
    el('h1', {}, 'PAUSED'),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => game.resume(clock) }, 'RESUME'),
      el('button', { class: 'btn secondary', onclick: () => game.finish() }, 'END & SEE SCORES'),
      el('button', { class: 'btn secondary', onclick: () => showMenu() }, 'QUIT TO MENU'),
    ),
  ),
)

// ---- results ---------------------------------------------------------------
const resultTitle = el('h1', {}, 'NICE MOVES!')
const podium = el('div', { class: 'podium' })
resultsLayer.append(
  el('div', { class: 'card' }, resultTitle, podium,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', onclick: () => beginRun() }, 'DANCE AGAIN'),
      el('button', { class: 'btn secondary', onclick: () => showMenu() }, 'CHANGE HEROES'),
    )),
)

function showResults() {
  const ranked = game.ranking
  const solo = ranked.length === 1
  resultTitle.textContent = solo
    ? (game.accuracy(ranked[0]) >= 0.75 ? 'SUPERSTAR!' : 'NICE MOVES!')
    : `${ROSTER[ranked[0].heroIndex]?.name ?? 'P1'} WINS!`
  podium.replaceChildren(...ranked.map((p, place) => {
    const hero = ROSTER[p.heroIndex]
    const thumb = Object.entries(thumbFiles).find(([t]) => t.includes(`${hero?.id}.thumb`))?.[1]
    const row = el('div', { class: `podium-row${place === 0 && !solo ? ' win' : ''}` })
    row.append(el('div', { class: `place lane-${p.lane}` }, solo ? '' : `${place + 1}`))
    if (thumb) row.append(el('img', { src: thumb, alt: hero?.name ?? '', width: 46, height: 46 }))
    row.append(
      el('div', { class: 'podium-who' },
        el('b', {}, hero?.name ?? `Player ${p.lane + 1}`),
        el('span', { class: 'muted' }, `P${p.lane + 1}`)),
      el('div', { class: 'podium-nums' },
        el('b', { class: 'num' }, Math.round(p.score).toLocaleString('en-US')),
        el('span', { class: 'num' }, `${Math.round(game.accuracy(p) * 100)}% · ×${p.bestCombo}`)),
    )
    return row
  }))
}

// ---- phase wiring ----------------------------------------------------------
function showMenu() {
  game.quit()
}

game.onPhase = (p: PartyPhase) => {
  menuLayer.hidden = p !== 'menu'
  pauseLayer.hidden = p !== 'paused'
  resultsLayer.hidden = p !== 'results'
  hud.hud.hidden = p === 'menu' || p === 'results'
  hud.platesLayer.hidden = p === 'menu' || p === 'results'
  hud.countdownLayer.hidden = p !== 'countdown'
  if (p === 'results') { showResults(); audio.setMusic(false); celebrate() }
  if (p === 'menu') { hud.resetStrip(); audio.setMusic(false); idleDance() }
  if (p === 'dancing') audio.setMusic(true)
  if (p === 'paused') audio.setMusic(false)
  // Pause deliberately does not re-frame: the card is centred and the stage
  // behind it should be exactly where the player left it. Zooming out and
  // sliding the whole line sideways for a four-second interruption reads as
  // the game losing its place.
  if (p !== 'paused') {
    play.setPresentation(p === 'menu' || p === 'results')
    reframe()
  }
}
game.onGrade = (p: Player, r) => {
  hud.popGrade(p.lane, r.grade)
  if (p.lane === 0) audio.grade(r.grade)
  if (r.grade === 'PERFECT') lanes[p.lane].anim?.play('victory')
}
hud.pauseBtn.onclick = () => togglePause()
function togglePause() {
  if (game.state.phase === 'paused') game.resume(clock)
  else game.pause(clock)
}
// A rhythm game played standing three feet from a laptop needs a stop that is
// not a small button in a corner. Escape is the one key everyone already knows.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' && e.key !== ' ') return
  const phase = game.state.phase
  if (phase === 'dancing' || phase === 'countdown' || phase === 'paused') {
    e.preventDefault()
    togglePause()
  }
})

/** The winner takes a bow and everyone else keeps dancing. */
function celebrate() {
  const winner = game.ranking[0]
  for (let i = 0; i < playerCount; i++) {
    lanes[i].anim?.play(winner && i === winner.lane ? 'victory' : 'dance', { loop: true })
  }
}

/**
 * Everyone loose-dances on the menu, so the stage is never a row of statues.
 *
 * Which clip each hero gets is drawn at random every time the menu comes back,
 * because three heroes doing the same dance in unison reads as one animation
 * played three times rather than as three characters.
 */
const LOOPS = ['dance', 'bodyroll']
function idleDance() {
  for (let i = 0; i < playerCount; i++) {
    lanes[i].anim?.play(LOOPS[Math.floor(Math.random() * LOOPS.length)], { loop: true })
  }
}

async function loadLane(i: number, heroIndex: number) {
  const lane = lanes[i]
  lane.heroIndex = heroIndex
  const entry = ROSTER[heroIndex]
  if (!entry) return
  const url = heroSource(entry.id)
  if (!url) return
  const token = ++lane.loading
  const hero = await loadHero(url)
  // A tap-happy player can change hero three times while one is downloading.
  if (token !== lane.loading) { hero.dispose(); return }
  if (lane.hero) { lane.root.remove(lane.hero.root); lane.hero.dispose() }
  lane.anim?.dispose()
  lane.hero = hero
  lane.root.add(hero.root)
  lane.solver = new PoseSolver(hero.rig, 0.4)
  const anim = new Performer(hero)
  lane.anim = anim
  layoutStage()
  resize()
  void loadAllClips(anim, animUrl).then(() => {
    if (token !== lane.loading) { anim.dispose(); return }
    if (game.state.phase === 'menu') idleDance()
  })
}

/** Lay the visible heroes out across the stage, evenly, facing front. */
function layoutStage() {
  const portrait = app.clientHeight > app.clientWidth
  const gap = playerCount === 1 ? 0 : portrait ? 0.55 : 1.05
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const x = (i - (playerCount - 1) / 2) * gap
    lanes[i].root.position.set(x, 0, 0)
    // A touch of inward turn so three heroes read as a group on a stage.
    lanes[i].root.rotation.y = playerCount > 1 ? -x * 0.1 : 0
  }
}

/**
 * Get the camera going and say so in the menu if it will not.
 *
 * Separate from starting a round because the menu preview needs it *before*
 * anyone presses start: a lane game where you find out a lane is empty once the
 * music is running has already wasted the song.
 */
async function ensureCamera(): Promise<boolean> {
  if (tracker.state === 'ready') return true
  camHint.textContent = 'Getting the camera ready…'
  await startLoadingTracker()
  const state = await tracker.start()
  const embedded = window.self !== window.top
  camHint.textContent =
    state === 'ready' ? ''
    : state === 'denied' && embedded
      ? 'This preview cannot reach the camera. Open the downloaded file to play.'
    : state === 'denied' ? `${tracker.error} — allow the camera and press start again.`
    : 'No camera available on this device.'
  return state === 'ready'
}

async function beginRun(seed?: number) {
  audio.resume()
  if (!(await ensureCamera())) return
  for (let i = 0; i < playerCount; i++) lanes[i].anim?.stop()
  hud.resetStrip()
  hud.sizeCamera(playerCount)
  lastBeat = Number.NEGATIVE_INFINITY
  game.start(clock, picks.slice(0, playerCount), lengthId, seed)
}

function resize() {
  const w = app.clientWidth, h = app.clientHeight
  renderer.setSize(w, h, false)
  const heroes = lanes.slice(0, playerCount).map((l) => l.hero).filter(Boolean) as Hero[]
  if (!heroes.length) return
  layoutStage()
  const card = document.querySelector('.layer.sheet:not([hidden]) .card')
  const headroom = card ? card.getBoundingClientRect().top : h * 0.45
  const widest = Math.max(...heroes.map((x) => x.width))
  const spread = playerCount > 1
    ? Math.abs(lanes[playerCount - 1].root.position.x - lanes[0].root.position.x)
    : 0
  // Portrait counts only part of the widest hero's arm span. A T-pose is
  // wider than a phone can show three of, and framing for every fingertip
  // renders three thumbnails in the middle of an empty screen — so the
  // outermost hands are allowed off the edge instead.
  const portrait = h > w
  play.frame({
    heroHeight: Math.max(...heroes.map((x) => x.height)),
    spanX: spread + widest * (portrait && playerCount > 1 ? 0.6 : 1),
    spanZ: widest * 0.5,
    aspect: w / h, portrait, headroom, viewportH: h, viewportW: w,
  })
}
addEventListener('resize', resize)
function reframe() { requestAnimationFrame(() => requestAnimationFrame(resize)) }

/** Project a hero's head to screen space so its score plate can sit over it. */
const plateAt = new THREE.Vector3()
function placePlates() {
  const w = app.clientWidth, h = app.clientHeight
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const lane = lanes[i]
    if (i >= playerCount || !lane.hero) { hud.place(i, 0, 0, false); continue }
    plateAt.set(0, lane.hero.height * 1.08, 0)
      .applyMatrix4(lane.root.matrixWorld).project(play.camera)
    hud.place(i, (plateAt.x * 0.5 + 0.5) * w, (-plateAt.y * 0.5 + 0.5) * h, plateAt.z <= 1)
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now()
let bob = 0
let timeScale = 1
let clock = 0
/**
 * Longest frame the game clock still counts in full.
 *
 * Past this a frame is treated as a stall — a backgrounded tab, a device
 * asleep — and the routine waits rather than jumping. Two seconds is right for
 * a player; a recording rendering three avatars in software can legitimately
 * take longer than that per frame and needs the clock to keep counting, or it
 * drifts away from the camera feed it is dancing with.
 */
let stallClamp = 2
let lastBeat = Number.NEGATIVE_INFINITY
let liveLanes: Array<Skeleton | null> = [null, null, null]

/** Rolling frame cost, and whether the expensive things have been given up. */
let slowFrames = 0
let degraded = LITE
function watchFrameCost(elapsed: number) {
  if (degraded) return
  // A frame slower than a third of a beat is one the routine can feel.
  slowFrames = elapsed > 0.2 ? slowFrames + 1 : Math.max(0, slowFrames - 1)
  if (slowFrames < 20) return
  degraded = true
  renderer.shadowMap.enabled = false
  renderer.setPixelRatio(1)
  scene.traverse((o) => { (o as THREE.Mesh).castShadow = false })
  resize()
}

renderer.setAnimationLoop(() => {
  const now = performance.now()
  const elapsed = (now - last) / 1000
  last = now
  watchFrameCost(elapsed)
  // Two clocks on purpose. Animation dt is clamped hard so a stalled frame
  // cannot fling the rig; the game clock decides *when*, so it tracks wall time
  // and is only clamped against a genuine stall like a backgrounded tab. The
  // old half-second clamp quietly ran the routine slow on any device whose
  // frames took longer than that — which is every device once the music, the
  // three heroes and three lanes of pose tracking are all running.
  const dt = Math.min(0.1, elapsed) * timeScale
  clock += Math.min(stallClamp, elapsed) * timeScale

  const s = game.state
  const running = s.phase === 'dancing' || s.phase === 'countdown'
  if (running || s.phase === 'menu') {
    void tracker.updateLanes(now, playerCount)
    liveLanes = tracker.state === 'ready'
      ? tracker.lanes.slice(0, playerCount)
      : [null, null, null]
  }
  game.update(clock, liveLanes)

  const beat = running ? s.beatPhase : (clock / game.beatSeconds) % 1

  for (let i = 0; i < MAX_PLAYERS; i++) {
    const lane = lanes[i]
    if (!lane.hero) continue
    lane.anim?.update(dt)
    // Each hero mirrors its own player and nothing else. A clip owns the rig
    // while it runs, so the two never fight over the same bones.
    const sk = i < playerCount ? liveLanes[i] : null
    if (sk && lane.solver && !lane.anim?.active && s.phase !== 'menu') {
      lane.solver.apply(sk, dt)
    }
    lane.hero.root.position.y = lane.anim?.active ? 0 : bob
    lane.hero.vrm.update(dt)
  }
  bob = damp(bob, Math.abs(Math.sin(beat * Math.PI)) * 0.03, 10, dt)

  if (running) {
    const whole = Math.floor(s.beat)
    if (whole !== lastBeat) {
      lastBeat = whole
      if (s.phase === 'dancing') audio.danceBeat(whole)
      else audio.countIn(Math.max(0, -whole))
    }
  }
  if (s.phase === 'countdown') hud.setCountdown(Math.ceil(-s.songTime / game.beatSeconds))

  play.setAirborne(lanes.some((l) => l.anim?.airborne))
  hud.update(s)
  if (s.phase !== 'menu' && s.phase !== 'results') {
    hud.drawCamera(tracker.video, liveLanes, playerCount, tracker.laneAspect)
  } else if (s.phase === 'menu' && tracker.state === 'ready') {
    drawMenuCamera()
  }

  stage.update(dt, beat)
  play.update(dt, beat)
  renderer.render(scene, play.camera)
  if (!hud.platesLayer.hidden) placePlates()
  ;(window as { __frames?: number }).__frames = ((window as { __frames?: number }).__frames ?? 0) + 1
})

/**
 * The menu preview. Its whole job is to answer "does it see all of us yet",
 * which is the question a lane game gets asked before every single round.
 */
/** Wall-clock ms each lane was last confidently occupied; see below. */
const menuSeenAt = [0, 0, 0]
function drawMenuCamera() {
  const g = menuCam.getContext('2d')
  if (!g || tracker.video.readyState < 2) return
  const now = performance.now()
  const w = menuCam.width, h = menuCam.height
  const n = playerCount
  g.save(); g.translate(w, 0); g.scale(-1, 1)
  g.drawImage(tracker.video, 0, 0, w, h)
  g.restore()
  for (let i = 0; i < n; i++) {
    const x0 = (i / n) * w, lw = w / n
    const sk = liveLanes[i]
    // One lane is inferred per frame, so at three players a lane's answer is a
    // second old by the time the next one arrives. Without a grace period the
    // three boxes take turns flashing red, which reads as the game losing
    // people it can see perfectly well.
    if (sk && sk.leftShoulder.score > 0.3 && sk.rightHip.score > 0.3) menuSeenAt[i] = now
    const ok = now - menuSeenAt[i] < 2000
    g.strokeStyle = ok ? '#3ddc97' : 'rgba(255,77,141,.9)'
    g.lineWidth = 3
    g.strokeRect(x0 + 2, 2, lw - 4, h - 4)
    g.fillStyle = ok ? '#3ddc97' : 'rgba(255,77,141,.95)'
    g.font = 'bold 12px system-ui'
    g.textAlign = 'center'
    g.fillText(ok ? `P${i + 1} ✓` : `P${i + 1} — step in`, x0 + lw / 2, h - 8)
  }
  camHint.textContent = ''
  camWrap.classList.remove('off')
}

// ---------------------------------------------------------------- model
let announceModelBlock: (() => void) | null = null
const modelBlockReady = new Promise<void>((resolve) => { announceModelBlock = resolve })
;(window as unknown as Record<string, unknown>).__hmPoseModel = () => {
  announceModelBlock?.(); announceModelBlock = null
}

async function loadPoseModelSpec() {
  if (STREAMED) await modelBlockReady
  const node = document.getElementById('pose-model')
  if (node?.textContent) {
    const spec = JSON.parse(node.textContent)
    node.remove()
    return spec
  }
  const res = await fetch(new URL('pose-model.json', location.href))
  if (!res.ok) throw new Error(`pose model unavailable (${res.status})`)
  return res.json()
}

let trackerReady: Promise<void> | null = null
function startLoadingTracker() {
  trackerReady ??= loadPoseModelSpec().then((spec) => tracker.loadModel(spec))
  return trackerReady
}

// ---------------------------------------------------------------- boot
;(async () => {
  try {
    boot.step('Waking up the stage…')
    await firstHeroReady
    picks[0] = 0
    picks[1] = Math.min(1, ROSTER.length - 1)
    picks[2] = Math.min(2, ROSTER.length - 1)
    await loadLane(0, picks[0])
    renderMenu()
    applyCount()
    startLoadingTracker().catch((err) => boot.fail((err as Error).message))
    play.setPresentation(true)
    resize()
    reframe()
    idleDance()
    boot.done()
    ;(window as { __ready?: unknown }).__ready = true
  } catch (err) {
    const message = (err as Error).message
    boot.fail(message)
    ;(window as { __ready?: unknown }).__ready = `error:${message}`
  }
})()

;(window as unknown as Record<string, unknown>).__api = {
  start: (seed?: number) => beginRun(seed),
  setPlayers: (n: number) => { playerCount = n; applyCount(); renderMenu() },
  setLength: (id: LengthId) => { lengthId = id; renderMenu() },
  pick: (lane: number, hero: number) => { picks[lane] = hero; void loadLane(lane, hero); renderMenu() },
  pause: () => game.pause(clock),
  resume: () => game.resume(clock),
  finish: () => game.finish(),
  menu: () => showMenu(),
  state: () => game.state,
  phase: () => game.state.phase,
  players: () => game.state.players.map((p) => ({ lane: p.lane, score: p.score, seen: p.seen })),
  setClamp: (s: number) => { stallClamp = s },
  setTimeScale: (n: number) => {
    timeScale = n
    document.documentElement.style.setProperty('--time-scale', String(n))
  },
  tracker: () => ({ state: tracker.state, fps: tracker.fps, ms: tracker.lastInferenceMs }),
  quality: () => ({ degraded, lite: LITE }),
  /** The exact 192x192 picture a lane is judged from, for the crop harness. */
  laneCrop: (lane: number) => tracker.laneCrop(lane, playerCount),
  /** That picture plus the skeleton read out of it, so the two can be compared. */
  laneDebug: (lane: number) => ({
    crop: tracker.laneCrop(lane, playerCount),
    aspect: tracker.laneAspect,
    label: classify(tracker.lanes[lane]).pose?.id ?? null,
    distance: +classify(tracker.lanes[lane]).distance.toFixed(3),
    points: Object.entries(tracker.lanes[lane]).map(([name, k]) =>
      ({ name, x: +k.x.toFixed(3), y: +k.y.toFixed(3), s: +k.score.toFixed(2) })),
  }),
  /** The routine a given length and seed produces, for the lane gate. */
  routine: (length: LengthId, seed: number) => {
    const song = makeRoutine(LENGTHS.find((l) => l.id === length)?.moves ?? 16, seed)
    return {
      bpm: song.bpm, leadInBeats: song.leadInBeats, totalBeats: song.totalBeats,
      slots: song.slots.map((s) => ({ id: s.move.id, startBeat: s.startBeat, beats: s.beats })),
    }
  },
  /** Hero measurements and the solved camera, for the framing harnesses. */
  debugFraming: () => ({
    heroes: lanes.slice(0, playerCount).map((l) => l.hero && {
      h: +l.hero.height.toFixed(2), w: +l.hero.width.toFixed(2),
    }),
    camera: { z: +play.camera.position.z.toFixed(2), fov: play.camera.fov },
  }),
  /**
   * What each lane is currently doing, as a vocabulary label. A recording uses
   * it to line the game's clock up with a pre-rendered camera feed: the feed
   * opens on a marker pose, and the round is started the frame it appears.
   */
  laneLabels: () => liveLanes.map((sk, i) => {
    const c = sk ? classify(sk) : null
    return {
      pose: c?.pose?.id ?? null,
      distance: c ? +c.distance.toFixed(3) : null,
      margin: c ? +c.margin.toFixed(3) : null,
      runnerUp: c?.runnerUp?.id ?? null,
      conf: sk ? +bodyConfidence(sk).toFixed(2) : null,
      wrists: sk ? [+sk.leftWrist.score.toFixed(2), +sk.rightWrist.score.toFixed(2)] : null,
      at: tracker.laneAt[i],
    }
  }),
  ready: () => tracker.state,
  wake: () => ensureCamera(),
  /** Milliseconds of camera playback, for lining a recording up with a feed. */
  camClock: () => performance.now() - tracker.streamStartedAt,
  /** Have the clips finished loading on every visible lane? */
  clipsReady: () => lanes.slice(0, playerCount).every((l) => !!l.anim?.has('backflip')),
  /** Play one clip on one lane, for the clip-framing gate. */
  perform: (clip: string, lane = 0) => lanes[lane]?.anim?.play(clip),
  /**
   * Harness hook: put a screen up without a camera.
   *
   * The contrast and fit checks care about what the DOM looks like, not about
   * whether anyone is dancing, and making them each stand up a fake webcam
   * would mean the screens nobody can reach without one never get audited.
   */
  stage: (phase: PartyPhase) => {
    for (let i = 0; i < playerCount; i++) lanes[i].anim?.stop()
    hud.resetStrip(); hud.sizeCamera(playerCount)
    lastBeat = Number.NEGATIVE_INFINITY
    game.start(clock, picks.slice(0, playerCount), lengthId, 4242)
    if (phase === 'paused') game.pause(clock)
    if (phase === 'results') game.finish()
  },
  summary: () => game.ranking.map((p) => ({
    lane: p.lane + 1,
    hero: ROSTER[p.heroIndex]?.name ?? '?',
    score: Math.round(p.score),
    accuracy: +(game.accuracy(p) * 100).toFixed(1),
    bestCombo: p.bestCombo,
    grades: p.results.map((r) => r.grade),
  })),
}
