/** Dev sheet: every move, posed on a real avatar through the real solver. */
import * as THREE from 'three'
import { loadHero } from './avatar/loader'
import { PoseSolver } from './pose/solver'
import { MOVES } from './pose/moves'

const files = import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const params = new URLSearchParams(location.search)
const pick = params.get('a') ?? 'Crayon_Kid'
const W = 250, H = 330
const app = document.getElementById('app')!
app.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:2px;font:12px sans-serif'

const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
r.setSize(W, H); r.setPixelRatio(1); r.outputColorSpace = THREE.SRGBColorSpace

;(async () => {
  const url = Object.entries(files).find(([k]) => k.includes(pick))![1]
  const hero = await loadHero(url)
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#dfeffd')
  scene.add(new THREE.HemisphereLight(0xffffff, 0x99aabb, 2.3))
  const d = new THREE.DirectionalLight(0xffffff, 1.7); d.position.set(1, 3, 4); scene.add(d)
  scene.add(hero.root)

  const cam = new THREE.PerspectiveCamera(34, W / H, 0.1, 40)
  cam.position.set(0, hero.height * 0.5, hero.height * 1.85)
  cam.lookAt(0, hero.height * 0.5, 0)

  // Snap straight to each pose: no smoothing, so what is drawn is what the
  // solver produced for that move and nothing left over from the last one.
  const solver = new PoseSolver(hero.rig, 1)

  for (const move of MOVES) {
    for (let i = 0; i < 4; i++) solver.apply(move.skeleton, 1)
    hero.vrm.update(1 / 60)
    r.render(scene, cam)
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:relative;background:#dfeffd'
    const img = new Image(); img.src = r.domElement.toDataURL('image/png'); img.width = W; img.height = H
    const label = document.createElement('div')
    label.textContent = move.name
    label.style.cssText = 'position:absolute;left:6px;bottom:4px;font-weight:800;color:#123;text-shadow:0 1px 0 #fff'
    wrap.append(img, label); app.appendChild(wrap)
  }
  await new Promise((res) => setTimeout(res, 400))
  ;(window as any).__ready = true
})()
