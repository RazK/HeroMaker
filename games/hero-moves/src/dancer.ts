/**
 * A stand-in performer, used to test and demo the game without a webcam.
 *
 * It renders a HeroMaker avatar dancing through the move list, and the result
 * is encoded to a video that Chromium is told to serve as the camera. The
 * tracker cannot tell the difference, so the whole pipeline — camera in, pose
 * out, rig driven, move scored — runs exactly as it does for a real player.
 *
 * Using an avatar as the performer is not a cheat: MoveNet reports 17/17
 * confident keypoints on these models, which is what made this approach
 * viable in the first place.
 */
import * as THREE from 'three'
import { loadHero } from './avatar/loader'
import { PoseSolver } from './pose/solver'
import { MOVES, skeletonFromAngles, type MoveAngles } from './pose/moves'
import { lerp } from './core/math'

const files = import.meta.glob('../public/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const params = new URLSearchParams(location.search)
const pick = params.get('a') ?? 'Gingerella'
const W = Number(params.get('w') ?? 640)
const H = Number(params.get('h') ?? 480)
/** Seconds each move is held. */
const HOLD = Number(params.get('hold') ?? 1.6)

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H); renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#93a9c4')
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2))
const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(1, 3, 4); scene.add(key)

const order = MOVES.map((m) => m.angles)

/**
 * "Follow" mode performs the game's own schedule: idle while the hero coaches,
 * then strike the move during the copy window. That makes the recording show a
 * player who is actually playing, rather than two clocks drifting past each
 * other. One move is deliberately performed wrong so the grades vary and the
 * scoring is visibly doing something.
 */
const FOLLOW = params.get('mode') === 'follow'
const BEAT = 60 / 100
const COACH = 4 * BEAT, COPY = 4 * BEAT, GRADE = 2 * BEAT
const CYCLE = COACH + COPY + GRADE
const LEAD_IN = 4 * BEAT
const OFFSET = Number(params.get('offset') ?? 0)
/** Index performed as the wrong shape, to prove the scorer is not rubber-stamping. */
const FLUB = Number(params.get('flub') ?? 4)

const NEUTRAL: MoveAngles = {
  leftArm: -62, leftForearm: -72, rightArm: 242, rightForearm: 252,
  leftLeg: -80, leftShin: -85, rightLeg: -100, rightShin: -95,
}

function followAngles(t: number): MoveAngles {
  const local = t - LEAD_IN - OFFSET
  if (local < 0) return NEUTRAL
  const i = Math.floor(local / CYCLE)
  if (i >= order.length) return NEUTRAL
  const within = local - i * CYCLE
  const wanted = i === FLUB ? order[(i + 3) % order.length] : order[i]

  // Move into the shape just before the copy window opens, hold it, then relax.
  const inStart = COACH - 0.35
  const outStart = COACH + COPY + 0.1
  let k: number
  if (within < inStart) k = 0
  else if (within < COACH + 0.35) k = (within - inStart) / 0.7
  else if (within < outStart) k = 1
  else k = Math.max(0, 1 - (within - outStart) / 0.5)
  const e = k * k * (3 - 2 * k)

  const mix = (a: number | undefined, b: number | undefined, d: number) =>
    lerp(a ?? d, b ?? d, e)
  return {
    leftArm: mix(NEUTRAL.leftArm, wanted.leftArm, 0),
    leftForearm: mix(NEUTRAL.leftForearm, wanted.leftForearm, 0),
    rightArm: mix(NEUTRAL.rightArm, wanted.rightArm, 180),
    rightForearm: mix(NEUTRAL.rightForearm, wanted.rightForearm, 180),
    leftLeg: mix(NEUTRAL.leftLeg, wanted.leftLeg, -80),
    leftShin: mix(NEUTRAL.leftShin, wanted.leftShin, -85),
    rightLeg: mix(NEUTRAL.rightLeg, wanted.rightLeg, -100),
    rightShin: mix(NEUTRAL.rightShin, wanted.rightShin, -95),
  }
}

/** Ease between the two moves either side of `t`, so the dance flows. */
function angleAt(t: number): MoveAngles {
  const i = Math.floor(t / HOLD) % order.length
  const j = (i + 1) % order.length
  const raw = (t % HOLD) / HOLD
  // Hold the pose for most of the beat, then move quickly — the shape of a
  // dance, and it gives the scorer a stable window to read.
  const k = raw < 0.6 ? 0 : (raw - 0.6) / 0.4
  const e = k * k * (3 - 2 * k)
  const a = order[i], b = order[j]
  const mix = (x?: number, y?: number, d = -90) => lerp(x ?? d, y ?? d, e)
  return {
    leftArm: mix(a.leftArm, b.leftArm, 0),
    leftForearm: mix(a.leftForearm, b.leftForearm, 0),
    rightArm: mix(a.rightArm, b.rightArm, 180),
    rightForearm: mix(a.rightForearm, b.rightForearm, 180),
    leftLeg: mix(a.leftLeg, b.leftLeg, -80),
    leftShin: mix(a.leftShin, b.leftShin, -85),
    rightLeg: mix(a.rightLeg, b.rightLeg, -100),
    rightShin: mix(a.rightShin, b.rightShin, -95),
  }
}

;(async () => {
  const url = Object.entries(files).find(([k]) => k.includes(pick))![1]
  const hero = await loadHero(url)
  scene.add(hero.root)
  const solver = new PoseSolver(hero.rig, 1)

  const cam = new THREE.PerspectiveCamera(36, W / H, 0.1, 40)
  cam.position.set(0, hero.height * 0.52, hero.height * 1.72)
  cam.lookAt(0, hero.height * 0.52, 0)

  // Deterministic: the recorder sets the time, so every run is identical.
  ;(window as any).__setTime = (t: number) => {
    const sk = skeletonFromAngles(FOLLOW ? followAngles(t) : angleAt(t))
    solver.apply(sk, 1)
    // A little bounce and sway so it reads as dancing, not as posing.
    hero.root.position.y = Math.abs(Math.sin((t / HOLD) * Math.PI * 2)) * 0.045
    hero.root.rotation.y = Math.sin((t / HOLD) * Math.PI) * 0.05
    hero.vrm.update(1 / 30)
    renderer.render(scene, cam)
  }
  ;(window as any).__setTime(0)
  ;(window as any).__duration = FOLLOW ? LEAD_IN + order.length * CYCLE + 2 : order.length * HOLD
  ;(window as any).__ready = true
})()
