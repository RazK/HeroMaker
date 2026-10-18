import * as THREE from 'three'

/**
 * The class stage set: Toy Box colours, and cheap.
 *
 * Twelve skinned heroes are the whole budget, so the set spends nothing: every
 * surface is unlit (MeshBasicMaterial), there is no shadow map — each hero gets
 * a painted contact shadow instead, one shared texture — and the backdrop is a
 * single gradient plane with a sun and a string of bunting.
 *
 * The heroes stand on tiers like a class photo. A tier is a full hero taller
 * than the one in front, so no hero ever stands in front of another one's face
 * and every child's name sits on the tier edge right under their hero.
 */
export const TB = {
  cream: '#FFF6E9', white: '#FFFFFF', ink: '#231942', grape: '#5B3DF5', grapeDeep: '#3A22B8',
  sun: '#FFC233', line: '#EADFCB',
  plates: ['#E9E3FF', '#FFE9A8', '#CFF5EA', '#FFDCC7', '#D6ECFF', '#FFD6E7'],
}

export const SLOT = 1.3
export const TIER_H = 2.05
export const TIER_D = 1.5
export const BASE_H = 0.2

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Unlit and not tone-mapped: the set shows the brand's colours exactly.
const basic = (color: string | THREE.Texture, extra: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ ...(typeof color === 'string' ? { color } : { map: color }), toneMapped: false, ...extra })

export const shadowTexture = canvasTexture(64, 64, (g) => {
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(35,25,66,0.34)')
  grad.addColorStop(0.6, 'rgba(35,25,66,0.12)')
  grad.addColorStop(1, 'rgba(35,25,66,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
})

export interface SetBuild {
  group: THREE.Group
  /** y of the floor each row stands on. */
  rowY: (r: number) => number
  rowZ: (r: number) => number
  /** z of the front edge of a row's tier, where the names sit. */
  rowFront: (r: number) => number
}

export function buildSet(rows: number, cols: number): SetBuild {
  const group = new THREE.Group()
  const rowY = (r: number) => BASE_H + r * TIER_H
  const rowZ = (r: number) => -r * TIER_D
  const rowFront = (r: number) => rowZ(r) + TIER_D / 2
  const width = cols * SLOT + 0.7

  // Tiers: a white top, a coloured front, a darker edge line under the top.
  const fronts = ['#DCD3FF', '#E9E3FF', '#DCD3FF', '#E9E3FF']
  for (let r = 0; r < rows; r++) {
    const top = rowY(r)
    const depth = r === rows - 1 ? TIER_D + 0.6 : TIER_D
    const zc = rowZ(r) - (depth - TIER_D) / 2
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, top, depth), [
      basic(fronts[r % fronts.length]), basic(fronts[r % fronts.length]),
      basic('#FFFFFF'), basic(TB.ink),
      basic(fronts[r % fronts.length]), basic(TB.ink),
    ])
    body.position.set(0, top / 2, zc)
    group.add(body)
    // A grape band along the foot of each tier, the toy-box edge.
    const band = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.16), basic(TB.grape))
    band.position.set(0, (r === 0 ? 0 : rowY(r - 1)) + 0.08, rowFront(r) + 0.006)
    if (r > 0) group.add(band)
    // The lip: a cream strip along the top edge, the tier's "plate".
    const lip = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.07, 0.07), basic(TB.cream))
    lip.position.set(0, top - 0.035, rowFront(r) + 0.01)
    group.add(lip)
  }

  // Floor.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), basic('#F6E7CF'))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, 4)
  group.add(floor)

  // Backdrop: cream to lilac, a big sun, rays.
  const backZ = rowZ(rows - 1) - TIER_D - 2.2
  const wallH = rowY(rows) + 8
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(80, wallH + 6), basic(canvasTexture(4, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0, '#E9E3FF')
    grad.addColorStop(0.55, '#FFF0F5')
    grad.addColorStop(1, '#FFF6E9')
    g.fillStyle = grad
    g.fillRect(0, 0, 4, 256)
  })))
  wall.position.set(0, (wallH + 6) / 2 - 3, backZ)
  group.add(wall)

  const sunR = Math.max(2.4, rows * 1.2)
  const rays = new THREE.Mesh(new THREE.CircleGeometry(sunR * 2.6, 48), basic(canvasTexture(512, 512, (g) => {
    g.translate(256, 256)
    for (let i = 0; i < 16; i++) {
      g.rotate((Math.PI * 2) / 16)
      g.beginPath(); g.moveTo(0, 0); g.lineTo(256, -26); g.lineTo(256, 26); g.closePath()
      g.fillStyle = 'rgba(255,194,51,0.16)'; g.fill()
    }
  }), { transparent: true, depthWrite: false }))
  const sunY = rowY(rows - 1) + TIER_H * 0.55
  rays.position.set(0, sunY, backZ + 0.02)
  group.add(rays)
  const sun = new THREE.Mesh(new THREE.CircleGeometry(sunR, 64), basic(TB.sun))
  sun.position.set(0, sunY, backZ + 0.04)
  group.add(sun)
  const halo = new THREE.Mesh(new THREE.RingGeometry(sunR, sunR * 1.12, 64), basic('#FFD97A'))
  halo.position.set(0, sunY, backZ + 0.03)
  group.add(halo)

  // Bunting: two swags of flags across the top of the backdrop.
  const flagGeo = new THREE.BufferGeometry()
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.22, 0, 0, 0.22, 0, 0, 0, -0.42, 0], 3))
  const flagMats = [TB.grape, TB.sun, '#15997A', '#FF8FB1', '#4FB3FF'].map((c) => basic(c, { side: THREE.DoubleSide }))
  const span = Math.max(width + 4, 12)
  const by = rowY(rows - 1) + TIER_H * 1.45
  for (let s = 0; s < 2; s++) {
    const x0 = s === 0 ? -span / 2 : 0, x1 = s === 0 ? 0 : span / 2
    const count = 9
    for (let i = 0; i <= count; i++) {
      const u = i / count
      const x = x0 + (x1 - x0) * u
      const y = by - Math.sin(u * Math.PI) * 0.9
      const f = new THREE.Mesh(flagGeo, flagMats[(i + s * 2) % flagMats.length])
      f.position.set(x, y, backZ + 0.5)
      f.rotation.z = Math.cos(u * Math.PI) * 0.25 * (s === 0 ? 1 : 1)
      group.add(f)
    }
  }

  return { group, rowY, rowZ, rowFront }
}
