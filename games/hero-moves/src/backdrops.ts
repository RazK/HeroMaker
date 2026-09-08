/**
 * The backdrop lab.
 *
 * A standalone page whose only job is to let a theme be judged with a real hero
 * standing in front of it, at a real viewport, in the real play framing — the
 * same renderer settings, the same `Stage`, the same `PlayCamera` as the game.
 * Anything that looks right here looks right in the game; nothing else about
 * this page matters.
 *
 * The playbook's hardest-won rule is that nearly every real bug in this project
 * was found by taking a screenshot and looking at it. This is what
 * `tools/backdropshot.mjs` points at.
 *
 *   backdrops.html?bg=space&a=Cloudy          one hero, deep space
 *   backdrops.html?a=Cloudy,Superstar,Skelly  the pale one and the yellow one
 *   backdrops.html?q=lite                     the cheap path
 *
 * Click, or press the arrow keys, to cycle themes and heroes by hand.
 */
import * as THREE from 'three'
import { loadHero, type Hero } from './avatar/loader'
import { PoseSolver } from './pose/solver'
import { skeletonFromAngles, NEUTRAL_ANGLES, type MoveAngles } from './pose/moves'
import { Stage, BACKDROPS } from './stage/stage'
import { PlayCamera } from './stage/camera'
import type { Quality } from './stage/env'

const files = import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const HEROES = Object.keys(files)
  .map((p) => p.split('/').pop()!.replace('.opt.vrm', ''))
  .sort()
const urlFor = (name: string) =>
  Object.entries(files).find(([k]) => k.endsWith(`/${name}.opt.vrm`))?.[1]

const params = new URLSearchParams(location.search)
const quality: Quality = params.get('q') === 'lite' ? 'lite' : 'full'
/** Beats per minute the pulse runs at, so the beat-driven bits are visible. */
const BPM = Number(params.get('bpm') ?? 100)

/** The same open stance the menu portraits use: not a T-pose, not arms-down. */
const STANCE: MoveAngles = {
  ...NEUTRAL_ANGLES,
  leftArm: -34, leftForearm: -38,
  rightArm: 214, rightForearm: 218,
  leftLeg: -80, leftShin: -84, rightLeg: -100, rightShin: -96,
}

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: quality === 'full', powerPreference: 'high-performance' })
renderer.setPixelRatio(quality === 'full' ? Math.min(devicePixelRatio, 2) : 1)
renderer.shadowMap.enabled = quality === 'full'
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const stage = new Stage(params.get('bg') ?? BACKDROPS[0].id)
stage.setQuality(quality)
scene.add(stage.group)
const play = new PlayCamera()

const lanes: THREE.Group[] = [new THREE.Group(), new THREE.Group(), new THREE.Group()]
for (const l of lanes) scene.add(l)
const heroes: Array<Hero | null> = [null, null, null]

const nameEl = document.getElementById('name')!
const blurbEl = document.getElementById('blurb')!
const castEl = document.getElementById('cast')!

function layout() {
  const n = heroes.filter(Boolean).length
  const portrait = app.clientHeight > app.clientWidth
  const gap = n === 1 ? 0 : portrait ? 0.55 : 1.05
  for (let i = 0; i < lanes.length; i++) {
    const x = (i - (n - 1) / 2) * gap
    lanes[i].position.set(x, 0, 0)
    lanes[i].rotation.y = n > 1 ? -x * 0.1 : 0
  }
}

function frame() {
  const w = app.clientWidth, h = app.clientHeight
  renderer.setSize(w, h, false)
  layout()
  const live = heroes.filter(Boolean) as Hero[]
  if (!live.length) return
  const n = live.length
  const widest = Math.max(...live.map((x) => x.width))
  const spread = n > 1 ? Math.abs(lanes[n - 1].position.x - lanes[0].position.x) : 0
  play.frame({
    heroHeight: Math.max(...live.map((x) => x.height)),
    spanX: spread + widest,
    spanZ: widest * 0.5,
    aspect: w / h,
    portrait: h > w,
    viewportW: w,
    viewportH: h,
  })
}
addEventListener('resize', frame)

async function setHeroes(names: string[]) {
  const wanted = names.slice(0, 3).filter((n) => urlFor(n))
  for (let i = 0; i < 3; i++) {
    const hero = heroes[i]
    if (hero) { lanes[i].remove(hero.root); hero.dispose(); heroes[i] = null }
  }
  await Promise.all(wanted.map(async (name, i) => {
    const hero = await loadHero(urlFor(name)!)
    // One still, deliberately posed. This page judges the set, not the dance.
    new PoseSolver(hero.rig, 1).apply(skeletonFromAngles(STANCE), 1)
    hero.vrm.update(1 / 30)
    hero.root.updateMatrixWorld(true)
    lanes[i].add(hero.root)
    heroes[i] = hero
  }))
  castEl.textContent = wanted.join(' · ')
  frame()
}

function setBackdrop(id: string) {
  stage.setBackdrop(id)
  const spec = BACKDROPS.find((b) => b.id === stage.backdropId)!
  nameEl.textContent = spec.name
  blurbEl.textContent = spec.blurb
  document.title = `Backdrops — ${spec.name}`
}

/** Resolve once the switch has actually been drawn, so a harness can await it. */
const drawn = () => new Promise<void>((res) => {
  let n = 0
  const tick = () => (++n >= 3 ? res() : requestAnimationFrame(tick))
  requestAnimationFrame(tick)
})

let last = performance.now()
let clock = 0
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  clock += dt
  const phase = (clock / (60 / BPM)) % 1
  for (const h of heroes) h?.vrm.update(dt)
  stage.update(dt, phase)
  play.update(dt, phase)
  renderer.render(scene, play.camera)
  ;(window as { __frames?: number }).__frames = ((window as { __frames?: number }).__frames ?? 0) + 1
})

// ---- hand controls ----------------------------------------------------------
const cycle = (delta: number) => {
  const i = BACKDROPS.findIndex((b) => b.id === stage.backdropId)
  setBackdrop(BACKDROPS[(i + delta + BACKDROPS.length) % BACKDROPS.length].id)
}
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') cycle(1)
  else if (e.key === 'ArrowLeft') cycle(-1)
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const cast = (castEl.textContent ?? '').split(' · ')
    const i = HEROES.indexOf(cast[0])
    void setHeroes([HEROES[(i + (e.key === 'ArrowUp' ? 1 : -1) + HEROES.length) % HEROES.length]])
  }
})
renderer.domElement.addEventListener('click', () => cycle(1))

;(async () => {
  setBackdrop(params.get('bg') ?? BACKDROPS[0].id)
  await setHeroes((params.get('a') ?? HEROES[0]).split(','))
  await drawn()
  const w = window as unknown as Record<string, unknown>
  w.__backdrops = BACKDROPS
  w.__heroes = HEROES
  w.__setBackdrop = async (id: string) => { setBackdrop(id); await drawn() }
  w.__setHeroes = async (names: string[]) => { await setHeroes(names); await drawn() }
  w.__setQuality = async (q: Quality) => { stage.setQuality(q); await drawn() }
  w.__ready = true
})()
