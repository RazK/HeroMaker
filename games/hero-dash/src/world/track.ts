import * as THREE from 'three'
import { CFG, laneX, roadWidth } from '../game/config'
import { crayonMaterial, makeCloud, makeHill, makeTree, starGeometry } from './props'
import { CRAYON } from './materials'
import { makeRng } from '../core/math'

export type ObstacleKind = 'low' | 'high' | 'full' | 'gate'

const SCENERY_START = 4

export interface Entity {
  kind: ObstacleKind | 'star'
  object: THREE.Object3D
  lane: number
  z: number
  /** Cleared/collected already — kept in the scene but no longer collidable. */
  done: boolean
  spin?: number
  /** Own material instance for the props that need a proximity fade. */
  fadeMat?: THREE.MeshStandardMaterial
}

/**
 * Limbo bar: a crossbar on two posts, authored from the ground up so the gap
 * underneath reads unmistakably as "slide", not "jump".
 */
function limboGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const bar = new THREE.BoxGeometry(1.9, 0.62, 0.42)
  bar.translate(0, 2.05, 0)
  parts.push(bar)
  for (const side of [-1, 1]) {
    const post = new THREE.BoxGeometry(0.19, 2.36, 0.19)
    post.translate(side * 0.86, 1.18, 0)
    parts.push(post)
  }
  const flag = new THREE.BoxGeometry(1.9, 0.16, 0.5)
  flag.translate(0, 1.66, 0)
  parts.push(flag)
  return mergeGeometries(parts)
}

/** Minimal geometry merge — enough for these small, uniform-attribute parts. */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry()
  const names = ['position', 'normal', 'uv']
  let indexOffset = 0
  const indices: number[] = []
  const buffers: Record<string, number[]> = { position: [], normal: [], uv: [] }
  for (const part of parts) {
    const pos = part.getAttribute('position')
    for (const name of names) {
      const attr = part.getAttribute(name)
      const arr = buffers[name]
      for (let i = 0; i < attr.count * attr.itemSize; i++) arr.push((attr.array as ArrayLike<number>)[i])
    }
    const idx = part.getIndex()!
    for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + indexOffset)
    indexOffset += pos.count
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(buffers.position, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normal, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uv, 2))
  out.setIndex(indices)
  return out
}

/** A wall spanning the road with a star-shaped hole punched through it. */
function gateGeometry(): THREE.BufferGeometry {
  const w = roadWidth * 0.5 + 0.4, h = 3.4
  const shape = new THREE.Shape()
  shape.moveTo(-w, 0); shape.lineTo(w, 0); shape.lineTo(w, h); shape.lineTo(-w, h); shape.closePath()

  // The hole is a big five-point star: the shape the player has to make.
  const hole = new THREE.Path()
  const cx = 0, cy = 1.72, outer = 1.42, inner = 0.60
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2
    const r = i % 2 === 0 ? outer : inner
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
    if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y)
  }
  hole.closePath()
  shape.holes.push(hole)
  return new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: false })
}

export class Track {
  readonly group = new THREE.Group()
  readonly entities: Entity[] = []
  private pool = new Map<string, THREE.Object3D[]>()
  private geo: Record<string, THREE.BufferGeometry>
  private mats: Record<string, THREE.Material>
  private nextZ = CFG.graceDistance
  private rng = makeRng(1)
  private scenery: THREE.Object3D[] = []
  /**
   * Scenery starts just ahead of the start line. The menu camera looks back
   * down the road at the hero, and anything generated behind them lines up
   * with their silhouette — a tree growing out of the hero's head.
   */
  private sceneryZ = SCENERY_START
  private road!: THREE.Mesh
  private ground!: THREE.Mesh

  constructor(private roadTex: THREE.Texture) {
    this.geo = {
      low: new THREE.BoxGeometry(1.62, 0.85, 0.9),
      high: limboGeometry(),
      full: new THREE.BoxGeometry(1.66, 2.7, 0.8),
      gate: gateGeometry(),
      star: starGeometry(),
    }
    this.mats = {
      low: crayonMaterial(CRAYON.obstacle[0]),
      high: crayonMaterial(CRAYON.obstacle[1]),
      full: crayonMaterial(CRAYON.obstacle[2]),
      gate: crayonMaterial(CRAYON.gate, { flat: false }),
      star: new THREE.MeshStandardMaterial({
        color: CRAYON.star, roughness: 0.35, metalness: 0.15,
        emissive: '#8a6300', emissiveIntensity: 0.55, flatShading: true,
      }),
    }
    this.buildGround()
  }

  private buildGround() {
    // Only as long as the fog is deep. A 1400 m plane wrecks depth precision
    // and the road starts z-fighting its way under the grass.
    const LENGTH = 460

    const groundMat = crayonMaterial('#8fce6a', { flat: false })
    groundMat.map!.repeat.set(60, 80)
    // Belt and braces: also bias the grass away from the road.
    groundMat.polygonOffset = true
    groundMat.polygonOffsetFactor = 1
    groundMat.polygonOffsetUnits = 1
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(520, LENGTH), groundMat)
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.y = -0.06
    this.ground.receiveShadow = true
    this.ground.renderOrder = -2
    this.group.add(this.ground)

    const roadMat = new THREE.MeshStandardMaterial({
      map: this.roadTex, roughness: 0.97, metalness: 0,
    })
    this.roadTex.repeat.set(1, LENGTH / 12)
    this.road = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, LENGTH), roadMat)
    this.road.rotation.x = -Math.PI / 2
    this.road.receiveShadow = true
    this.road.renderOrder = -1
    this.group.add(this.road)
  }

  reset(seed: number) {
    this.rng = makeRng(seed)
    for (const e of this.entities) this.release(e)
    this.entities.length = 0
    this.nextZ = CFG.graceDistance
    for (const s of this.scenery) this.group.remove(s)
    this.scenery.length = 0
    this.sceneryZ = SCENERY_START
  }

  /** Tall props get their own material so they can fade as the camera nears. */
  private static needsFade(kind: string) { return kind === 'gate' || kind === 'full' }

  private take(kind: string): THREE.Object3D {
    const bucket = this.pool.get(kind)
    const reused = bucket?.pop()
    if (reused) { reused.visible = true; return reused }
    const material = Track.needsFade(kind)
      ? (this.mats[kind] as THREE.MeshStandardMaterial).clone()
      : this.mats[kind]
    const mesh = new THREE.Mesh(this.geo[kind], material)
    mesh.castShadow = true
    mesh.receiveShadow = false
    return mesh
  }

  private release(e: Entity) {
    e.object.visible = false
    this.group.remove(e.object)
    const bucket = this.pool.get(e.kind) ?? []
    bucket.push(e.object)
    this.pool.set(e.kind, bucket)
  }

  private spawn(kind: Entity['kind'], lane: number, z: number) {
    const object = this.take(kind)
    const x = kind === 'gate' ? 0 : laneX(lane)
    const y = kind === 'star' ? 1.15
      : kind === 'low' ? 0.48
      : kind === 'high' ? 2.05
      : kind === 'full' ? 1.3
      : 0
    object.position.set(x, y, z)
    object.rotation.set(0, 0, 0)
    if (kind !== 'gate' && kind !== 'star') {
      object.rotation.y = (this.rng() - 0.5) * 0.18
      object.rotation.z = (this.rng() - 0.5) * 0.09
    }
    this.group.add(object)
    const e: Entity = { kind, object, lane, z, done: false }
    if (Track.needsFade(kind)) {
      e.fadeMat = (object as THREE.Mesh).material as THREE.MeshStandardMaterial
      e.fadeMat.transparent = true
      e.fadeMat.depthWrite = true
      e.fadeMat.opacity = 1
    }
    if (kind === 'star') e.spin = this.rng() * Math.PI * 2
    this.entities.push(e)
  }

  /** One row of track content. Difficulty scales what's allowed to appear. */
  private generateSlice(z: number, difficulty: number) {
    const r = this.rng()
    const lanes = [0, 1, 2]

    if (difficulty > 0.30 && r < 0.13) {
      // Pose gate: the whole road is blocked except the star-shaped hole.
      this.spawn('gate', 1, z)
      for (const l of lanes) if (this.rng() < 0.5) this.spawn('star', l, z + 5.5)
      return
    }

    if (r < 0.30) {
      // Star arc — a reward line, sometimes floating over a low obstacle.
      const lane = Math.floor(this.rng() * 3)
      const count = 3 + Math.floor(this.rng() * 4)
      for (let i = 0; i < count; i++) this.spawn('star', lane, z + i * 1.9)
      if (difficulty > 0.2 && this.rng() < 0.45) this.spawn('low', lane, z + (count - 1) * 0.95)
      return
    }

    // Obstacle row: never block every lane at once.
    const blocked = new Set<number>()
    const maxBlocked = difficulty < 0.25 ? 1 : difficulty < 0.6 ? 2 : this.rng() < 0.25 ? 2 : 1
    const kinds: ObstacleKind[] = difficulty < 0.15
      ? ['low', 'full']
      : difficulty < 0.45 ? ['low', 'high', 'full'] : ['low', 'high', 'full', 'low', 'high']

    for (const lane of lanes) {
      if (blocked.size >= maxBlocked) break
      if (this.rng() > 0.5) continue
      const kind = kinds[Math.floor(this.rng() * kinds.length)]
      this.spawn(kind, lane, z + (this.rng() - 0.5) * 1.4)
      blocked.add(lane)
    }
    if (blocked.size === 0) this.spawn(kinds[Math.floor(this.rng() * kinds.length)], Math.floor(this.rng() * 3), z)

    for (const lane of lanes) {
      if (blocked.has(lane) || this.rng() > 0.55) continue
      const count = 2 + Math.floor(this.rng() * 3)
      for (let i = 0; i < count; i++) this.spawn('star', lane, z + i * 1.9)
    }
  }

  private generateScenery(untilZ: number) {
    while (this.sceneryZ < untilZ) {
      this.sceneryZ += 5 + this.rng() * 7
      const seed = Math.floor(this.sceneryZ * 977) + 1
      for (const side of [-1, 1]) {
        const roll = this.rng()
        let obj: THREE.Object3D | null = null
        // Trees hug the road for a tunnel feel; hills have to clear their own
        // radius or they swallow the track.
        let offset = roadWidth / 2 + 1.4 + this.rng() * 4
        if (roll < 0.62) obj = makeTree(seed + (side > 0 ? 7 : 13))
        else if (roll < 0.86) {
          obj = makeHill(seed + (side > 0 ? 31 : 41))
          const r = (obj as THREE.Mesh).geometry.boundingSphere?.radius
            ?? ((obj as THREE.Mesh).geometry.computeBoundingSphere(), (obj as THREE.Mesh).geometry.boundingSphere!.radius)
          offset = roadWidth / 2 + r * 0.92 + 4 + this.rng() * 22
        } else {
          obj = makeCloud(seed + (side > 0 ? 53 : 61))
          obj.position.y = 14 + this.rng() * 13
          offset = roadWidth / 2 + 6 + this.rng() * 26
        }
        if (!obj) continue
        obj.position.x = side * offset
        obj.position.z = this.sceneryZ
        obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = roll < 0.62 })
        this.group.add(obj)
        this.scenery.push(obj)
      }
    }
  }

  update(playerZ: number, difficulty: number, dt: number) {
    // Ground and road follow the player; the road texture scrolls to match.
    // Bias forward: almost all of the visible plane is ahead of the player.
    this.ground.position.z = playerZ + 150
    this.road.position.z = playerZ + 150
    this.roadTex.offset.y = -playerZ / 12

    while (this.nextZ < playerZ + CFG.spawnAhead) {
      this.generateSlice(this.nextZ, difficulty)
      this.nextZ += CFG.sliceGap * (1.55 - 0.62 * difficulty)
    }
    this.generateScenery(playerZ + CFG.spawnAhead + 60)

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i]
      if (e.kind === 'star' && !e.done) {
        e.spin! += dt * 2.6
        e.object.rotation.y = e.spin!
        e.object.position.y = 1.15 + Math.sin(e.spin! * 1.4) * 0.14
      }
      if (e.fadeMat) {
        // A full-width wall right in front of the chase camera would blind the
        // player, so dissolve it the moment they are through it.
        const fade = Math.max(0, Math.min(1, (e.z - playerZ - 0.1) / 2.4))
        e.fadeMat.opacity = fade
        e.object.visible = fade > 0.02
      }
      if (e.z < playerZ - CFG.despawnBehind) {
        this.release(e)
        this.entities.splice(i, 1)
      }
    }

    for (let i = this.scenery.length - 1; i >= 0; i--) {
      if (this.scenery[i].position.z < playerZ - 60) {
        this.group.remove(this.scenery[i])
        this.scenery.splice(i, 1)
      }
    }
  }
}
