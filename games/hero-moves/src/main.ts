import * as THREE from 'three'
import { Stage } from './stage/stage'
import { PlayCamera } from './stage/camera'
import { loadHero, type Hero } from './avatar/loader'

/** Face-time gate build: stage, front camera, real avatar, nothing else yet. */

const files = import.meta.glob('../public/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const app = document.getElementById('app')!
app.style.cssText = 'position:fixed;inset:0;background:#241b3d'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
app.appendChild(renderer.domElement)
renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'

const scene = new THREE.Scene()
const stage = new Stage()
scene.add(stage.group)
const play = new PlayCamera()

let hero: Hero | null = null

function resize() {
  const w = app.clientWidth, h = app.clientHeight
  renderer.setSize(w, h, false)
  if (hero) play.frame({ heroHeight: hero.height, aspect: w / h, portrait: h > w })
}
addEventListener('resize', resize)

let last = performance.now()
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  const beat = (now / 1000 / 0.5) % 1
  stage.update(dt, beat)
  play.update(dt, beat)
  if (hero) hero.vrm.update(dt)
  renderer.render(scene, play.camera)
})

;(async () => {
  const pick = new URLSearchParams(location.search).get('a') ?? 'Crayon_Kid'
  const url = Object.entries(files).find(([k]) => k.includes(pick))![1]
  hero = await loadHero(url)
  // Face the audience.
  hero.root.rotation.y = 0
  scene.add(hero.root)
  resize()
  ;(window as any).__heroHeight = hero.height
  ;(window as any).__frontAngle = play.frontAngle(new THREE.Vector3(0, 0, 1))
  ;(window as any).__ready = true
})()
