import * as THREE from 'three'
import './ui/style.css'
import { Game, type Phase, type Stats } from './game/game'
import { Input } from './core/input'
import { Audio } from './core/audio'
import { loadHero, type Hero } from './avatar/loader'
import { ROSTER, avatarReady, avatarSource, thumbUrl } from './game/roster'
import { HallOfFame, type Entry } from './game/hallOfFame'
import { el, fmt } from './ui/dom'
import { CFG } from './game/config'
import { HeroCamControl } from './game/heroCamControl'

/**
 * Captured before anything mutates the page, so publishing the shared board
 * republishes the real source rather than a serialized live DOM.
 */
const PRISTINE_HTML = '<!doctype html>\n' + document.documentElement.outerHTML

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.06
app.appendChild(renderer.domElement)

const audio = new Audio()
const input = new Input(renderer.domElement)
const hall = new HallOfFame()

/** Storage can throw outright in private/embedded contexts, not just return null. */
function readStored(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}
function writeStored(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* nothing to do about it */ }
}

let playerName = readStored('heroDash.name')
let selected = 0
let heroCache = new Map<string, Hero>()

// ---------------------------------------------------------------- UI layers
const layer = (id: string, sheet = true) =>
  el('div', { class: `layer${sheet ? ' sheet' : ''}`, id, hidden: true })

const loadingLayer = layer('loading')
const menuLayer = layer('menu')
const hudLayer = layer('hud', false)
const countdownLayer = layer('countdownLayer')
const overLayer = layer('over')
for (const l of [loadingLayer, menuLayer, hudLayer, countdownLayer, overLayer]) app.appendChild(l)

// ---- Loading
const loadingLabel = el('div', { class: 'pill' }, 'Waking up your hero…')
loadingLayer.append(el('div', { class: 'spinner' }), loadingLabel)

// ---- HUD
const scoreEl = el('div', { class: 'pill', id: 'score' }, '0')
const multEl = el('div', { class: 'pill mult', id: 'mult' }, '×3 SCORE')
const heartsEl = el('div', { class: 'hearts' })
const starsEl = el('div', { class: 'pill' }, '⭐ 0')
const distEl = el('div', { class: 'pill' }, '0 m')
const comboEl = el('div', { id: 'combo' })
const toastEl = el('div', { id: 'toast' })
const powerFill = el('div', { id: 'powerFill' })
const powerLabel = el('div', { id: 'powerLabel' }, 'HERO POWER')
const powerWrap = el('div', { id: 'powerWrap' }, el('div', { id: 'powerBar' }, powerFill), powerLabel)
hudLayer.append(
  el('div', { class: 'hud-row' },
    el('div', { class: 'hud-col left' }, scoreEl, distEl, multEl),
    el('div', { class: 'hud-col right' }, el('div', { class: 'pill' }, heartsEl), starsEl),
  ),
  comboEl, toastEl, powerWrap,
  el('div', { id: 'touch' }, el('div', { class: 'hint' }, 'swipe ⟵ ⟶ ↑ ↓   ·   tap = POSE')),
)
const camHud = el('div', { id: 'camHud', hidden: true })
hudLayer.append(camHud)

// ---- Countdown
const countdownNum = el('div', { id: 'countdown' })
countdownLayer.append(countdownNum)
countdownLayer.classList.remove('sheet')

// ---------------------------------------------------------------- Menu
const pickerEl = el('div', { class: 'picker' })
const heroNameEl = el('h2', { class: 'hero-name' })
const heroBlurbEl = el('p', { class: 'blurb' })
const nameInput = el('input', {
  class: 'name-input', value: playerName, placeholder: 'Anonymous', maxLength: 14,
  // The visible label is hidden on very short screens; keep it named regardless.
  ariaLabel: 'Player name',
}) as HTMLInputElement
nameInput.addEventListener('input', () => {
  playerName = nameInput.value.trim()
  writeStored('heroDash.name', playerName)
})

const playBtn = el('button', { class: 'btn', onclick: () => beginRun() }, 'PLAY')

// ---------------------------------------------------------------- Hero Cam
// `game` is declared below; the closure is only ever called after boot.
const camControl = new HeroCamControl(() => game)
const camPanel = el('div', { id: 'camPanel', hidden: true })
const camStatus = el('div', { class: 'muted', id: 'camStatus' }, '')
const camBtn = el('button', { class: 'btn secondary', onclick: () => toggleHeroCam() }, '📸 HERO CAM')
const camRecal = el('button', { class: 'btn ghost', onclick: () => { camControl.recalibrate(); paintCam() } }, 'RE-CENTER')
camRecal.hidden = true
camPanel.append(camControl.preview, camStatus, camRecal)
camControl.preview.className = 'camPreview'

async function toggleHeroCam() {
  audio.uiClick()
  if (camOn) {
    camControl.stop()
    camOn = false
    paintCam()
    return
  }
  camStatus.textContent = 'Asking for your camera…'
  camPanel.hidden = false
  const state = await camControl.start()
  camOn = state === 'learnRoom' || state === 'measure' || state === 'ready'
  paintCam()
}

let camOn = false
let lastCamState = camControl.state
let lastCamSees = false
function paintCam() {
  const s = camControl.state
  camBtn.textContent = camOn ? '📸 HERO CAM: ON' : '📸 HERO CAM'
  camBtn.classList.toggle('ghost', camOn)
  camPanel.hidden = !camOn && s !== 'denied' && s !== 'unsupported'
  camRecal.hidden = !camOn
  camStatus.textContent =
    s === 'learnRoom' ? '1/2 · Step out of the picture for a second…'
    : s === 'measure'
      ? (camControl.seesPlayer
          ? '2/2 · Now step back in, whole body in shot, and hold still…'
          : '2/2 · Step back into the picture')
    : s === 'ready' ? 'Step left/right to steer · jump · crouch to slide · arms + legs wide to POSE'
    : s === 'denied' ? camControl.cam.error + ' — keyboard and touch still work.'
    : s === 'unsupported' ? 'No camera on this device — keyboard and touch still work.'
    : ''
  camHud.hidden = !(camOn && game.phase === 'running')
}

function renderPicker() {
  pickerEl.replaceChildren(...ROSTER.map((r, i) => {
    const thumb = thumbUrl(r.id)
    const btn = el('button', {
      class: `pick${i === selected ? ' active' : ''}${avatarReady(r) ? '' : ' pending'}`,
      onclick: () => { audio.uiClick(); selectHero(i) },
    })
    if (thumb) btn.append(el('img', { src: thumb, alt: r.name, loading: 'lazy' }))
    btn.append(el('span', {}, r.name))
    return btn
  }))
  heroNameEl.textContent = ROSTER[selected].name
  heroBlurbEl.textContent = ROSTER[selected].blurb
}

const nameField = el('label', { class: 'field' },
  el('span', {}, 'Player name'),
  nameInput,
)

menuLayer.append(
  el('div', { class: 'card' },
    el('div', { class: 'stack' },
      el('header', { class: 'titles' },
        el('h1', {}, 'HERO DASH'),
        el('p', { class: 'tag' }, 'Your drawing came to life. Now run for it.'),
      ),
      el('section', { class: 'chosen' }, heroNameEl, heroBlurbEl),
      pickerEl,
      nameField,
      el('div', { class: 'actions' }, playBtn, camBtn),
      camPanel,
      el('div', { class: 'keys' },
        el('div', { class: 'key' }, '← →', el('i', {}, 'move')),
        el('div', { class: 'key' }, '↑', el('i', {}, 'jump')),
        el('div', { class: 'key' }, '↓', el('i', {}, 'slide')),
        el('div', { class: 'key' }, 'SHIFT', el('i', {}, 'star pose')),
      ),
      el('p', { class: 'hint' },
        'Purple walls have a star-shaped hole. Strike the star pose to fly through — ',
        'gates and stars fill your Hero Power.'),
    ),
  ),
)

// ---------------------------------------------------------------- Game over
const overTitle = el('h1', {}, 'NICE RUN!')
const overStats = el('div', { class: 'stats-grid' })
const boardEl = el('div', { class: 'board' })
const boardTitle = el('h2', {}, 'HALL OF FAME')
const publishBtn = el('button', { class: 'btn secondary' }, 'POST TO SHARED BOARD')
const publishNote = el('p', { class: 'muted' },
  'Adds your run to the board everyone sees. The page reloads for anyone who has it open.')
const againBtn = el('button', { class: 'btn', onclick: () => beginRun() }, 'RUN AGAIN')
const menuBtn = el('button', { class: 'btn ghost', onclick: () => showMenu() }, 'CHANGE HERO')
overLayer.append(
  el('div', { class: 'card' },
    el('div', { class: 'stack' },
      el('header', { class: 'titles' }, overTitle),
      overStats,
      el('section', { class: 'stack tight' }, boardTitle, boardEl),
      el('div', { class: 'actions' }, againBtn, menuBtn, publishBtn),
      publishNote,
    ),
  ),
)

function renderBoard(highlight?: Entry) {
  const { list, source } = hall.best()
  boardTitle.textContent = source === 'shared' ? 'HALL OF FAME' : 'YOUR BEST RUNS'
  if (!list.length) {
    boardEl.replaceChildren(el('p', { class: 'muted' }, 'No runs yet. Be the first.'))
    return
  }
  boardEl.replaceChildren(...list.map((e, i) =>
    el('div', { class: `row${highlight && e.at === highlight.at ? ' you' : ''}` },
      el('div', { class: 'rank' }, `${i + 1}`),
      el('div', { class: 'who' }, `${e.who || 'Anonymous'} · ${e.hero}`),
      el('div', {}, fmt(e.score)),
    )))
}

// ---------------------------------------------------------------- Flow
const game = new Game(renderer, input, audio, {
  onStats: updateHud,
  onPhase: onPhase,
  onToast: showToast,
})

function show(active: HTMLElement | null) {
  for (const l of [loadingLayer, menuLayer, hudLayer, countdownLayer, overLayer]) l.hidden = l !== active
  measureHeadroom()
}

/**
 * Tell the camera how much clear screen sits above the menu/score card, so it
 * can frame the hero in that band instead of behind the card.
 */
function measureHeadroom() {
  requestAnimationFrame(() => {
    const card = document.querySelector('.layer.sheet:not([hidden]) .card')
    const top = card ? card.getBoundingClientRect().top : app.clientHeight * 0.45
    game.setHeadroom(top, app.clientHeight)
  })
}

function showToast(text: string, kind: 'good' | 'bad') {
  toastEl.textContent = text
  toastEl.style.color = kind === 'good' ? 'var(--gold)' : 'var(--pop)'
  toastEl.classList.remove('show')
  void toastEl.offsetWidth
  toastEl.classList.add('show')
}

function updateHud(s: Stats) {
  scoreEl.textContent = fmt(s.score)
  distEl.textContent = `${fmt(s.distance)} m`
  starsEl.textContent = `⭐ ${s.stars}`
  heartsEl.replaceChildren(...Array.from({ length: CFG.hearts }, (_, i) =>
    el('span', { class: i < s.hearts ? '' : 'heart-lost' }, '❤️')))
  powerFill.style.width = `${(s.heroTime ? 1 : s.power) * 100}%`
  powerWrap.classList.toggle('ready', s.power >= 1 || s.heroTime)
  powerLabel.textContent = s.heroTime
    ? `HERO TIME — ×${s.multiplier} SCORE`
    : s.power >= 1 ? 'HERO POWER READY — FLYING NOW' : 'HERO POWER — FILL IT TO FLY'
  multEl.hidden = !s.heroTime
  multEl.textContent = `×${s.multiplier} SCORE`
  comboEl.classList.toggle('on', s.combo >= 5)
  comboEl.textContent = `×${s.combo}`
}

let lastPhase: Phase = 'menu'
function onPhase(p: Phase) {
  lastPhase = p
  if (p === 'countdown') show(countdownLayer)
  else if (p === 'running') show(hudLayer)
  else if (p === 'over') finishRun()
}

function finishRun() {
  const s = game.currentStats
  const entry: Entry = {
    who: playerName || 'Anonymous',
    hero: ROSTER[selected].name,
    score: Math.floor(s.score),
    distance: Math.floor(s.distance),
    at: Date.now(),
  }
  hall.add(entry)
  overTitle.textContent = s.distance > 900 ? 'LEGENDARY!' : s.distance > 400 ? 'GREAT RUN!' : 'NICE RUN!'
  overStats.replaceChildren(
    el('div', { class: 'stat' }, el('b', {}, fmt(s.score)), el('span', {}, 'score')),
    el('div', { class: 'stat' }, el('b', {}, `${fmt(s.distance)}m`), el('span', {}, 'distance')),
    el('div', { class: 'stat' }, el('b', {}, `${s.stars}`), el('span', {}, 'stars')),
    el('div', { class: 'stat' }, el('b', {}, `${s.gates}`), el('span', {}, 'poses nailed')),
    el('div', { class: 'stat wide' },
      el('b', {}, `${s.heroTimes}`),
      el('span', {}, s.heroTimes === 1 ? 'hero time' : 'hero times')),
  )
  renderBoard(entry)
  publishBtn.hidden = !hall.canPublish
  publishNote.hidden = !hall.canPublish
  publishBtn.disabled = false
  publishBtn.textContent = 'POST TO SHARED BOARD'
  publishBtn.onclick = async () => {
    publishBtn.disabled = true
    publishBtn.textContent = 'POSTING…'
    const res = await hall.publish(PRISTINE_HTML, entry)
    publishBtn.textContent =
      res === 'ok' ? 'POSTED!' : res === 'conflict' ? 'SOMEONE BEAT YOU TO IT' : 'NOT AVAILABLE HERE'
    if (res === 'ok') renderBoard(entry)
  }
  setTimeout(() => show(overLayer), 1400)
}

async function selectHero(i: number) {
  selected = i
  renderPicker()
  const entry = ROSTER[i]
  let hero = heroCache.get(entry.id)
  if (!hero) {
    show(loadingLayer)
    loadingLabel.textContent = `Waking up ${entry.name}…`
    hero = await loadHero(await avatarSource(entry))
    heroCache.set(entry.id, hero)
  }
  game.setHero(hero)
  if (lastPhase === 'menu') show(menuLayer)
}

function showMenu() {
  audio.uiClick()
  game.phase = 'menu'
  lastPhase = 'menu'
  show(menuLayer)
}

function beginRun() {
  audio.resume()
  audio.uiClick()
  game.start()
}

// ---------------------------------------------------------------- Loop
function resize() {
  const w = app.clientWidth, h = app.clientHeight
  game.resize(w, h)
  measureHeadroom()
}
addEventListener('resize', resize)

let last = performance.now()
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = (now - last) / 1000
  last = now
  if (camOn) {
    camControl.update()
    if (camControl.state !== lastCamState || camControl.seesPlayer !== lastCamSees) {
      lastCamState = camControl.state
      lastCamSees = camControl.seesPlayer
      paintCam()
    }
    if (camHud.hidden === (game.phase === 'running')) {
      camHud.hidden = game.phase !== 'running'
      ;(camHud.hidden ? camPanel : camHud).append(camControl.preview)
    }
  }
  game.update(dt)
  if (game.phase === 'countdown') {
    const v = game.countdownValue
    if (countdownNum.dataset.v !== String(v)) {
      countdownNum.dataset.v = String(v)
      countdownNum.replaceChildren(el('span', {}, v > 0 ? String(v) : 'GO!'))
    }
  }
  ;(window as any).__frames = ((window as any).__frames ?? 0) + 1
})

;(async () => {
  show(loadingLayer)
  resize()
  renderPicker()
  measureHeadroom()
  // Heroes stream in after the engine boots; light each one up as it lands.
  ;(window as any).__hdOnStep = () => renderPicker()
  try {
    await selectHero(0)
    show(menuLayer)
    ;(window as any).__hdSplashDone?.()
    ;(window as any).__hdReadyAt = Math.round(performance.now())
    ;(window as any).__ready = true
  } catch (err) {
    const message = 'Could not load hero: ' + (err as Error).message
    loadingLabel.textContent = message
    // Report on the splash too — it may still be covering the screen.
    ;(window as any).__hdFail?.(message)
    ;(window as any).__ready = 'error:' + (err as Error).message
  }
})()

// Debug hooks the screenshot harness drives.
;(window as any).__camDebug = () => ({ state: camControl.state, sees: camControl.seesPlayer, ...camControl.cam.reading })
;(window as any).__game = game
;(window as any).__input = input
;(window as any).__api = {
  play: () => beginRun(),
  pick: (i: number) => selectHero(i),
  act: (a: string) => input.push(a as any),
  stats: () => game.currentStats,
  debug: () => game.debugSnapshot(),
  endRun: () => game.forceGameOver(),
  setTimeScale: (n: number) => { game.timeScale = n },
  onStep: (fn: ((dt: number) => void) | null) => { game.onStep = fn },
  phase: () => game.phase,
}
