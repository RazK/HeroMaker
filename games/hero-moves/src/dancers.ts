/**
 * The stand-in party: one to three performers side by side, in lanes.
 *
 * The game reads its players out of a camera frame divided into lanes, so a
 * recording of it needs a camera frame with a body in each lane. This renders
 * exactly that, and encodes it to a video Chromium serves as the webcam — the
 * tracker cannot tell the difference, so every stage of the real pipeline runs.
 *
 * ## Staying in step with the game
 *
 * A pre-rendered feed and a live game have no shared clock. Rather than guess
 * an offset, the feed opens on a **marker pose** held for a known second: the
 * recorder watches the classifier, sees the marker appear, and starts the round
 * on that frame. The lead-in that follows is exactly the routine's lead-in, so
 * beat zero of the game lands on the first beat of the dance.
 *
 * The routine itself is generated from the same seed the game is started with,
 * so the performers are dancing the game's actual choreography rather than
 * something that merely looks like it.
 */
import * as THREE from 'three'
import { loadHero, type Hero } from './avatar/loader'
import { PoseSolver } from './pose/solver'
import { NEUTRAL_ANGLES, skeletonFromAngles, type MoveAngles } from './pose/moves'
import { makeRoutine, LENGTHS, type LengthId } from './game/party'
import { secondsPerBeat, slotAt } from './game/song'
import { lerp } from './core/math'

const files = import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const params = new URLSearchParams(location.search)
const num = (k: string, d: number) => Number(params.get(k) ?? d)
const W = num('w', 640), H = num('h', 480)
const names = (params.get('as') ?? 'Gingerella,Skelly,Cloudy').split(',')
const n = Math.max(1, Math.min(3, num('n', names.length)))
const seed = num('seed', 4242)
const lengthId = (params.get('len') ?? 'short') as LengthId
/**
 * Stretches the whole performance. Running MoveNet without a GPU costs a
 * recording most of its tracking samples, so a capture is made with the game
 * clock slowed and sped back up afterwards — and the feed has to be slowed by
 * the same factor or the dancers arrive on the wrong beat.
 */
const SCALE = num('scale', 1)
/** Marker pose held at the top of the feed, and how long for. */
const MARK = num('mark', 1.0) * SCALE
const MARK_ANGLES: MoveAngles = {
  leftArm: 50, leftForearm: 50, rightArm: 130, rightForearm: 130,
  leftLeg: -60, leftShin: -62, rightLeg: -120, rightShin: -118,
}
/**
 * How well each lane dances, 0..1. Not decoration: a podium with three equal
 * scores proves nothing, and a demo whose players all score the same looks like
 * the scorer is not running.
 */
const SKILL = (params.get('skill') ?? '1,0.82,0.62').split(',').map(Number)

const song = makeRoutine((LENGTHS.find((l) => l.id === lengthId) ?? LENGTHS[0]).moves, seed)
const bs = secondsPerBeat(song.bpm)
const LEAD = song.leadInBeats * bs * SCALE
const TAIL = 2.5 * SCALE

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H); renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#93a9c4')
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2))
const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(1, 3, 4); scene.add(key)

/**
 * How much room the shot leaves above the tallest performer.
 *
 * Three people standing side by side in front of one laptop is not three
 * separate portraits; it is one wide shot in which each body is about a third
 * of the width and nearly the full height, and their arms cross well into each
 * other's third. Rendering it any other way would produce a feed the real game
 * never gets, and would quietly hide the lane-crop problem that arm overlap
 * causes. So: one camera, one shot, bodies where they would really stand.
 *
 * The margin is over the *rest* height, and these avatars raise their arms well
 * above their own heads — a hand cut off at the top of the frame is a keypoint
 * MoveNet invents rather than omits, so the headroom is generous.
 */
const HEADROOM = num('headroom', 1.45)

const mix = (a: MoveAngles, b: MoveAngles, e: number): MoveAngles => {
  const m = (x: keyof MoveAngles) => lerp(a[x] ?? NEUTRAL_ANGLES[x]!, b[x] ?? NEUTRAL_ANGLES[x]!, e)
  return {
    leftArm: m('leftArm'), leftForearm: m('leftForearm'),
    rightArm: m('rightArm'), rightForearm: m('rightForearm'),
    leftLeg: m('leftLeg'), leftShin: m('leftShin'),
    rightLeg: m('rightLeg'), rightShin: m('rightShin'),
  }
}

/**
 * What lane `i` is doing at video time `t`.
 *
 * Skill shows up three ways, all of them things a real player does: arriving
 * late, not reaching the full shape, and now and then dancing the wrong move
 * entirely.
 */
function anglesFor(i: number, t: number): MoveAngles {
  if (t < MARK) return MARK_ANGLES
  const skill = Math.max(0, Math.min(1, SKILL[i] ?? 1))
  const late = (1 - skill) * 1.6
  const beat = (t - MARK - LEAD) / (bs * SCALE) - late
  const idx = slotAt(song, beat)
  if (idx < 0) return NEUTRAL_ANGLES
  const slot = song.slots[idx]
  // A weak dancer flubs one call in three, and gets no credit for it.
  const flub = skill < 0.7 && idx % 3 === 2
  const target = flub
    ? song.slots[(idx + 2) % song.slots.length].move.angles
    : slot.move.angles
  const within = beat - slot.startBeat
  const ramp = 0.45
  const out = slot.beats - 0.45
  const k = within < ramp ? within / ramp
    : within < out ? 1
    : Math.max(0, 1 - (within - out) / 0.45)
  const e = k * k * (3 - 2 * k) * (0.55 + 0.45 * skill)
  return mix(NEUTRAL_ANGLES, target, e)
}

interface Performer { hero: Hero; solver: PoseSolver }

;(async () => {
  const perf: Performer[] = []
  let tallest = 1.7
  for (let i = 0; i < n; i++) {
    const id = names[i % names.length].trim()
    const url = Object.entries(files).find(([k]) => k.includes(`${id}.opt`))?.[1]
      ?? Object.values(files)[i % Object.keys(files).length]
    const hero = await loadHero(url)
    scene.add(hero.root)
    tallest = Math.max(tallest, hero.height)
    perf.push({ hero, solver: new PoseSolver(hero.rig, 1) })
  }

  // One shot of the whole room, sized off the tallest body present.
  const frameH = tallest * HEADROOM
  const frameW = (frameH * W) / H
  // Shoulder to shoulder, evenly, filling the frame the way a family does.
  const spacing = frameW / (n + 0.25)
  for (let i = 0; i < n; i++) perf[i].hero.root.position.set((i - (n - 1) / 2) * spacing, 0, 0)
  const cam = new THREE.PerspectiveCamera(38, W / H, 0.1, 60)
  const d = frameH / 2 / Math.tan(THREE.MathUtils.degToRad(19))
  // A shade above the middle of the shot: feet stay in, hands get the room.
  const eye = frameH * 0.47
  cam.position.set(0, eye, d)
  cam.lookAt(0, eye, 0)
  console.log(`frame ${frameW.toFixed(2)}x${frameH.toFixed(2)}m, tallest ${tallest.toFixed(2)}m, spacing ${spacing.toFixed(2)}m`)

  ;(window as any).__setTime = (t: number) => {
    for (let i = 0; i < n; i++) {
      const p = perf[i]
      p.solver.apply(skeletonFromAngles(anglesFor(i, t)), 1)
      const phase = (t / (bs * SCALE)) * Math.PI + i * 0.7
      p.hero.root.position.y = Math.abs(Math.sin(phase)) * 0.045
      p.hero.root.rotation.y = Math.sin(phase * 0.5) * 0.06
      p.hero.vrm.update(1 / 30)
    }
    renderer.render(scene, cam)
  }
  ;(window as any).__setTime(0)
  ;(window as any).__duration = MARK + LEAD + song.totalBeats * bs * SCALE + TAIL
  ;(window as any).__mark = MARK
  ;(window as any).__ready = true
})()
