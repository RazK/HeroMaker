import * as THREE from 'three'
import { makeRng } from '../core/math'

/**
 * The set the hero performs on.
 *
 * Framing is the whole point of this game: a HeroMaker avatar is drawn from the
 * front by a child, so the camera lives in front of the hero and stays there.
 * Everything here exists to push the eye at the avatar's face and silhouette —
 * a warm key light that never lets the face fall into shadow, a dark backdrop
 * for contrast, and footlights that separate the legs from the floor so
 * footwork reads.
 */

export const STAGE = {
  /** Radius of the performance disc. */
  floorRadius: 3.2,
  backdropRadius: 16,
} as const

function paperTexture(base: string, grain: number, size = 256): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = base
  g.fillRect(0, 0, size, size)
  const img = g.getImageData(0, 0, size, size)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * grain
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Wonky geometry: a perfect shape looks CG, a hand-cut one looks made. */
function wobble(geo: THREE.BufferGeometry, amount: number, seed: number) {
  const rng = makeRng(seed)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) + (rng() - 0.5) * amount,
      pos.getY(i) + (rng() - 0.5) * amount,
      pos.getZ(i) + (rng() - 0.5) * amount)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

export class Stage {
  readonly group = new THREE.Group()
  readonly keyLight: THREE.DirectionalLight
  private bulbs: THREE.Mesh[] = []

  constructor() {
    // Backdrop: a deep curtain so a brightly-drawn hero pops off it.
    const backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(STAGE.backdropRadius, 32, 16),
      new THREE.MeshBasicMaterial({ color: '#2b1f47', side: THREE.BackSide, fog: false }),
    )
    this.group.add(backdrop)

    // Curtain folds, flat wedges around the back half.
    const foldMat = new THREE.MeshStandardMaterial({
      color: '#6b3080', roughness: 1, metalness: 0, map: paperTexture('#ffffff', 22),
    })
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI * 0.15 + (i / 13) * Math.PI * 1.3
      const w = 1.5 + (i % 3) * 0.35
      const fold = new THREE.Mesh(new THREE.PlaneGeometry(w, 11), foldMat)
      fold.position.set(Math.sin(a) * 8.5, 4.2, Math.cos(a) * 8.5)
      fold.lookAt(0, 4.2, 0)
      this.group.add(fold)
    }

    // Performance disc.
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#e8cfa6', roughness: 0.86, metalness: 0,
      map: paperTexture('#ffffff', 26),
      emissive: '#3a2547', emissiveIntensity: 0.35,
    })
    floorMat.map!.repeat.set(4, 4)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(STAGE.floorRadius, 48), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.group.add(floor)

    // Spotlight pool: a soft warm disc under the performer.
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(STAGE.floorRadius * 0.62, 40),
      new THREE.MeshBasicMaterial({ color: '#fff0cf', transparent: true, opacity: 0.34 }),
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.y = 0.012
    this.group.add(pool)

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(STAGE.floorRadius, 0.07, 8, 56),
      new THREE.MeshStandardMaterial({ color: '#ff5c8a', roughness: 0.6 }),
    )
    rim.rotation.x = -Math.PI / 2
    rim.position.y = 0.02
    this.group.add(rim)

    // Footlights along the front edge. They separate the hero's feet from the
    // floor, which is what makes footwork legible.
    const bulbGeo = wobble(new THREE.SphereGeometry(0.11, 10, 8), 0.02, 7)
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI * 0.42 + (i / 8) * Math.PI * 0.84
      const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshStandardMaterial({
        color: '#ffd23f', emissive: '#ffb020', emissiveIntensity: 1.1, roughness: 0.5,
      }))
      bulb.position.set(
        Math.sin(a) * (STAGE.floorRadius + 0.34), 0.11,
        Math.cos(a) * (STAGE.floorRadius + 0.34))
      this.group.add(bulb)
      this.bulbs.push(bulb)
    }

    // Key light sits front-and-slightly-above on purpose: the face is the thing
    // the child drew, so it never falls into shadow.
    this.group.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a2b4d, 0.85))
    this.keyLight = new THREE.DirectionalLight(0xfff3e0, 2.5)
    this.keyLight.position.set(0.9, 3.4, 4.2)
    this.keyLight.castShadow = true
    this.keyLight.shadow.mapSize.set(1024, 1024)
    this.keyLight.shadow.camera.near = 1
    this.keyLight.shadow.camera.far = 14
    const sc = this.keyLight.shadow.camera as THREE.OrthographicCamera
    sc.left = -3; sc.right = 3; sc.top = 4; sc.bottom = -1
    sc.updateProjectionMatrix()
    this.keyLight.shadow.bias = -0.0015
    this.group.add(this.keyLight)

    // Rim lights pick the silhouette out against the curtain.
    const rimL = new THREE.DirectionalLight(0x7ad7ff, 1.5); rimL.position.set(-4, 2.6, -2.4)
    const rimR = new THREE.DirectionalLight(0xff8fc7, 1.5); rimR.position.set(4, 2.6, -2.4)
    this.group.add(rimL, rimR)
  }

  /** Footlights chase around the stage on the beat. `phase` is 0..1 per beat. */
  update(_dt: number, phase: number) {
    for (let i = 0; i < this.bulbs.length; i++) {
      const m = this.bulbs[i].material as THREE.MeshStandardMaterial
      const offset = (i / this.bulbs.length) * 0.35
      m.emissiveIntensity = 0.75 + 0.65 * Math.max(0, Math.cos((phase - offset) * Math.PI * 2))
    }
  }
}
