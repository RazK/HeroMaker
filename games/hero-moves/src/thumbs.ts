/**
 * The hero portraits used all over the menu.
 *
 * These are renders of the actual rigged avatar, not artwork shipped alongside
 * it — the pipeline's own VRM metadata thumbnail is the 1.4 MB of dead weight
 * `scripts/optimize_vrm.py` strips out, so the picture the picker shows has to
 * be made here. Rendering it ourselves is also what lets it be a *pose* rather
 * than a T-pose, and lets the framing be solved per hero.
 *
 * Framing is the whole job. The roster contains a hero who is wider than they
 * are tall and one whose head is most of their body, so a fixed camera crops
 * somebody every time — the previous set cut the top off the cloud. The camera
 * here is solved from the posed bounding box of each avatar in turn.
 */
import * as THREE from 'three'
import { loadHero } from './avatar/loader'
import { PoseSolver } from './pose/solver'
import { skeletonFromAngles, NEUTRAL_ANGLES, type MoveAngles } from './pose/moves'

const files = import.meta.glob('../assets/avatars/*.opt.vrm', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>

const params = new URLSearchParams(location.search)
const SIZE = Number(params.get('size') ?? 512)
/** Share of the frame the hero fills, on whichever axis is tighter. */
const FILL = Number(params.get('fill') ?? 0.88)

/**
 * A friendly open stance, halfway between the rest T-pose and arms down.
 *
 * A T-pose reads as a rig rather than a character, and arms down hides the
 * hands a child usually drew something onto. This keeps the silhouette compact
 * enough that every hero still fills a square tile.
 */
const PORTRAIT: MoveAngles = {
  ...NEUTRAL_ANGLES,
  leftArm: -28, leftForearm: -30,
  rightArm: 208, rightForearm: 210,
  leftLeg: -78, leftShin: -82, rightLeg: -102, rightShin: -98,
}

const app = document.getElementById('app')!
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setSize(SIZE, SIZE); renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearAlpha(0)
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.add(new THREE.HemisphereLight(0xffffff, 0x99aabb, 2.4))
const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(1.2, 2.4, 3.4)
scene.add(key)

;(async () => {
  const out: Record<string, string> = {}
  const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 60)

  for (const [path, url] of Object.entries(files)) {
    const id = path.split('/').pop()!.replace('.opt.vrm', '')
    const hero = await loadHero(url)
    scene.add(hero.root)
    new PoseSolver(hero.rig, 1).apply(skeletonFromAngles(PORTRAIT), 1)
    hero.vrm.update(1 / 30)
    hero.root.updateMatrixWorld(true)

    // Solve from the box the hero actually occupies in this pose, not from a
    // nominal height: the roster includes a cloud that is wider than it is tall.
    const box = new THREE.Box3().setFromObject(hero.root)
    const size = new THREE.Vector3(); box.getSize(size)
    const centre = new THREE.Vector3(); box.getCenter(centre)
    const half = Math.tan((cam.fov * Math.PI) / 360)
    const span = Math.max(size.x, size.y)
    const d = span / FILL / (2 * half) + size.z
    cam.position.set(centre.x, centre.y, centre.z + d)
    cam.lookAt(centre)
    cam.updateProjectionMatrix()

    renderer.render(scene, cam)
    out[id] = renderer.domElement.toDataURL('image/webp', 0.92)

    scene.remove(hero.root)
    hero.dispose()
  }

  ;(window as unknown as Record<string, unknown>).__thumbs = out
  ;(window as unknown as Record<string, unknown>).__ready = true
})()
