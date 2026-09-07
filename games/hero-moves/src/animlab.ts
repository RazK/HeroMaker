/**
 * The animation lab.
 *
 * A standalone page that plays real, downloaded, full-body humanoid clips on a
 * HeroMaker avatar — the thing the game's nine hand-authored static poses were
 * always a stand-in for. It exists to answer one question with a video: can a
 * VRM 0.0 avatar generated from a child's drawing perform motion capture?
 *
 * Time is stepped from outside (`window.__setTime`), never from a clock, so
 * tools/make-animlab-video.mjs gets the same frames on a machine with no GPU
 * as it would on one with.
 */
import * as THREE from 'three'
import { loadHero } from './avatar/loader'
import { loadVrma, loadRetargeted, type LoadedClip } from './anim/clips'

const avatars = import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>
const animations = import.meta.glob('../assets/animations/*', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const asset = (table: Record<string, string>, name: string) => {
  const hit = Object.entries(table).find(([k]) => k.endsWith(`/${name}`))
  if (!hit) throw new Error(`missing asset ${name}`)
  return hit[1]
}

const params = new URLSearchParams(location.search)
const pick = params.get('a') ?? 'Crayon_Kid'
const W = Number(params.get('w') ?? 960)
const H = Number(params.get('h') ?? 600)
/** Seconds of screen time each clip gets, looping if it is shorter. */
const HOLD = Number(params.get('hold') ?? 7)

interface Cue {
  file: string
  title: string
  credit: string
  /** Playback rate; the mocap clips are authored fast for game loops. */
  rate?: number
  /**
   * Metres of world height the shot has to hold. A backflip needs three times
   * the headroom a punch does, so the camera dollies per clip rather than
   * framing everything for the worst case and leaving the dance tiny.
   */
  fit: number
}

/**
 * Four clips, none of them authored here, chosen to be unmistakably different
 * from one across a room: a dance, a flip, a punch, a jump.
 */
const CC0 = 'Quaternius Universal Animation Library (CC0) · glTF, retargeted'
const CUES: Cue[] = [
  { file: 'Dance_Charleston.glb', title: 'Dance Charleston', credit: CC0, rate: 0.9, fit: 2.5 },
  { file: 'Backflip.glb', title: 'Backflip', credit: CC0, rate: 0.75, fit: 3.9 },
  { file: 'Punch_Cross.glb', title: 'Punch Cross', credit: CC0, rate: 0.85, fit: 2.4 },
  { file: 'Jump.vrma', title: 'Jump', credit: 'tk256ailab/vrm-viewer (MIT) · .vrma, played natively', rate: 0.9, fit: 2.6 },
]

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H)
renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#20222e')
scene.fog = new THREE.Fog('#20222e', 6, 16)
scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x33303c, 1.9))
const key = new THREE.DirectionalLight(0xfff2dd, 2.1)
key.position.set(2.2, 4.5, 3.6)
scene.add(key)
const rim = new THREE.DirectionalLight(0x88b0ff, 1.1)
rim.position.set(-3, 2.4, -2.6)
scene.add(rim)

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3.4, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: '#2c2f3f', roughness: 1 }),
)
scene.add(floor)
const grid = new THREE.PolarGridHelper(3.4, 8, 6, 64, 0x4a4f68, 0x3a3e52)
;(grid.material as THREE.Material).transparent = true
;(grid.material as THREE.Material).opacity = 0.55
grid.position.y = 0.002
scene.add(grid)

/** A cheap contact shadow: real shadow maps are far too slow under SwiftShader. */
const blob = new THREE.Mesh(
  new THREE.CircleGeometry(0.42, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 }),
)
blob.position.y = 0.004
scene.add(blob)

const titleEl = document.getElementById('title')!
const creditEl = document.getElementById('credit')!
const counterEl = document.getElementById('counter')!
const heroEl = document.getElementById('hero')!

;(async () => {
  const hero = await loadHero(asset(avatars, `${pick}.opt.vrm`))
  scene.add(hero.root)
  heroEl.textContent = pick.replace(/_/g, ' ')

  const loaded: Array<Cue & LoadedClip> = []
  for (const cue of CUES) {
    const url = asset(animations, cue.file)
    const got = cue.file.endsWith('.vrma')
      ? await loadVrma(url, hero.vrm)
      : await loadRetargeted(url, hero.vrm)
    loaded.push({ ...cue, ...got })
  }

  const mixer = new THREE.AnimationMixer(hero.vrm.scene)
  const actions = loaded.map((c) => {
    const a = mixer.clipAction(c.clip)
    a.setLoop(THREE.LoopRepeat, Infinity)
    a.clampWhenFinished = false
    a.play()
    a.setEffectiveWeight(0)
    return a
  })

  const FOV = 38
  const cam = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 60)
  /** Distance at which `fit` metres of world height exactly fill the frame. */
  const dolly = (fit: number) => (fit / 2) / Math.tan((FOV / 2) * Math.PI / 180)
  const aim = (fit: number) => {
    // Aim a little above the floor so the feet clear the caption, and hold the
    // three-quarter offset steady so a dolly does not read as a pan.
    const target = fit * 0.30
    cam.position.set(0.8, target + fit * 0.06, dolly(fit))
    cam.lookAt(0, target, 0)
  }

  const CROSS = 0.45
  let shown = -1

  /** Deterministic random access: no clock, no accumulated drift. */
  const setTime = (t: number) => {
    const i = Math.min(loaded.length - 1, Math.floor(t / HOLD))
    const local = t - i * HOLD
    // Fade the outgoing clip out over the first moments of the new one, so a
    // backflip does not teleport out of a charleston.
    const blend = i === 0 ? 1 : Math.min(1, local / CROSS)
    const ease = blend * blend * (3 - 2 * blend)

    for (let k = 0; k < actions.length; k++) {
      const a = actions[k]
      const cue = loaded[k]
      const rate = cue.rate ?? 1
      if (k === i) {
        a.enabled = true
        a.time = (local * rate) % cue.clip.duration
        a.setEffectiveWeight(ease)
      } else if (k === i - 1 && ease < 1) {
        a.enabled = true
        a.time = ((HOLD + local) * rate) % cue.clip.duration
        a.setEffectiveWeight(1 - ease)
      } else {
        a.enabled = false
        a.setEffectiveWeight(0)
      }
    }
    mixer.update(0)
    hero.vrm.update(1 / 30)
    aim(i === 0 ? loaded[0].fit : loaded[i].fit * ease + loaded[i - 1].fit * (1 - ease))

    // The hips move under a jump or a flip; keep the shadow under the feet.
    const hips = hero.rig.nodes.get('hips')
    if (hips) {
      const p = hips.getWorldPosition(new THREE.Vector3())
      blob.position.x = p.x
      blob.position.z = p.z
      const lift = Math.max(0, p.y - hero.height * 0.5)
      blob.scale.setScalar(1 / (1 + lift * 1.6))
      ;(blob.material as THREE.MeshBasicMaterial).opacity = 0.32 / (1 + lift * 2.2)
    }

    if (i !== shown) {
      shown = i
      titleEl.textContent = loaded[i].title
      creditEl.textContent = loaded[i].credit
      counterEl.textContent = `${i + 1} / ${loaded.length}`
    }
    renderer.render(scene, cam)
  }

  ;(window as any).__setTime = setTime
  // Used by tools/animshots.mjs to work out a framing that fits every clip.
  ;(window as any).__extent = () => {
    const box = new THREE.Box3()
    const p = new THREE.Vector3()
    for (const node of hero.rig.nodes.values()) box.expandByPoint(node.getWorldPosition(p))
    const hips = hero.rig.nodes.get('hips')!.getWorldPosition(new THREE.Vector3())
    return { min: box.min.toArray(), max: box.max.toArray(), hips: hips.toArray() }
  }
  ;(window as any).__info = () => ({
    height: hero.height,
    restHipsY: hero.vrm.humanoid.normalizedRestPose.hips!.position![1],
    sceneY: hero.vrm.scene.position.y,
  })
  ;(window as any).__duration = loaded.length * HOLD
  ;(window as any).__clips = loaded.map((c) => ({
    title: c.title, format: c.format, tracks: c.clip.tracks.length, duration: c.clip.duration,
  }))
  setTime(0)
  ;(window as any).__ready = true

  // When opened by hand rather than by the recorder, just play.
  if (!params.has('still')) {
    const t0 = performance.now()
    const loop = () => {
      requestAnimationFrame(loop)
      setTime(((performance.now() - t0) / 1000) % (loaded.length * HOLD))
    }
    if (params.get('live') === '1') loop()
  }
})().catch((e) => {
  titleEl.textContent = 'failed'
  creditEl.textContent = String(e?.message ?? e)
  console.error(e)
})
