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
import { OWN_HERO, OWN_NAME, goBack, BACK_ICON } from './ownhero'

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
 * So: no camera, no tracker, no permission prompt. Tap a move, and your hero
 * does it on the spot.
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

// `?vrm=<url>` plays ONE hero the player made, instead of the built-in roster:
// the HeroMaker app opens this page from a hero's Play button. See ownhero.ts.

const BUILT_IN = [
  { id: 'Crayon_Kid', name: 'Crayon Kid' },
  { id: 'Yummy_Bear', name: 'Yummy Bear' },
  { id: 'Superstar', name: 'Superstar' },
  { id: 'Gingerella', name: 'Gingerella' },
  { id: 'Skelly', name: 'Skelly' },
  { id: 'Cloudy', name: 'Cloudy' },
].filter((r) => Object.keys(avatarFiles).some((k) => k.includes(`${r.id}.opt`)))

const ROSTER = OWN_HERO ? [{ id: 'own', name: OWN_NAME }] : BUILT_IN

/** The deck. Each card is one clip the hero can be asked to perform. */
const DECK = CLIPS.map((c) => ({
  id: c.id,
  label: {
    dance: 'Dance', bodyroll: 'Body Roll', backflip: 'Backflip', punch: 'Punch',
    jump: 'Jump', land: 'Landing', fly: 'Fly', victory: 'Victory',
  }[c.id] ?? c.id,
  icon: {
    dance: '💃', bodyroll: '🕺', backflip: '🤸', punch: '🥊',
    jump: '⬆️', land: '💥', fly: '🦸', victory: '🏆',
  }[c.id] ?? '★',
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
  { seq: ['fly', 'land'], name: 'SUPERHERO LANDING!' },
  { seq: ['punch', 'punch', 'victory'], name: 'KNOCKOUT!' },
  { seq: ['backflip', 'backflip'], name: 'DOUBLE!' },
  { seq: ['dance', 'bodyroll'], name: 'DANCE BATTLE!' },
  { seq: ['jump', 'fly'], name: 'TAKE OFF!' },
  { seq: ['land', 'punch', 'victory'], name: 'FINISHER!' },
  { seq: ['bodyroll', 'bodyroll'], name: 'ENCORE!' },
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
// ?lite=1 is the cheap path for weak GPUs - and for a software-rendered
// recording, where every frame costs CPU and the clamped time step below would
// otherwise turn a backflip into slow motion.
const LITE = new URLSearchParams(location.search).get('lite') === '1'
const renderer = new THREE.WebGLRenderer({ antialias: !LITE, powerPreference: 'high-performance' })
renderer.setPixelRatio(LITE ? 0.8 : Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = !LITE
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const stage = new Stage(undefined, LITE ? 'lite' : 'full')
scene.add(stage.group)
const play = new PlayCamera()
const audio = new Audio()

const root = new THREE.Group()
scene.add(root)
let hero: Hero | null = null
let anim: Performer | null = null
let heroIndex = 0

// ---------------------------------------------------------------- ui
// Tap a move and the hero does it, now. No queue, no play button: the last
// three taps are still read for combos, so ordering moves is something to
// discover rather than a form to fill in.
const recent: string[] = []
let playingId: string | null = null

const heroRow = el('div', { class: 'reel-heroes' })
const deckRow = el('div', { class: 'reel-deck' })
const banner = el('div', { class: 'reel-banner' })
const combos = el('div', { class: 'reel-combos', title: 'Combos found' })
const back = el('button', { class: 'reel-nav', title: 'Back', onclick: goBack })
back.setAttribute('aria-label', 'Back')
back.innerHTML = BACK_ICON

const top = el('div', { class: 'reel-top' },
  OWN_HERO ? back : el('span', { class: 'reel-nav-spacer' }),
  el('div', { class: 'reel-title' }, OWN_HERO ? OWN_NAME : 'Hero Moves'),
  combos,
)
const panel = el('div', { class: 'reel-panel' }, ...(OWN_HERO ? [] : [heroRow]), deckRow)
app.append(el('div', { class: 'layer', id: 'reelUi' }, top, banner, panel))

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

  deckRow.replaceChildren(...DECK.map((d) => {
    const b = el('button', {
      class: `reel-card${d.id === playingId ? ' on' : ''}`,
      onclick: () => perform(d.id),
    }, el('span', { class: 'ico' }, d.icon), el('span', { class: 'lbl' }, d.label))
    b.dataset.move = d.id
    return b
  }))

  combos.textContent = `★ ${found.size}/${COMBOS.length}`
}

async function selectHero(i: number) {
  heroIndex = i
  render()
  const entry = ROSTER[i]
  const url = OWN_HERO ?? Object.entries(avatarFiles).find(([k]) => k.includes(`${entry.id}.opt`))?.[1]
  if (!url) return
  if (hero) { root.remove(hero.root); hero.dispose() }
  anim?.dispose()
  playingId = null
  hero = await loadHero(url)
  root.add(hero.root)
  anim = new Performer(hero)
  resize()
  const mine = hero
  await loadAllClips(anim, animUrl)
  if (hero === mine && !playingId) anim.play('dance', { loop: true })
}

// ---------------------------------------------------------------- playback
/** Play one move right away, cutting off whatever was playing. */
function perform(id: string) {
  if (!anim || !anim.has(id)) return
  audio.resume()
  // Tapping the move that is already playing starts it again.
  if (anim.playing === id) anim.stop(0.1)
  anim.play(id)
  playingId = id
  audio.pose()
  recent.push(id)
  if (recent.length > 3) recent.shift()
  // A combo is banked on the move that completes it, so finding one feels
  // like finding it.
  const justHit = COMBOS.find((c) =>
    c.seq.length <= recent.length &&
    c.seq.every((s, k) => recent[recent.length - c.seq.length + k] === s))
  if (justHit) {
    const isNew = !found.has(justHit.name)
    found.add(justHit.name)
    if (isNew) saveFound()
    showBanner(isNew ? `${justHit.name} NEW!` : justHit.name)
    audio.star(found.size)
    recent.length = 0
  }
  render()
}

let bannerUntil = 0
function showBanner(text: string) {
  banner.textContent = text
  banner.classList.add('show')
  top.classList.add('combo')
  bannerUntil = performance.now() + 1400
}

// ---------------------------------------------------------------- frame
function resize() {
  const w = app.clientWidth, h = app.clientHeight
  renderer.setSize(w, h, false)
  if (!hero) return
  const card = panel.getBoundingClientRect()
  // The hero owns the stage between the header and the moves bar, on every
  // orientation, and is centred in it.
  const band = { top: top.getBoundingClientRect().bottom, bottom: card.top }
  const portrait = h > w
  play.frame({
    // A phone held upright is narrow: frame the hero's body rather than the
    // full T-pose arm span (as wide as the hero is tall, on a real one), or a
    // tall frame holds a small hero. A fingertip may leave the frame in an
    // outstretched move; the body never does.
    heroHeight: hero.height, spanX: hero.width * (portrait ? 0.8 : 1.15),
    // One hero, and this camera never orbits: no depth to allow for.
    spanZ: 0,
    aspect: w / h, portrait,
    headroom: card.top, viewportH: h, viewportW: w, band,
  })
}
addEventListener('resize', resize)

let last = performance.now()
let bob = 0
let fps = 0
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const raw = (now - last) / 1000
  // Lite also lets a slow frame advance time in full, so motion keeps its real
  // pace at a low frame rate instead of stretching into slow motion.
  const dt = Math.min(LITE ? 0.3 : 0.1, raw)
  last = now
  fps = fps * 0.9 + (raw > 0 ? 1 / raw : 0) * 0.1

  anim?.update(dt)
  // A move that has finished hands the rig back; the hero goes back to
  // dancing until the next tap.
  if (playingId && anim && !anim.active) {
    playingId = null
    anim.play('dance', { loop: true })
    render()
  }

  if (hero) {
    hero.root.position.y = anim?.active ? 0 : bob
    hero.vrm.update(dt)
  }
  bob = damp(bob, 0.02, 6, dt)
  // Only a clip that leaves the floor pulls the camera back; the idle dance
  // loop is always "active" and would otherwise shrink the hero for good.
  play.setAirborne(!!anim?.airborne)
  if (bannerUntil && now > bannerUntil) {
    banner.classList.remove('show'); top.classList.remove('combo'); bannerUntil = 0
  }

  stage.update(dt, (now / 600) % 1)
  play.update(dt, (now / 600) % 1)
  renderer.render(scene, play.camera)
})

// ---------------------------------------------------------------- boot
;(async () => {
  await selectHero(0)
  render()
  // Frame first, then declare the card: setPresentation re-solves the last
  // framing, and that framing carries the band the hero is centred in.
  resize()
  play.setPresentation(true)
  resize()
  requestAnimationFrame(() => requestAnimationFrame(resize))
  ;(window as { __ready?: unknown }).__ready = true
})()

;(window as unknown as Record<string, unknown>).__reel = {
  tap: (id: string) => perform(id),
  pick: (i: number) => selectHero(i),
  playing: () => playingId,
  hero: () => ROSTER[heroIndex]?.name,
  fps: () => Math.round(fps),
}
