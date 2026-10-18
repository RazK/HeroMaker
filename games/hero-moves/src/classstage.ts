import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import './ui/toybox.css'
import './ui/classstage.css'
import { parseHero } from './avatar/loader'
import { preloadClip } from './anim/clips'
import { animUrl } from './anim/files'
import { CLIPS } from './anim/performer'
import { el } from './ui/dom'
import { icon, tbButton } from './ui/tb'
import { loadManifest, heroVrm, heroThumb, type ClassManifest } from './class/manifest'
import { Dancer } from './class/dancer'
import {
  tvProgram, phoneProgram, sampleTrack, showSeconds,
  type Program, type Sample, type Seg, type Arrangement,
} from './class/program'
import { buildSet, shadowTexture, SLOT, TIER_H, TB, type SetBuild } from './class/set'

/**
 * Class stage: a whole kindergarten class's heroes dancing together.
 *
 * Twelve children's heroes on one stage, in step, with a solo now and then for
 * one of them, every child's first name under their hero. Tap a hero for its
 * own page, with a link to send to grandparents.
 *
 *   ?manifest= / ?heroes=   which heroes (class/manifest.ts)
 *   ?layout=tv|phone        force a layout (default: from the screen's shape)
 *   ?hero=<creation id>     open straight on that child's hero
 *   ?record=1               no clock: a recorder drives __setTime(t) frame by frame
 *   ?outline=0              drop the drawn outline (half the skinned draws)
 *   ?stats=1                frame-rate readout
 *
 * Everything on screen is a function of the show clock (class/program.ts), so
 * a live TV and an offline video render are the same code path.
 */

const params = new URLSearchParams(location.search)
const RECORD = params.get('record') === '1'
const OUTLINE = params.get('outline') !== '0'
const STATS = params.get('stats') === '1'
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

const perf: Record<string, number> = { start: performance.now() }
const mark = (k: string) => { perf[k] = Math.round(performance.now()) }
;(window as any).__perf = perf

// ------------------------------------------------------------------ DOM

const app = document.getElementById('app')!
// A recording is stepped frame by frame: CSS transitions would run on the wrong clock.
if (RECORD) document.documentElement.classList.add('cs-record')
const stageEl = el('div', { class: 'cs-stage' })
app.append(stageEl)

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: RECORD, powerPreference: 'high-performance' })
renderer.setPixelRatio(RECORD ? 1 : Math.min(devicePixelRatio, 1.75))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
stageEl.append(renderer.domElement)

const overlay = el('div', { class: 'cs-overlay' })
const labelsEl = el('div', { class: 'cs-labels' })
const dim = el('div', { class: 'cs-dim' })
const confetti = el('canvas', { class: 'cs-confetti' })
const spotCard = el('div', { class: 'cs-spot' }, el('div', { class: 'cs-spot-eyebrow' }, 'הסולו של'), el('div', { class: 'cs-spot-name' }))
const titlePill = el('div', { class: 'cs-titlepill' })
const caption = el('div', { class: 'cs-caption' })
const tapRing = el('div', { class: 'cs-tap' })
const toast = el('div', { class: 'cs-toast', role: 'status' })
overlay.append(dim, labelsEl, confetti, titlePill, spotCard, caption, tapRing, toast)
stageEl.append(overlay)

// Solo view chrome: the app's header (back, title) and bar (helper, secondary, primary last).
const soloBack = el('button', { class: 'tb-nav cs-solo-back', title: 'חזרה לכל הגן' })
soloBack.type = 'button'
soloBack.setAttribute('aria-label', 'חזרה לכל הגן')
soloBack.innerHTML = icon('back')
const soloTitle = el('div', { class: 'cs-solo-title' })
const soloHead = el('div', { class: 'cs-solo-head' }, soloBack, soloTitle)
const moreBtn = tbButton('ריקוד נוסף', { kind: 'secondary', icon: 'redo' })
const shareBtn = tbButton('שתפו', { kind: 'primary', icon: 'share' })
const soloNote = el('div', { class: 'tb-bar-note cs-solo-note' }, 'קישור אישי לסבא ולסבתא')
const soloBar = el('div', { class: 'cs-solo-bar' }, soloNote, el('div', { class: 'tb-bar-row' }, moreBtn, shareBtn))
const soloUi = el('div', { class: 'cs-solo' }, soloHead, soloBar)
stageEl.append(soloUi)

const loading = el('div', { class: 'cs-loading', role: 'status' })
stageEl.append(loading)

const statsEl = el('div', { class: 'cs-stats' })
if (STATS) stageEl.append(statsEl)

// ------------------------------------------------------------------ scene

const scene = new THREE.Scene()
scene.background = new THREE.Color(TB.cream)
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 120)
scene.add(new THREE.HemisphereLight(0xffffff, 0xffe9c4, 0.9))
const key = new THREE.DirectionalLight(0xfff3e0, 2.0)
key.position.set(1.5, 6, 9)
scene.add(key)
const fill = new THREE.DirectionalLight(0xe9e3ff, 0.7)
fill.position.set(-5, 3, 4)
scene.add(fill)
/** The soft room reflection. Made after the heroes are in, not before: it is the costliest thing at boot. */
function makeEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.25
  pmrem.dispose()
}

// ------------------------------------------------------------------ class

interface Kid {
  name: string
  id: string
  dancer: Dancer | null
  /** Base scale: a common height, narrowed for heroes that dance wide. */
  scale: number
  row: number
  col: number
  x: number
  y: number
  z: number
  shadow: THREE.Mesh
  label: HTMLDivElement
  plate: number
}

let manifest: ClassManifest = { title: '', heroes: [] }
let kids: Kid[] = []
let set: SetBuild | null = null
let layoutKind: 'tv' | 'phone' = 'tv'
let rows = 2, cols = 6
let program: Program | null = null
let loopIndex = 0
const shadowGeo = new THREE.PlaneGeometry(1, 1)
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })

const GROUP_CLIPS = ['dance', 'bodyroll', 'jump']
/** What a hero does on its own page, one per tap of "another dance". */
const SOLO_MOVES = ['backflip', 'jump', 'punch', 'bodyroll']
const ALL_CLIPS = CLIPS.map((c) => c.id)

/** How many rows a screen of this shape wants. */
function shape(aspect: number) {
  const forced = params.get('layout')
  const kind: 'tv' | 'phone' = forced === 'phone' || forced === 'tv' ? forced : aspect < 0.9 ? 'phone' : 'tv'
  const n = Math.max(1, kids.length)
  let r = kind === 'phone' ? (n > 9 ? 4 : n > 4 ? 3 : 2) : (n > 7 ? 2 : 1)
  if (kind === 'tv' && aspect < 1.25 && n > 8) r = 3
  return { kind, rows: Math.min(r, n), cols: Math.ceil(n / Math.min(r, n)) }
}

function arrange() {
  const aspect = stageEl.clientWidth / Math.max(1, stageEl.clientHeight)
  const s = shape(aspect)
  const changed = s.rows !== rows || s.cols !== cols || !set
  layoutKind = s.kind
  rows = s.rows; cols = s.cols
  if (changed) {
    if (set) scene.remove(set.group)
    set = buildSet(rows, cols)
    scene.add(set.group)
  }
  kids.forEach((k, i) => {
    k.row = Math.floor(i / cols)
    const inRow = Math.min(cols, kids.length - k.row * cols)
    k.col = i % cols
    // Right to left: the first child in the list stands at the right, where a Hebrew reader starts.
    k.x = ((inRow - 1) / 2 - k.col) * SLOT
    k.y = set!.rowY(k.row)
    k.z = set!.rowZ(k.row)
    k.shadow.position.set(k.x, k.y + 0.004, k.z)
  })
  if (changed || !program) newProgram()
}

function arrangement(): Arrangement {
  // The wave runs the way a Hebrew reader reads: right to left, front row then the next.
  const waveOrder = kids.map((k, i) => i).sort((a, b) => kids[a].row - kids[b].row || kids[b].x - kids[a].x)
  // Solos go round the class; front-row and back-row children take turns.
  const spotlight: number[] = []
  const byRow = Array.from({ length: rows }, (_, r) => kids.map((k, i) => i).filter((i) => kids[i].row === r))
  const order = [0.5, 0.2, 0.8, 0.35, 0.65, 0.05, 0.95]
  for (let k = 0; spotlight.length < kids.length && k < 64; k++) {
    const row = byRow[k % rows]
    if (!row?.length) continue
    const pick = row[Math.floor(order[Math.floor(k / rows) % order.length] * row.length)]
    if (!spotlight.includes(pick)) spotlight.push(pick)
    else { const free = row.find((i) => !spotlight.includes(i)); if (free !== undefined) spotlight.push(free) }
  }
  for (let i = 0; i < kids.length; i++) if (!spotlight.includes(i)) spotlight.push(i)
  return { waveOrder, spotlight }
}

function newProgram() {
  const arr = arrangement()
  program = layoutKind === 'phone'
    ? phoneProgram(kids.length, arr, showSeconds)
    : tvProgram(kids.length, arr, showSeconds, loopIndex)
  ;(window as any).__duration = program.duration
  ;(window as any).__program = program
}

// ------------------------------------------------------------------ camera

interface Frame { x: number; y: number; z: number; h: number; w: number }

/** The whole class, every name included. */
function groupFrame(): Frame {
  let lo = Infinity, hi = -Infinity, left = Infinity, right = -Infinity
  for (const k of kids) {
    const d = k.dancer
    const top = k.y + (d ? d.top : 1.7) * k.scale
    // Room under the feet for the name plate on the tier edge, which is nearer the camera.
    lo = Math.min(lo, k.y - (k.row === 0 ? 0.75 : 0.35))
    // Headroom for the jumps the whole class does together.
    hi = Math.max(hi, top + 0.3)
    left = Math.min(left, k.x - SLOT / 2)
    right = Math.max(right, k.x + SLOT / 2)
  }
  if (!kids.length) { lo = 0; hi = 2; left = -1; right = 1 }
  const zMid = set ? (set.rowZ(0) + set.rowZ(rows - 1)) / 2 : 0
  return { x: (left + right) / 2, y: (lo + hi) / 2, z: zMid, h: hi - lo, w: right - left }
}

/** One hero, with room for the tallest thing it does (or a given height). */
function soloFrame(k: Kid, room = 1.25, moves: string[] = SOLO_MOVES, top?: number, minW = SLOT * 1.6): Frame {
  const d = k.dancer
  const reach = (top ?? Math.max(d?.top ?? 1.7, ...moves.map((m) => d?.tops[m] ?? 0))) * k.scale
  const h = reach * room
  return { x: k.x, y: k.y + reach * 0.5, z: k.z + 0.5, h, w: Math.max(minW, (k.dancer?.half ?? 0.6) * 2 * k.scale * 1.3) }
}

/**
 * How tall the solo hero's shot needs to be at `t`: its dance, opening out a
 * half second before a backflip leaves the ground and closing back gently
 * after it lands. A pure function of time, so a recording frames it the same.
 */
function soloTop(k: Kid, track: Seg[], t: number): number {
  const d = k.dancer
  const base = d?.tops.dance ?? d?.top ?? 1.7
  let top = base
  for (const s of track) {
    if (s.loop) continue
    const end = s.from + showSeconds(s.clip)
    const w = Math.min(ease((t - (s.from - 0.5)) / 0.5), ease((end + 0.9 - t) / 0.9))
    if (w > 0) top = Math.max(top, base + ((d?.tops[s.clip] ?? base) - base) * w)
  }
  return top
}

const lerpFrame = (a: Frame, b: Frame, t: number): Frame => ({
  x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
  h: a.h + (b.h - a.h) * t, w: a.w + (b.w - a.w) * t,
})

/** Insets in px the frame must keep clear (title pill, solo header and bar). */
let insetTop = 0, insetBottom = 0

function aim(f: Frame, t: number) {
  const W = stageEl.clientWidth, H = stageEl.clientHeight
  camera.aspect = W / H
  const tan = Math.tan((camera.fov * Math.PI) / 360)
  // Vertical room left once the chrome has taken its share.
  const usable = Math.max(0.3, (H - insetTop - insetBottom) / H)
  const dist = Math.max((f.h / 2) / (tan * usable), (f.w / 2) / (tan * camera.aspect)) * 1.04
  // Gentle, always moving a little: a slow sway and breathe, never a cut.
  const still = reducedMotion ? 0 : 1
  const sway = Math.sin(t * 0.37) * f.w * 0.018 * still
  const breathe = 1 + Math.sin(t * 0.23 + 1) * 0.02 * still
  const d = dist * breathe
  const lift = f.h * 0.1
  camera.position.set(f.x + sway, f.y + lift, f.z + d)
  camera.lookAt(f.x + sway * 0.4, f.y, f.z)
  // Shift the picture so the frame sits centred in the clear band.
  const shift = (insetTop - insetBottom) / 2
  if (Math.abs(shift) > 0.5) camera.setViewOffset(W, H, 0, -shift, W, H)
  else camera.clearViewOffset()
  camera.updateProjectionMatrix()
}

// ------------------------------------------------------------------ show state

const ease = (x: number) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x)
const easeOutBack = (x: number) => { const c = 1.9; const y = Math.min(1, Math.max(0, x)) - 1; return 1 + (c + 1) * y * y * y + c * y * y }

interface Solo { hero: number; at: number; track: Seg[]; closing: number | null }
let solo: Solo | null = null
let lastT = 0
const samples: Sample[] = []
const v3 = new THREE.Vector3()

/** Height of a jump in progress on this track at `t`, 0..1 (a parabola over the clip's middle). */
function airborne(track: Seg[], t: number): number {
  const dur = showSeconds('jump')
  for (let i = 0; i < track.length; i++) {
    const s = track[i]
    if (s.clip !== 'jump' || t < s.from || t >= (track[i + 1]?.from ?? Infinity)) continue
    const u = s.loop ? ((t - s.phase) % dur) / dur : (t - s.phase) / dur
    if (u > 0.28 && u < 0.72) { const x = (u - 0.28) / 0.44; return 4 * x * (1 - x) }
  }
  return 0
}

/** Ramp 0→1→0 for a spot: in over `inn` seconds, out over `out`. */
function spotK(from: number, to: number, t: number, inn = 0.7, out = 0.7) {
  if (t < from || t > to) return 0
  return Math.min(ease((t - from) / inn), ease((to - t) / out))
}

function project(x: number, y: number, z: number) {
  v3.set(x, y, z).project(camera)
  return { x: (v3.x * 0.5 + 0.5) * stageEl.clientWidth, y: (-v3.y * 0.5 + 0.5) * stageEl.clientHeight }
}

function soloTrack(at: number): Seg[] {
  return [{ clip: 'dance', from: at, phase: at, loop: true }]
}

/** Play one move on the solo hero now, then back to dancing. */
function soloMove(t: number, clip?: string) {
  if (!solo) return
  const used = solo.track.filter((s) => !s.loop).length
  const id = clip ?? SOLO_MOVES[used % SOLO_MOVES.length]
  const end = t + showSeconds(id)
  solo.track = solo.track.filter((s) => s.from < t)
  solo.track.push({ clip: id, from: t, phase: t, loop: false })
  solo.track.push({ clip: 'dance', from: end, phase: end, loop: true })
}

function openSolo(i: number, t: number) {
  if (!kids[i]?.dancer) return
  solo = { hero: i, at: t, track: soloTrack(t), closing: null }
  soloTitle.textContent = kids[i].name
  shareBtn.querySelector('span')!.textContent = 'שתפו'
  soloUi.classList.add('on')
  const u = new URL(location.href)
  u.searchParams.set('hero', kids[i].id)
  if (!RECORD) history.replaceState(null, '', u)
}

function closeSolo(t: number) {
  if (!solo || solo.closing !== null) return
  solo.closing = t
  soloUi.classList.remove('on')
  if (!RECORD) {
    const u = new URL(location.href)
    u.searchParams.delete('hero')
    history.replaceState(null, '', u)
  }
}

let toastUntil = -1
async function share(t: number) {
  if (!solo) return
  const k = kids[solo.hero]
  const u = new URL(location.href)
  u.searchParams.set('hero', k.id)
  u.searchParams.delete('record')
  const data = { title: `הגיבור של ${k.name}`, text: `הגיבור של ${k.name} רוקד!`, url: u.href }
  if (!RECORD && navigator.share) {
    try { await navigator.share(data); return } catch { /* cancelled, or refused: fall back to copying */ }
  }
  if (!RECORD) { try { await navigator.clipboard.writeText(u.href) } catch { /* nothing more to do */ } }
  toast.textContent = 'הקישור הועתק'
  toastUntil = t + 2.2
}

// ------------------------------------------------------------------ confetti

const CONFETTI = (() => {
  let s = 7
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const colors = [TB.grape, TB.sun, '#15997A', '#FF8FB1', '#4FB3FF', '#FF7A45']
  return Array.from({ length: 260 }, () => ({
    x: rnd(), delay: rnd() < 0.3 ? rnd() * 0.6 : rnd() * 7, speed: 0.16 + rnd() * 0.2, sway: rnd() * Math.PI * 2,
    spin: (rnd() - 0.5) * 9, w: 7 + rnd() * 7, h: 10 + rnd() * 9, color: colors[Math.floor(rnd() * colors.length)],
  }))
})()

function drawConfetti(t: number) {
  const g = confetti.getContext('2d')!
  const W = confetti.width, H = confetti.height
  g.clearRect(0, 0, W, H)
  const c = program?.confetti
  if (!c || t < c[0] || t > c[1] || solo || reducedMotion) return
  const scale = Math.max(1, Math.min(W, H) / 700)
  for (const p of CONFETTI) {
    const life = t - c[0] - p.delay
    if (life < 0) continue
    const y = (-0.05 + life * p.speed) * H
    if (y > H + 20) continue
    const x = (p.x + Math.sin(life * 2.2 + p.sway) * 0.025) * W
    g.save()
    g.translate(x, y)
    g.rotate(life * p.spin)
    g.scale(Math.cos(life * p.spin * 0.7), 1)
    g.fillStyle = p.color
    g.fillRect((-p.w / 2) * scale, (-p.h / 2) * scale, p.w * scale, p.h * scale)
    g.restore()
  }
}

// ------------------------------------------------------------------ frame

function fillCaption(kind: 'intro' | 'outro') {
  if (caption.dataset.kind === kind) return
  caption.dataset.kind = kind
  caption.replaceChildren(...(kind === 'intro'
    ? [el('div', { class: 'cs-cap-eyebrow' }, 'הגיבורים של'), el('div', { class: 'cs-cap-title' }, manifest.title || 'הגן שלנו'), el('div', { class: 'cs-cap-line' }, 'כל ילד צייר גיבור. עכשיו כולם רוקדים!')]
    : [el('div', { class: 'cs-cap-title' }, 'כל הגן רוקד!'), el('div', { class: 'cs-cap-line' }, `${kids.length} ילדים, ${kids.length} גיבורים`)]))
}

function render(t: number, draw = true) {
  const dt = Math.max(0, Math.min(0.1, t - lastT))
  lastT = t
  const p = program
  if (!p || !set) { renderer.render(scene, camera); return }

  // Live, the show repeats with the solos going round the class.
  if (!RECORD && t > p.duration && !solo) {
    loopIndex++
    clock.restart()
    newProgram()
    return
  }

  const spot = p.spots.find((s) => t >= s.from && t <= s.to) ?? null
  const sk = spot && !solo ? spotK(spot.from, spot.to, t) : 0

  // Solo: the others pop out, the camera comes in.
  let soloK = 0
  if (solo) {
    const opening = ease((t - solo.at) / 0.6)
    soloK = solo.closing !== null ? 1 - ease((t - solo.closing) / 0.6) : opening
    if (solo.closing !== null && t - solo.closing > 0.6) solo = null
  }

  kids.forEach((k, i) => {
    const d = k.dancer
    if (!d) return
    const root = d.hero.root
    const pop = p.popAt[i] < 0 ? 1 : easeOutBack((t - p.popAt[i]) / 0.38)
    let scale = k.scale * Math.max(0, pop)
    let z = k.z, y = k.y
    const isSolo = solo?.hero === i
    if (solo && !isSolo) {
      const away = Math.min(1, soloK * 1.3 - (Math.abs(k.x - kids[solo.hero].x) / (SLOT * cols)) * 0.3)
      scale *= 1 - ease(away)
    }
    if (spot?.hero === i && !solo) {
      const step = spotK(spot.from, spot.to, t, 0.7, 0.7)
      z += step * 0.5
      // A little hop forward, and back.
      const hopIn = t - spot.from, hopOut = spot.to - t
      const hop = hopIn < 0.7 ? Math.sin((hopIn / 0.7) * Math.PI) : hopOut < 0.7 ? Math.sin((hopOut / 0.7) * Math.PI) : 0
      y += hop * 0.22 * k.scale
      scale *= 1 + step * 0.12
    }
    // The jump clip crouches and stretches but barely leaves the floor; give it air.
    const track = solo?.hero === i ? solo.track : p.tracks[i]
    y += airborne(track, t) * 0.6 * k.scale
    root.visible = scale > 0.002
    root.scale.setScalar(Math.max(0.001, scale))
    root.position.set(k.x, y, z)
    k.shadow.visible = root.visible
    k.shadow.position.set(k.x, k.y + 0.004, z)
    k.shadow.scale.setScalar(Math.max(0.6, d.half * 1.5) * scale)
    if (root.visible) {
      d.pose(sampleTrack(track, t, showSeconds, samples))
      d.hero.vrm.update(RECORD ? 1 / 30 : dt || 1 / 60)
    }
  })

  // Camera: the class, leaning toward the soloist, or the solo hero on its own.
  // A caption card takes the top of the screen; the class moves down to make room for it.
  const capNow = p.captions.find((c) => t >= c.from && t <= c.to)
  const capK = capNow && !solo ? Math.min(ease((t - capNow.from) / 0.5), ease((capNow.to - t) / 0.5)) : 0
  const pillRoom = Math.min(64, stageEl.clientHeight * 0.08)
  if (capNow) fillCaption(capNow.kind)
  const capRoom = caption.offsetHeight * 0.9 + stageEl.clientHeight * 0.04
  insetTop = solo ? 96 * soloK : pillRoom + (capRoom - pillRoom) * capK
  insetBottom = solo ? Math.min(stageEl.clientHeight * 0.32, 190) * soloK : 0
  let f = groupFrame()
  if (spot && sk > 0) f = lerpFrame(f, soloFrame(kids[spot.hero], 1.5, spot.moves), sk * (layoutKind === 'phone' ? 0.3 : 0.6))
  if (solo) f = lerpFrame(f, soloFrame(kids[solo.hero], 1.18, [], soloTop(kids[solo.hero], solo.track, t), SLOT * 1.1), soloK)
  aim(f, t)
  // A recorder warming up (spring bones settling) needs the poses and the page, not the pixels.
  if (draw) renderer.render(scene, camera)

  // ---- overlays
  const W = stageEl.clientWidth, H = stageEl.clientHeight
  const unit = Math.min(W, H)
  kids.forEach((k, i) => {
    const d = k.dancer
    const front = set!.rowFront(k.row)
    const at = project(k.x, k.y - 0.02, front)
    const pop = p.popAt[i] < 0 ? 1 : ease((t - p.popAt[i] - 0.1) / 0.3)
    const hidden = !d || (spot?.hero === i && sk > 0.05) || solo !== null
    const a = hidden ? 0 : pop * (1 - soloK)
    k.label.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%) scale(${0.7 + 0.3 * pop})`
    k.label.style.opacity = String(a)
  })
  // Spotlight: the room dims round the soloist and their name comes up big.
  if (spot && sk > 0) {
    const k = kids[spot.hero]
    const c = project(k.x, k.y + (k.dancer?.top ?? 1.7) * k.scale * 0.55, k.z + 0.5)
    const r = Math.max(unit * 0.26, ((k.dancer?.top ?? 1.7) * k.scale) / (f.h) * H * 0.7)
    dim.style.background = `radial-gradient(circle ${r}px at ${c.x}px ${c.y}px, rgba(35,25,66,0) 0%, rgba(35,25,66,0) 62%, rgba(35,25,66,0.5) 100%)`
    dim.style.opacity = String(sk)
    ;(spotCard.lastChild as HTMLElement).textContent = k.name
    const pop = easeOutBack((t - spot.from - 0.25) / 0.45)
    spotCard.style.opacity = String(Math.min(1, sk * 1.6))
    spotCard.style.transform = `translateX(-50%) scale(${Math.max(0, 0.6 + 0.4 * pop)})`
  } else {
    dim.style.opacity = '0'
    spotCard.style.opacity = '0'
  }
  // Captions.
  const cap = p.captions.find((c) => t >= c.from && t <= c.to)
  if (cap && !solo) {
    const k = Math.min(ease((t - cap.from) / 0.4), ease((cap.to - t) / 0.4))
    caption.style.opacity = String(k)
    caption.style.transform = `translate(-50%, 0) scale(${0.85 + 0.15 * easeOutBack((t - cap.from) / 0.5)})`
  } else {
    caption.style.opacity = '0'
  }
  // The class's name, small and always there once the intro has gone.
  const intro = p.captions.find((c) => c.kind === 'intro')
  const outro = p.captions.find((c) => c.kind === 'outro')
  const pillOn = !solo && (!intro || t > intro.to) && !(outro && t > outro.from) && !(spot && sk > 0.05)
  titlePill.textContent = manifest.title || 'הגן שלנו'
  titlePill.style.opacity = pillOn ? '1' : '0'
  toast.style.opacity = t < toastUntil ? '1' : '0'
  drawConfetti(t)
}

// ------------------------------------------------------------------ clock

const clock = {
  t0: performance.now(),
  restart() { this.t0 = performance.now(); lastT = 0 },
  now() { return (performance.now() - this.t0) / 1000 },
}

function resize() {
  const W = stageEl.clientWidth, H = stageEl.clientHeight
  renderer.setSize(W, H, false)
  const pr = renderer.getPixelRatio()
  confetti.width = Math.round(W * pr); confetti.height = Math.round(H * pr)
  confetti.style.width = `${W}px`; confetti.style.height = `${H}px`
  if (kids.length) arrange()
}
new ResizeObserver(resize).observe(stageEl)

let frames = 0, fpsT = performance.now(), fps = 0
function loop() {
  const t = clock.now()
  render(t)
  frames++
  const now = performance.now()
  if (now - fpsT > 1000) {
    fps = (frames * 1000) / (now - fpsT)
    frames = 0; fpsT = now
    ;(window as any).__fps = fps
    if (STATS) statsEl.textContent = `${fps.toFixed(1)} fps · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`
  }
}

// ------------------------------------------------------------------ input

function heroAt(px: number, py: number): number {
  let best = -1, bestD = Infinity
  kids.forEach((k, i) => {
    if (!k.dancer || !k.dancer.hero.root.visible) return
    const base = project(k.x, k.y, k.z)
    const top = project(k.x, k.y + k.dancer.top * k.scale, k.z)
    const half = Math.abs(project(k.x + SLOT / 2, k.y, k.z).x - base.x)
    if (px < base.x - half || px > base.x + half || py > base.y + 10 || py < top.y - 10) return
    const d = Math.abs(px - base.x)
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

stageEl.addEventListener('click', (e) => {
  if (RECORD || solo || (e.target as HTMLElement).closest('button')) return
  const r = stageEl.getBoundingClientRect()
  const i = heroAt(e.clientX - r.left, e.clientY - r.top)
  if (i >= 0) openSolo(i, clock.now())
})
soloBack.addEventListener('click', () => closeSolo(clock.now()))
moreBtn.addEventListener('click', () => soloMove(clock.now()))
shareBtn.addEventListener('click', () => share(clock.now()))
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSolo(clock.now()) })

// ------------------------------------------------------------------ recorder hooks

Object.assign(window as any, {
  /** Render exactly the show at time t (frame-stepped recording). */
  __setTime: (t: number, draw = true) => render(t, draw),
  __openSolo: (i: number, t: number) => openSolo(i, t),
  __closeSolo: (t: number) => closeSolo(t),
  __soloMove: (t: number, clip?: string) => soloMove(t, clip),
  __share: (t: number) => share(t),
  /** Where hero i stands on screen, for a recorder that wants to show a tap there. */
  __heroPoint: (i: number) => {
    const k = kids[i]
    return project(k.x, k.y + (k.dancer?.top ?? 1.7) * k.scale * 0.45, k.z)
  },
  __tap: (x: number, y: number, k: number) => {
    tapRing.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.6 + k * 0.8})`
    tapRing.style.opacity = String(k > 0 && k < 1 ? 1 - k * 0.6 : 0)
  },
  __press: (which: 'share' | 'more', on: boolean) => (which === 'share' ? shareBtn : moreBtn).classList.toggle('cs-pressed', on),
  __kids: () => kids.map((k) => ({ name: k.name, id: k.id, row: k.row, col: k.col, scale: k.scale, half: k.dancer?.half, top: k.dancer?.top, reach: k.dancer?.reach, tops: k.dancer?.tops, height: k.dancer?.hero.height })),
  /** Time one bare render (no posing), for telling GPU cost from animation cost. */
  __renderOnly: () => { const a = performance.now(); renderer.render(scene, camera); renderer.getContext().finish(); const px = new Uint8Array(4); renderer.getContext().readPixels(0, 0, 1, 1, 0x1908, 0x1401, px); return performance.now() - a },
  __renderInfo: () => ({ ...renderer.info.render, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
})

// ------------------------------------------------------------------ boot

type Listener = (f: number) => void
async function download(url: string, onProgress: Listener): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(`${r.status}`)
  const total = Number(r.headers.get('content-length')) || 0
  const reader = r.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
    if (total) onProgress(Math.min(0.99, got / total))
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  onProgress(1)
  perf.bytes = (perf.bytes ?? 0) + got
  return out.buffer
}

function showLoading(m: ClassManifest) {
  const tiles = m.heroes.map((h, i) => {
    const img = el('img', { alt: '', src: heroThumb(h), loading: 'eager' })
    img.onerror = () => { img.style.visibility = 'hidden' }
    return el('div', { class: `cs-load-tile tb-plate-${(i % 6) + 1}` }, img, el('span', {}, h.name))
  })
  const bar = el('div', { class: 'cs-load-fill' })
  loading.replaceChildren(el('div', { class: 'cs-load-card' },
    el('div', { class: 'tb-eyebrow' }, 'הגיבורים של'),
    el('div', { class: 'cs-load-title' }, m.title || 'הגן שלנו'),
    el('div', { class: 'cs-load-grid' }, ...tiles),
    el('div', { class: 'cs-load-bar' }, bar),
  ))
  return { tiles, bar }
}

async function boot() {
  try {
    manifest = await loadManifest()
  } catch (err) {
    loading.replaceChildren(el('div', { class: 'cs-load-card' }, el('div', { class: 'cs-load-title' }, 'לא מצאנו את הגן'), el('div', { class: 'tb-bar-note' }, (err as Error).message)))
    return
  }
  mark('manifest')
  if (manifest.title) document.title = `${manifest.title} · הגיבורים שלנו`
  const ui = showLoading(manifest)
  // The clips are the same for every hero: start them now, beside the heroes.
  for (const c of CLIPS) void preloadClip(animUrl(c.url), c.kind)

  kids = manifest.heroes.map((h, i) => {
    const shadow = new THREE.Mesh(shadowGeo, shadowMat)
    shadow.rotation.x = -Math.PI / 2
    shadow.renderOrder = -1
    scene.add(shadow)
    const label = el('div', { class: `cs-label tb-plate-${(i % 6) + 1}` }, h.name)
    label.style.opacity = '0'
    labelsEl.append(label)
    return { name: h.name, id: h.id, dancer: null, scale: 1, row: 0, col: 0, x: 0, y: 0, z: 0, shadow, label, plate: i % 6 }
  })
  arrange()

  const progress = new Array(kids.length).fill(0)
  const tick = () => {
    const sum = progress.reduce((a, b) => a + b, 0)
    ui.bar.style.width = `${Math.round((sum / Math.max(1, kids.length)) * 100)}%`
  }
  let failed = 0
  // Downloads all start together; parsing is one at a time on the main thread
  // anyway, so it simply follows the downloads in the order they land.
  await Promise.all(manifest.heroes.map(async (h, i) => {
    try {
      const buf = await download(heroVrm(h), (f) => { progress[i] = f * 0.8; tick() })
      perf[`dl${i}`] = Math.round(performance.now())
      const hero = await parseHero(buf, { outline: OUTLINE })
      const d = new Dancer(hero)
      await d.bind(animUrl)
      d.measure(GROUP_CLIPS, ALL_CLIPS)
      const k = kids[i]
      // A common height, narrowed if this hero dances wider than its slot.
      k.scale = Math.min(1.62 / Math.max(0.5, hero.height), (SLOT * 0.56) / Math.max(0.2, d.half), (TIER_H - 0.35) / Math.max(0.5, d.top))
      hero.root.visible = false
      scene.add(hero.root)
      k.dancer = d
      progress[i] = 1; tick()
      ui.tiles[i].classList.add('ready')
      perf[`ready${i}`] = Math.round(performance.now())
    } catch (err) {
      failed++
      console.warn(`hero ${h.name} could not load:`, (err as Error).message)
      ui.tiles[i].classList.add('failed')
    }
  }))
  mark('allReady')
  // A hero that failed to load leaves no gap: the class closes ranks.
  if (failed) {
    const gone = kids.filter((k) => !k.dancer)
    gone.forEach((k) => { k.label.remove(); scene.remove(k.shadow) })
    kids = kids.filter((k) => k.dancer)
  }
  arrange()
  newProgram()
  makeEnvironment()
  // Compile every shader before the show starts, so the first frame does not hitch.
  for (const k of kids) k.dancer!.hero.root.visible = true
  renderer.compile(scene, camera)
  for (const k of kids) k.dancer!.hero.root.visible = false
  mark('compiled')
  perf.heroes = kids.length
  perf.failed = failed
  loading.classList.add('gone')
  setTimeout(() => loading.remove(), 400)

  const want = params.get('hero')
  clock.restart()
  if (want) {
    const i = kids.findIndex((k) => k.id === want)
    if (i >= 0) {
      // Straight to this child's hero: no pop-ins, no intro.
      if (program) { program.popAt = program.popAt.map(() => -1); program.captions = program.captions.filter((c) => c.kind !== 'intro') }
      openSolo(i, 0)
    }
  }
  ;(window as any).__ready = true
  if (!RECORD) renderer.setAnimationLoop(loop)
}

void boot()
// The loading card covers the stage until the class is in; nothing to draw before that.
resize()
