import * as THREE from 'three'
import { createBackdrop, type Backdrop } from '../stage/backdrops'
import type { StageEnv } from '../stage/env'

/**
 * The film's sound stage: the game's six painted sets and the lights in them.
 *
 * `Stage` (src/stage/stage.ts) builds one backdrop at a time and throws the old
 * one away, which is right for a menu and wrong for a film that cuts between
 * three sets in forty seconds. Here every set the script names is built once,
 * up front, and a cut only flips which one is visible — so a cut costs nothing
 * on a phone and the frame-stepped renderer never repaints a canvas mid-film.
 */
export class FilmSet {
  readonly group = new THREE.Group()
  readonly key: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private rims: [THREE.DirectionalLight, THREE.DirectionalLight]
  /** A soft light from the camera's side, so the drawn face is never in shadow. */
  private face: THREE.DirectionalLight
  private sets = new Map<string, Backdrop>()
  private current: string | null = null

  constructor(ids: string[]) {
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a2b4d, 0.85)
    this.key = new THREE.DirectionalLight(0xfff3e0, 2.5)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(1024, 1024)
    this.key.shadow.camera.near = 1
    this.key.shadow.camera.far = 14
    const sc = this.key.shadow.camera as THREE.OrthographicCamera
    sc.left = -3; sc.right = 3; sc.top = 4; sc.bottom = -1
    sc.updateProjectionMatrix()
    this.key.shadow.bias = -0.0015
    this.rims = [new THREE.DirectionalLight(0x7ad7ff, 1.5), new THREE.DirectionalLight(0xff8fc7, 1.5)]
    this.face = new THREE.DirectionalLight(0xffffff, 0.55)
    this.group.add(this.hemi, this.key, this.rims[0], this.rims[1], this.face, this.face.target)
    for (const id of new Set(ids)) {
      const b = createBackdrop(id, 'full')
      b.group.visible = false
      this.group.add(b.group)
      this.sets.set(id, b)
    }
  }

  show(id: string) {
    if (id === this.current) return
    for (const [k, b] of this.sets) b.group.visible = k === id
    this.current = id
    const b = this.sets.get(id)
    if (b) this.apply(b.env)
  }

  private apply(env: StageEnv) {
    this.hemi.color.set(env.hemi.sky)
    this.hemi.groundColor.set(env.hemi.ground)
    this.hemi.intensity = env.hemi.intensity
    this.key.color.set(env.key.color)
    this.key.intensity = env.key.intensity
    this.key.position.set(...env.key.position)
    env.rims.forEach((r, i) => {
      this.rims[i].color.set(r.color)
      this.rims[i].intensity = r.intensity
      this.rims[i].position.set(...r.position)
    })
  }

  /** Keep the face light beside the camera, a little above it. */
  follow(camera: THREE.Camera, target: THREE.Vector3) {
    this.face.position.copy(camera.position).add(new THREE.Vector3(0, 0.6, 0))
    this.face.target.position.copy(target)
  }

  update(dt: number, phase: number) {
    if (this.current) this.sets.get(this.current)?.update(dt, phase)
  }

  dispose() {
    for (const b of this.sets.values()) b.dispose()
    this.sets.clear()
  }
}
