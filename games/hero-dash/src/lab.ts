/** Dev-only contact sheet of every animation state, for eyeballing the rig. */
import * as THREE from 'three'
import { loadHero } from './avatar/loader'
import type { AnimState } from './avatar/animator'

const params = new URLSearchParams(location.search)
const avatar = params.get('a') ?? 'Crayon_Kid'
const view = params.get('v') ?? 'front'
const files = import.meta.glob('../public/avatars/*.opt.vrm', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const url = Object.entries(files).find(([k]) => k.includes(avatar))![1]

const CELLS: Array<{ label: string; state: AnimState; phase?: number; t?: number; jump?: number }> = [
  { label: 'idle', state: 'idle', t: 1.2 },
  { label: 'run .00', state: 'run', phase: 0.0 },
  { label: 'run .25', state: 'run', phase: 0.25 },
  { label: 'run .50', state: 'run', phase: 0.5 },
  { label: 'run .75', state: 'run', phase: 0.75 },
  { label: 'jump rise', state: 'jump', jump: 0.55 },
  { label: 'jump apex', state: 'jump', jump: 1.0 },
  { label: 'jump land', state: 'jump', jump: 1.85 },
  { label: 'slide', state: 'slide', t: 0.4 },
  { label: 'star pose', state: 'pose', t: 0.3 },
  { label: 'fly', state: 'fly', t: 1.0 },
  { label: 'stumble', state: 'stumble', t: 0.25 },
  { label: 'victory', state: 'victory', t: 1.6 },
]

const W = 260, H = 340
const app = document.getElementById('app')!
app.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:2px;font:12px sans-serif'
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
r.setSize(W, H); r.setPixelRatio(1)
r.outputColorSpace = THREE.SRGBColorSpace

;(async () => {
  const hero = await loadHero(url, { outline: false })
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#dff0ff')
  scene.add(new THREE.HemisphereLight(0xffffff, 0x99aabb, 2.3))
  const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(2, 4, 3); scene.add(d)
  scene.add(hero.root)
  const grid = new THREE.GridHelper(6, 12, 0x777777, 0xbbbbbb); scene.add(grid)
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 40)

  // 'front' looks the hero in the face; 'side' shows the stride profile.
  if (view === 'side') cam.position.set(4.2, 1.05, 0.2)
  else if (view === 'back') cam.position.set(0.9, 1.15, -4.0)
  else cam.position.set(1.1, 1.15, 3.9)
  cam.lookAt(0, 0.85, 0)

  for (const c of CELLS) {
    const a = hero.animator
    a.state = c.state
    a.phase = c.phase ?? 0
    a.jumpProgress = c.jump ?? 0
    a.setIntensity(0.75)
    ;(a as any).stateTime = c.t ?? 0
    a.update(1 / 60, c.t ?? 0)
    a.reset()
    a.update(1 / 60, c.t ?? 0)   // second pass so the snap lands on the target
    hero.vrm.update(1 / 60)
    r.render(scene, cam)
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:relative;background:#dff0ff'
    const img = new Image(); img.src = r.domElement.toDataURL('image/png'); img.width = W; img.height = H
    const label = document.createElement('div')
    label.textContent = c.label
    label.style.cssText = 'position:absolute;left:5px;bottom:3px;font-weight:800;color:#123;text-shadow:0 1px 0 #fff'
    wrap.append(img, label); app.appendChild(wrap)
  }
  await new Promise((res) => setTimeout(res, 400))
  ;(window as any).__ready = true
})()
