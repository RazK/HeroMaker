import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * The play-room: a toy-box floor with a low wall round it, the toy chest the
 * robots are after at the back, lights, and a painted contact shadow kit.
 *
 * Everything is built from primitives and canvas paint at boot — nothing is
 * downloaded, and the whole room is ~20 draw calls. Shadows are painted blobs,
 * not shadow maps: one skinned hero plus a dozen toys must hold 60 fps on a
 * mid phone, and a blob under a hero whose feet are a cloud reads better than
 * a real shadow anyway.
 */

/** Half-extents of the floor the hero and the toys can stand on, in metres. */
export const ARENA = { minX: -4.6, maxX: 4.6, minZ: -3.2, maxZ: 3.4 }
/** Where the toy chest sits — the robots walk here. */
export const CHEST = new THREE.Vector3(0, 0, -3.95)

/**
 * The four big letter blocks behind the back edge, H E R O, as [x, z, yaw]:
 * scenery, and the high seats the crowd stands on either side of the chest,
 * where even a phone's narrow portrait view sees them.
 */
export const BACK_BLOCKS: [number, number, number][] = [
  [-3.25, ARENA.minZ - 1.12, -0.35], [-2.2, ARENA.minZ - 1.05, -0.1],
  [2.2, ARENA.minZ - 1.05, 0.15], [3.25, ARENA.minZ - 1.12, 0.4],
]
/** Their size: a block is this tall, and a fan stands on its top. */
export const BLOCK_SIZE = 0.8

/**
 * The grandstand: two stepped rows of toy blocks between the letter blocks
 * and the papered back wall, where the crowd sits like an audience. Shallow on
 * purpose: a phone in portrait sees the back of the room up to about 3 m high
 * whatever its depth, so the closer the wall, the bigger the drawings pinned
 * on it look.
 */
export const STAND = {
  /** Half its width: within the court's, and in a portrait phone's shot. */
  halfWidth: 3.6,
  /** Each row: its centre line front to back, and the height of its top. */
  rows: [
    { z: ARENA.minZ - 1.88, top: 0.4 },
    { z: ARENA.minZ - 2.33, top: 0.75 },
  ],
  depth: 0.45,
  /** The papered wall right behind the top row, where the drawings hang. */
  wallZ: ARENA.minZ - 2.6,
  /** The wall's half-width and height. Tall enough for a portrait shot, which sees it up to ~3.6 m. */
  wallHalfWidth: (ARENA.maxX - ARENA.minX + 0.6) / 2 + 1.2,
  wallHeight: 4,
}

/** Toy Box palette, as linear-ready hex for materials. */
export const PAL = {
  grape: 0x5b3df5,
  grapeDeep: 0x3a22b8,
  sun: 0xffc233,
  sunDeep: 0xd99a00,
  ink: 0x231942,
  cream: 0xfff6e9,
  line: 0xeadfcb,
  red: 0xe5484d,
  green: 0x15997a,
  mint: 0xcff5ea,
  sky: 0xd6ecff,
  peach: 0xffdcc7,
  pink: 0xffd6e7,
  lilac: 0xe9e3ff,
  butter: 0xffe9a8,
}

function canvasTexture(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  paint(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** One soft round shadow texture, shared by every blob in the room. */
let blobTex: THREE.Texture | null = null
export function blobTexture() {
  blobTex ??= canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(35,25,66,0.42)')
    grad.addColorStop(0.55, 'rgba(35,25,66,0.22)')
    grad.addColorStop(1, 'rgba(35,25,66,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 64, 64)
  })
  return blobTex
}
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
let blobMat: THREE.MeshBasicMaterial | null = null
export function makeBlob(size: number) {
  blobMat ??= new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false })
  const m = new THREE.Mesh(blobGeo, blobMat)
  m.scale.setScalar(size)
  m.position.y = 0.006
  m.renderOrder = -2
  return m
}

export class World {
  readonly scene = new THREE.Scene()
  readonly chest: THREE.Group
  private chestLid: THREE.Object3D
  private wobble = 0

  constructor() {
    const s = this.scene
    s.background = new THREE.Color(PAL.cream)
    s.fog = new THREE.Fog(PAL.cream, 16, 30)

    // Light from the front and above, the side the child drew. The face never
    // falls into shadow whichever way the hero turns, because the camera and
    // the key are on the same side.
    s.add(new THREE.HemisphereLight(0xffffff, 0xf3dcc0, 1.25))
    const key = new THREE.DirectionalLight(0xfff3e0, 1.9)
    key.position.set(2, 6, 7)
    s.add(key)
    const rim = new THREE.DirectionalLight(0xe9e3ff, 0.9)
    rim.position.set(-4, 3, -5)
    s.add(rim)

    // ---- floor: a foam play-mat of one-metre tiles. Big, high-contrast
    // squares are what make running read as running: the floor visibly
    // slides under a camera that follows the hero.
    const W = ARENA.maxX - ARENA.minX + 0.6
    const D = ARENA.maxZ - ARENA.minZ + 1.6
    const hex = (c: number) => '#' + c.toString(16).padStart(6, '0')
    const mat = canvasTexture(512, 512, (g) => {
      const cols = [[PAL.lilac, PAL.cream], [PAL.cream, PAL.butter]]
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        g.fillStyle = hex(cols[y][x])
        g.fillRect(x * 256, y * 256, 256, 256)
      }
      g.strokeStyle = 'rgba(35,25,66,0.10)'
      g.lineWidth = 6
      for (let i = 0; i <= 2; i++) {
        g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, 512); g.stroke()
        g.beginPath(); g.moveTo(0, i * 256); g.lineTo(512, i * 256); g.stroke()
      }
    })
    mat.wrapS = mat.wrapT = THREE.RepeatWrapping
    mat.repeat.set(W / 2, D / 2)
    const edge = new THREE.MeshStandardMaterial({ color: PAL.grape, roughness: 0.7 })
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.16, D),
      [edge, edge, new THREE.MeshStandardMaterial({ map: mat, roughness: 0.95 }), edge, edge, edge],
    )
    floor.position.set((ARENA.minX + ARENA.maxX) / 2, -0.08, (ARENA.minZ + ARENA.maxZ) / 2 - 0.5)
    s.add(floor)

    // The room around the mat: a warm wooden floor.
    const room = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf0d9b5, roughness: 1 }),
    )
    room.position.y = -0.17
    s.add(room)

    // ---- walls: this is a room, and it ends. A papered back wall with a
    // grape skirting board, and low toy-block walls down both sides, so the
    // edges of the world read at a glance. The front stays open: the camera
    // is there, and the robots come in that way.
    const back = STAND.wallZ
    const paper = canvasTexture(256, 256, (g) => {
      g.fillStyle = hex(PAL.cream); g.fillRect(0, 0, 256, 256)
      g.fillStyle = hex(PAL.lilac)
      for (let i = 0; i < 4; i++) g.fillRect(i * 64, 0, 32, 256)
      g.fillStyle = 'rgba(91,61,245,0.18)'
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(i * 64 + 48, 64, 6, 0, Math.PI * 2); g.arc(i * 64 + 48, 192, 6, 0, Math.PI * 2); g.fill() }
    })
    paper.wrapS = paper.wrapT = THREE.RepeatWrapping
    const wallW = W + 2.4
    paper.repeat.set(wallW / 1.2, STAND.wallHeight / 1.2)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(wallW, STAND.wallHeight), new THREE.MeshStandardMaterial({ map: paper, roughness: 1 }))
    wall.position.set(0, STAND.wallHeight / 2 - 0.17, back)
    s.add(wall)
    const skirting = new THREE.Mesh(new THREE.BoxGeometry(wallW, 0.32, 0.12), edge)
    skirting.position.set(0, 0.0, back + 0.06)
    s.add(skirting)
    const blockCols = [PAL.grape, PAL.sun, PAL.green, PAL.red, 0x2fa8e0]
    const parts: THREE.BufferGeometry[] = []
    for (const side of [-1, 1]) {
      const x = side * (W / 2 + 0.28)
      let i = side > 0 ? 2 : 0
      for (let z = back + 0.3; z < ARENA.maxZ + 0.6; z += 0.56) {
        const g = new THREE.BoxGeometry(0.5, 0.5, 0.5).toNonIndexed()
        g.translate(x, 0.08, z)
        const c = new THREE.Color(blockCols[i++ % blockCols.length])
        const n = g.getAttribute('position').count
        const col = new Float32Array(n * 3)
        for (let k = 0; k < n; k++) { col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3))
        g.deleteAttribute('uv')
        parts.push(g)
      }
    }
    const sideWalls = new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }))
    s.add(sideWalls)

    // ---- the grandstand: two stepped rows of the same toy blocks as the
    // side walls, one merged mesh (a single draw call). Each block is a
    // column from the floor to its row's top, in the palette, offset a colour
    // per row so the steps read.
    const stand: THREE.BufferGeometry[] = []
    const cols = Math.round((STAND.halfWidth * 2) / 0.6)
    STAND.rows.forEach((row, r) => {
      for (let c = 0; c < cols; c++) {
        const h = row.top + 0.17
        const g = new THREE.BoxGeometry(0.57, h, STAND.depth - 0.03).toNonIndexed()
        g.translate(-STAND.halfWidth + 0.3 + c * 0.6, -0.17 + h / 2, row.z)
        const col = new THREE.Color(blockCols[(c + r * 2) % blockCols.length])
        const n = g.getAttribute('position').count
        const arr = new Float32Array(n * 3)
        for (let k = 0; k < n; k++) { arr[k * 3] = col.r; arr[k * 3 + 1] = col.g; arr[k * 3 + 2] = col.b }
        g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
        g.deleteAttribute('uv')
        stand.push(g)
      }
    })
    s.add(new THREE.Mesh(mergeGeometries(stand)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })))

    // Big toy blocks as scenery behind the back edge: colour, depth, and
    // something the camera's eye can rest on above the hero's head.
    const blockGeo = new THREE.BoxGeometry(1, 1, 1)
    const letters = ['H', 'E', 'R', 'O']
    const letterCols = ['#5b3df5', '#ffc233', '#15997a', '#e5484d']
    letters.forEach((ch, i) => {
      const tex = canvasTexture(128, 128, (g) => {
        g.fillStyle = letterCols[i]
        g.fillRect(0, 0, 128, 128)
        g.fillStyle = '#fff6e9'
        g.beginPath(); g.roundRect(12, 12, 104, 104, 18); g.fill()
        g.fillStyle = letterCols[i]
        g.font = '900 84px Nunito, system-ui, sans-serif'
        g.textAlign = 'center'; g.textBaseline = 'middle'
        g.fillText(ch, 64, 70)
      })
      const m = new THREE.Mesh(blockGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }))
      const [x, z, yaw] = BACK_BLOCKS[i]
      m.scale.setScalar(BLOCK_SIZE)
      m.position.set(x, BLOCK_SIZE / 2, z)
      m.rotation.y = yaw
      s.add(m)
    })

    // The toy chest: what the robots want, and the goal the player defends.
    const chest = new THREE.Group()
    const wood = new THREE.MeshStandardMaterial({ color: 0xe8813a, roughness: 0.8 })
    const band = new THREE.MeshStandardMaterial({ color: PAL.sun, roughness: 0.5 })
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 0.9), wood)
    body.position.y = 0.375
    chest.add(body)
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.12, 0.94), band)
    trim.position.y = 0.62
    chest.add(trim)
    const lid = new THREE.Group()
    const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.74, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), wood)
    lidMesh.position.set(0, 0, 0.45)
    lid.add(lidMesh)
    lid.position.set(0, 0.75, -0.45)
    chest.add(lid)
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.06), band)
    lock.position.set(0, 0.66, 0.47)
    chest.add(lock)
    // Toys peeking out: a ball and a star block.
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshStandardMaterial({ color: PAL.red, roughness: 0.4 }))
    ball.position.set(-0.45, 0.85, 0.05)
    chest.add(ball)
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: PAL.sky, roughness: 0.6 }))
    cube.position.set(0.45, 0.85, 0)
    cube.rotation.set(0.3, 0.5, 0.2)
    chest.add(cube)
    const cb = makeBlob(2.4)
    chest.add(cb)
    chest.position.copy(CHEST)
    s.add(chest)
    this.chest = chest
    this.chestLid = lid
  }

  /** Jolt the chest: a robot just got in. */
  bumpChest() { this.wobble = 1 }

  update(dt: number, t: number) {
    this.wobble = Math.max(0, this.wobble - dt * 1.6)
    const w = this.wobble
    this.chest.rotation.z = Math.sin(t * 40) * 0.06 * w
    this.chest.scale.set(1 + 0.08 * w, 1 - 0.08 * w, 1 + 0.08 * w)
    this.chestLid.rotation.x = -0.25 - 0.7 * w + Math.sin(t * 2) * 0.03
  }
}
