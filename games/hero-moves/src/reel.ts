import * as THREE from 'three'
import './ui/style.css'
import './ui/reel.css'
import { Stage } from './stage/stage'
import { PlayCamera } from './stage/camera'
import { loadHero, type Hero } from './avatar/loader'
import { Performer, loadAllClips, CLIPS } from './anim/performer'
import { Audio } from './core/audio'
import { el } from './ui/dom'
import { damp } from './core/math'

/**
 * Hero Stunt Reel — a prototype of the direction the research points at.
 *
 * The evidence says the pleasure people pay for is watching a character they
 * own perform, not being tracked by a webcam: the shipping "webcam drives your
 * avatar" product peaks at a thousand concurrent users and is declining, while
 * customise-and-perform peaks near a hundred thousand, and the largest
 * camera-free precedent for this exact asset — a child's drawing, animated —
 * took 6.7 million uploads on four clips and no game at all.
 *
 * So: no camera, no tracker, no permission prompt. Choose clips, arrange them,
 * watch your hero perform the routine.
 *
 * The one thing that stops this being a five-minute toy is combinatorial
 * discovery, which is why Incredibox — the closest precedent, and a *paid* app
 * with a million downloads — has depth that a sequencer alone would not.
 * Certain orderings are combos. Finding one is the reason to come back.
 */

const avatarFiles = import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>
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

const ROSTER = [
  { id: 'Crayon_Kid', name: 'Crayon Kid' },
  { id: 'Yummy_Bear', name: 'Yummy Bear' },
  { id: 'Superstar', name: 'Superstar' },
  { id: 'Gingerella', name: 'Gingerella' },
  { id: 'Skelly', name: 'Skelly' },
  { id: 'Cloudy', name: 'Cloudy' },
].filter((r) => Object.keys(avatarFiles).some((k) => k.includes(`${r.id}.opt`)))

/** The deck. Each card is one clip the hero can be asked to perform. */
const DECK = CLIPS.map((c) => ({
  id: c.id,
  label: { dance: 'Dance', backflip: 'Backflip', punch: 'Punch', jump: 'Jump' }[c.id] ?? c.id,
  icon: { dance: '💃', backflip: '🤸', punch: '🥊', jump: '⬆️' }[c.id] ?? '★',
  credit: c.credit,
}))

/**
 * Combos. An ordered run of clips that means more than its parts.
 *
 * This is the whole retention mechanic in four lines, and it is deliberately
 * discoverable rather than explained: the reward for arranging jump into
 * backflip is that the game tells you it was a stunt.
 */
const COMBOS: Array<{ seq: string[]; name: string }> = [
  { seq: ['jump', 'backflip'], name: 'STUNT!' },
  { seq: ['punch', 'punch'], name: 'COMBO!' },
  { seq: ['backflip', 'backflip'], name: 'DOUBLE!' },
  { seq: ['punch', 'jump', 'backflip'], name: 'FINISHER!' },
  { seq: ['dance', 'dance'], name: 'ENCORE!' },
]

/**
 * Which combos have been found.
 *
 * Persisted, because discovery is the entire reason to open this again
 * tomorrow and a collection that resets on reload is not a collection. Every
 * read and write is guarded: storage throws outright in a private window, in a
 * thumbnailer, and in any browser set to block site data, and none of those
 * should cost the player the game.
 */
const STORE_KEY = 'heromaker.reel.combos.v1'

function loadFound(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    // Only names still in the table survive, so renaming a combo cannot leave
    // a phantom in somebody's count.
    return new Set(Array.isArray(parsed)
      ? parsed.filter((n): n is string => typeof n === 'string' && COMBOS.some((c) => c.name === n))
      : [])
  } catch { return new Set() }
}

function saveFound() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify([...found])) } catch { /* fine */ }
}

const found = loadFound()

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
const audio = new Audio()

const root = new THREE.Group()
scene.add(root)
let hero: Hero | null = null
let anim: Performer | null = null
let heroIndex = 0

// ---------------------------------------------------------------- ui
const routine: string[] = []
const MAX = 6

const heroRow = el('div', { class: 'reel-heroes' })
const deckRow = el('div', { class: 'reel-deck' })
const slotRow = el('div', { class: 'reel-slots' })
const banner = el('div', { class: 'reel-banner' })
const status = el('div', { class: 'reel-status' }, 'Tap moves to build a routine')
const playBtn = el('button', { class: 'btn', onclick: () => performRoutine() }, 'PLAY THE REEL')
const clearBtn = el('button', { class: 'btn secondary', onclick: () => { routine.length = 0; render() } }, 'CLEAR')

const panel = el('div', { class: 'reel-panel' },
  heroRow,
  el('div', { class: 'reel-label' }, 'Your routine'),
  slotRow,
  el('div', { class: 'reel-label' }, 'Moves'),
  deckRow,
  el('div', { class: 'actions row' }, playBtn, clearBtn),
  status,
)
app.append(el('div', { class: 'layer', id: 'reelUi' }, banner, panel))

function render() {
  heroRow.replaceChildren(...ROSTER.map((r, i) => {
    const thumb = Object.entries(thumbFiles).find(([k]) => k.includes(`${r.id}.thumb`))?.[1]
    const b = el('button', {
      class: `reel-hero${i === heroIndex ? ' on' : ''}`,
      onclick: () => selectHero(i),
      title: r.name,
    })
    if (thumb) b.append(el('img', { src: thumb, alt: r.name, width: 40, height: 40 }))
    return b
  }))

  slotRow.replaceChildren(...Array.from({ length: MAX }, (_, i) => {
    const id = routine[i]
    const card = DECK.find((d) => d.id === id)
    return el('button', {
      class: `reel-slot${card ? ' filled' : ''}`,
      onclick: () => { if (card) { routine.splice(i, 1); render() } },
      title: card ? `Remove ${card.label}` : 'Empty',
    }, card ? el('span', { class: 'ico' }, card.icon) : el('span', { class: 'ico dim' }, `${i + 1}`))
  }))

  deckRow.replaceChildren(...DECK.map((d) =>
    el('button', {
      class: 'reel-card',
      onclick: () => { if (routine.length < MAX) { routine.push(d.id); audio.uiClick(); render() } },
    }, el('span', { class: 'ico' }, d.icon), el('span', {}, d.label))))

  playBtn.disabled = routine.length === 0 || playing
  const hit = combosIn(routine)
  status.textContent = routine.length === 0
    ? 'Tap moves to build a routine'
    : hit.length
      ? `${hit.map((c) => c.name).join(' ')}  ·  ${found.size}/${COMBOS.length} combos found`
      : found.size === COMBOS.length
        ? `${routine.length}/${MAX} moves  ·  all ${COMBOS.length} combos found`
        : `${routine.length}/${MAX} moves  ·  ${found.size}/${COMBOS.length} combos found`
}

/** Every combo whose sequence appears in order inside the routine. */
function combosIn(seq: string[]) {
  return COMBOS.filter((c) =>
    seq.some((_, i) => c.seq.every((id, k) => seq[i + k] === id)))
}

async function selectHero(i: number) {
  heroIndex = i
  render()
  const entry = ROSTER[i]
  const url = Object.entries(avatarFiles).find(([k]) => k.includes(`${entry.id}.opt`))?.[1]
  if (!url) return
  if (hero) { root.remove(hero.root); hero.dispose() }
  anim?.dispose()
  hero = await loadHero(url)
  root.add(hero.root)
  anim = new Performer(hero)
  resize()
  const mine = hero
  await loadAllClips(anim, animUrl)
  if (hero === mine && !playing) anim.play('dance', { loop: true })
}

// ---------------------------------------------------------------- playback
let playing = false
let queue: string[] = []

async function performRoutine() {
  if (playing || !anim || routine.length === 0) return
  audio.resume()
  playing = true
  render()
  queue = [...routine]
  // Announce a combo as it is completed, not at the end — the feedback has to
  // land on the move that earned it.
  next()
}

function next() {
  if (!anim) return
  const id = queue.shift()
  if (!id) {
    playing = false
    anim.play('dance', { loop: true })
    render()
    return
  }
  anim.play(id)
  audio.pose()
  // Check whether this clip completed a combo, counting what has played so far.
  const played = routine.slice(0, routine.length - queue.length)
  const justHit = COMBOS.find((c) =>
    c.seq.length <= played.length &&
    c.seq.every((s, k) => played[played.length - c.seq.length + k] === s))
  if (justHit) {
    // Bank it here, not at the end of the routine: the counter has to move on
    // the move that earned it, or finding a combo does not feel like finding.
    const isNew = !found.has(justHit.name)
    found.add(justHit.name)
    if (isNew) saveFound()
    showBanner(isNew ? `${justHit.name} NEW!` : justHit.name)
    audio.star(found.size)
    render()
  }
}

let bannerUntil = 0
function showBanner(text: string) {
  banner.textContent = text
  banner.classList.add('show')
  bannerUntil = performance.now() + 1400
}

// ---------------------------------------------------------------- frame
function resize() {
  const w = app.clientWidth, h = app.clientHeight
  renderer.setSize(w, h, false)
  if (!hero) return
  const card = panel.getBoundingClientRect()
  play.frame({
    heroHeight: hero.height, spanX: hero.width * 1.6, spanZ: hero.width,
    aspect: w / h, portrait: h > w,
    headroom: card.top, viewportH: h, viewportW: w,
  })
}
addEventListener('resize', resize)

let last = performance.now()
let bob = 0
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now

  anim?.update(dt)
  // A one-shot that has finished hands the rig back; that is the cue to
  // advance the queue rather than a timer, so a longer clip simply takes
  // longer instead of being cut off.
  if (playing && anim && !anim.active) next()

  if (hero) {
    hero.root.position.y = anim?.active ? 0 : bob
    hero.vrm.update(dt)
  }
  bob = damp(bob, 0.02, 6, dt)
  play.setAirborne(!!anim?.active)
  if (bannerUntil && now > bannerUntil) { banner.classList.remove('show'); bannerUntil = 0 }

  stage.update(dt, (now / 600) % 1)
  play.update(dt, (now / 600) % 1)
  renderer.render(scene, play.camera)
})

// ---------------------------------------------------------------- boot
;(async () => {
  await selectHero(0)
  render()
  // Frame first, then declare the card: setPresentation reads the last framing
  // to decide whether there is anywhere sideways to go, and with none recorded
  // it assumes landscape and shunts the hero off to one side.
  resize()
  play.setPresentation(true)
  resize()
  requestAnimationFrame(() => requestAnimationFrame(resize))
  ;(window as { __ready?: unknown }).__ready = true
})()

;(window as unknown as Record<string, unknown>).__reel = {
  add: (id: string) => { routine.push(id); render() },
  play: () => performRoutine(),
  pick: (i: number) => selectHero(i),
  routine: () => [...routine],
  playing: () => playing,
}
