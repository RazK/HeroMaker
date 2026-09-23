/**
 * The gate: can the tracker actually tell the vocabulary apart?
 *
 * `PLAYBOOK.md` records the rule this exists to satisfy — measure the ceiling
 * of any scored system in isolation, by feeding it a known-perfect input
 * through the real code path. A grading system that has never been shown a
 * right answer is not known to have one.
 *
 * So: pose an avatar into each call, render it, and push the frame through the
 * real MoveNet and the real classifier. Every avatar, at several distances and
 * a few degrees off-centre, because a child does not stand on a mark. What
 * comes out is a confusion matrix, and it decides whether a call-and-freeze
 * game is buildable before any of it is written.
 */
import * as THREE from 'three'
import { loadHero } from './avatar/loader'
import { PoseSolver } from './pose/solver'
import { PoseTracker } from './pose/tracker'
import { VOCAB, nearest, classify, vocabularySeparation } from './pose/vocab'

const files = import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const params = new URLSearchParams(location.search)
const only = params.get('a')
const W = 480, H = 480

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H); renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace

const scene = new THREE.Scene()
scene.background = new THREE.Color('#93a9c4')
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2))
const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(1, 3, 4); scene.add(key)

/**
 * The spread a real player introduces: nearer and further from the camera, and
 * a little off-axis. Testing only the dead-centre case would flatter the
 * classifier in exactly the way a real living room does not.
 */
const VIEWS = [
  { dist: 1.55, az: 0 },
  { dist: 1.9, az: 0 },
  { dist: 1.72, az: 12 },
  { dist: 1.72, az: -12 },
  { dist: 2.3, az: 6 },
]

async function loadModelSpec() {
  const res = await fetch('/pose-model.json')
  return res.json()
}

;(async () => {
  const tracker = new PoseTracker()
  await tracker.loadModel(await loadModelSpec())

  const names = Object.keys(files)
    .map((k) => k.split('/').pop()!.replace('.opt.vrm', ''))
    .filter((n) => !only || n === only)

  const rows: unknown[] = []

  for (const name of names) {
    const url = Object.entries(files).find(([k]) => k.includes(`${name}.opt.vrm`))![1]
    const hero = await loadHero(url)
    scene.add(hero.root)
    // Snap straight to the target: this measures the pose, not the smoothing.
    const solver = new PoseSolver(hero.rig, 1)
    const cam = new THREE.PerspectiveCamera(36, W / H, 0.1, 40)

    for (const p of VOCAB) {
      solver.apply(p.skeleton, 1)
      hero.vrm.update(1 / 30)

      for (const v of VIEWS) {
        const rad = (v.az * Math.PI) / 180
        const d = hero.height * v.dist
        cam.position.set(Math.sin(rad) * d, hero.height * 0.52, Math.cos(rad) * d)
        cam.lookAt(0, hero.height * 0.52, 0)
        renderer.render(scene, cam)

        const seen = await tracker.update(performance.now(), renderer.domElement)
        const guess = seen ? nearest(seen) : null
        const gated = seen ? classify(seen) : null
        rows.push({
          avatar: name, want: p.id, got: guess?.id ?? null,
          accepted: gated?.pose?.id ?? null,
          distance: gated ? +gated.distance.toFixed(3) : null,
          margin: gated && Number.isFinite(gated.margin) ? +gated.margin.toFixed(3) : null,
          view: `${v.dist}/${v.az}`,
        })
      }
    }
    scene.remove(hero.root)
    hero.dispose()
    ;(window as unknown as Record<string, unknown>).__progress = rows.length
  }

  ;(window as unknown as Record<string, unknown>).__rows = rows
  ;(window as unknown as Record<string, unknown>).__separation = vocabularySeparation()
  ;(window as unknown as Record<string, unknown>).__ready = true
})()
