/**
 * Closes the loop on scoring, with no clocks in the way.
 *
 * The game's score depends on a long chain: canonical move -> solver -> rig ->
 * pixels -> MoveNet -> skeleton -> scorePose. A bad grade in a recording could
 * come from any link, or simply from the tracker being starved of frames. Here
 * an avatar is posed into each move, rendered, and pushed through the real
 * tracker and the real scorer one move at a time. Whatever this reports is the
 * ceiling the game can reach on a perfect performance.
 */
import * as THREE from 'three'
import { loadHero } from './avatar/loader'
import { PoseSolver } from './pose/solver'
import { MOVES, scorePose, gradeFor } from './pose/moves'
import { PoseTracker } from './pose/tracker'
import { LIMBS } from './pose/keypoints'

const files = import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const params = new URLSearchParams(location.search)
const pick = params.get('a') ?? 'Gingerella'
const W = 640, H = 480

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(W, H); renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace

const scene = new THREE.Scene()
scene.background = new THREE.Color('#93a9c4')
scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2))
const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(1, 3, 4); scene.add(key)

async function loadModelSpec() {
  const res = await fetch('/pose-model.json')
  return res.json()
}

;(async () => {
  const url = Object.entries(files).find(([k]) => k.includes(pick))![1]
  const hero = await loadHero(url)
  scene.add(hero.root)
  // Snap straight to the target: this measures the pose, not the smoothing.
  const solver = new PoseSolver(hero.rig, 1)

  const cam = new THREE.PerspectiveCamera(36, W / H, 0.1, 40)
  cam.position.set(0, hero.height * 0.52, hero.height * 1.72)
  cam.lookAt(0, hero.height * 0.52, 0)

  const tracker = new PoseTracker()
  await tracker.loadModel(await loadModelSpec())

  const rows: unknown[] = []
  for (const move of MOVES) {
    solver.apply(move.skeleton, 1)
    hero.vrm.update(1 / 30)
    renderer.render(scene, cam)

    const seen = await tracker.update(performance.now(), renderer.domElement)
    if (!seen) { rows.push({ move: move.name, error: 'no skeleton' }); continue }

    // Per-limb angle error, so a bad score names the limb that caused it.
    const worst = LIMBS.map(([a, b]) => {
      const v = (s: typeof move.skeleton) => {
        const dx = s[b].x - s[a].x, dy = s[b].y - s[a].y
        const n = Math.hypot(dx, dy) || 1
        return [dx / n, dy / n]
      }
      const [px, py] = v(seen), [qx, qy] = v(move.skeleton)
      const deg = (Math.acos(Math.max(-1, Math.min(1, px * qx + py * qy))) * 180) / Math.PI
      return { limb: `${a}->${b}`, deg: +deg.toFixed(0) }
    }).sort((x, y) => y.deg - x.deg).slice(0, 3)

    const score = scorePose(seen, move.skeleton, move)
    const raw = Object.fromEntries(Object.entries(seen).map(([k, v]) =>
      [k, [+v.x.toFixed(2), +v.y.toFixed(2), +v.score.toFixed(2)]]))
    rows.push({ move: move.name, score: +score.toFixed(2), grade: gradeFor(score), worst, raw })

    // Keep a thumbnail of what the tracker actually saw, for eyeballing.
    const c = document.createElement('canvas')
    c.width = W / 2; c.height = H / 2
    const g = c.getContext('2d')!
    g.drawImage(renderer.domElement, 0, 0, c.width, c.height)
    g.strokeStyle = '#3ddc97'; g.lineWidth = 3; g.lineCap = 'round'
    for (const [a, b] of LIMBS) {
      const p = seen[a], q = seen[b]
      if (p.score < 0.3 || q.score < 0.3) continue
      g.beginPath(); g.moveTo(p.x * c.width, p.y * c.height)
      g.lineTo(q.x * c.width, q.y * c.height); g.stroke()
    }
    g.fillStyle = '#fff'; g.font = 'bold 15px system-ui'
    g.fillText(`${move.name} ${score.toFixed(2)}`, 8, 20)
    c.style.cssText = 'margin:2px;border-radius:6px'
    app.appendChild(c)
  }

  ;(window as unknown as Record<string, unknown>).__rows = rows
  ;(window as unknown as Record<string, unknown>).__ready = true
})()
