/** Dev-only: renders each roster hero to a data URL for the avatar picker. */
import * as THREE from 'three'
import { loadHero } from './avatar/loader'
import { ROSTER } from './game/roster'
import { starPose } from './avatar/poses'

const S = 256
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true })
r.setSize(S, S); r.setPixelRatio(2)
r.outputColorSpace = THREE.SRGBColorSpace

;(async () => {
  const out: Record<string, string> = {}
  for (const entry of ROSTER) {
    const hero = await loadHero(entry.url, { outline: false })
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa8c0d8, 2.4))
    const d = new THREE.DirectionalLight(0xffffff, 1.7); d.position.set(1.6, 3, 3); scene.add(d)
    scene.add(hero.root)

    // A relaxed hero stance reads better in a 256px chip than a T-pose.
    const a = hero.animator
    a.state = 'pose'
    ;(a as any).stateTime = 0.4
    a.update(1 / 60, 0.4); a.reset(); a.update(1 / 60, 0.4)
    hero.vrm.update(1 / 60)

    const box = new THREE.Box3().setFromObject(hero.root)
    const size = new THREE.Vector3(); box.getSize(size)
    const centre = new THREE.Vector3(); box.getCenter(centre)
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 40)
    const dist = (Math.max(size.x, size.y) * 0.62) / Math.tan((30 * Math.PI) / 360)
    cam.position.set(centre.x + dist * 0.16, centre.y + size.y * 0.06, centre.z + dist)
    cam.lookAt(centre)

    r.render(scene, cam)
    out[entry.id] = r.domElement.toDataURL('image/webp', 0.86)
    hero.dispose()
  }
  ;(window as any).__thumbs = out
  ;(window as any).__ready = true
})()
