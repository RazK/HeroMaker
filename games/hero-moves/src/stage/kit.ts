/**
 * The backdrop toolkit.
 *
 * Every backdrop in this game is generated at runtime from code. Nothing is
 * downloaded: the page runs under a CSP that refuses `fetch()`, and the payload
 * already carries a 4.65 MB pose model plus ~1.2 MB per avatar, so a set of
 * painted skies would be the most expensive thing in the build. A canvas and a
 * few hundred lines of drawing code cost bytes that compress to nothing and
 * produce textures at whatever size the device deserves.
 *
 * Three ideas do most of the work:
 *
 * * **Painted domes.** A sphere seen from the inside, textured with a canvas
 *   painted as an equirectangular sky. Gradients, clouds, nebulae and a sun all
 *   cost the same: one draw call, no lights, no fog.
 * * **Bands, not billboards.** Parallax layers are open cylinders around the
 *   stage rather than flat planes. The play camera swings ±34° and a flat
 *   silhouette shears badly at the extremes; a band looks the same from every
 *   angle it can reach, and rotating one slowly is free parallax.
 * * **One scrim behind the bodies.** The heroes are the point. Every theme
 *   drops a soft dark veil across the band of world the bodies occupy, so a
 *   crayon character keeps its contrast even against a bright sky.
 */
import * as THREE from 'three'
import { makeRng } from '../core/math'

export type Quality = 'full' | 'lite'

/** How much of everything a `lite` device gets. */
export const LITE_SCALE = 0.4

// ---- textures ---------------------------------------------------------------

export interface PaintOpts {
  /** Tiling. Anything wrapped is also set to RepeatWrapping. */
  repeat?: [number, number]
  wrap?: boolean
  /** Painted art is authored in final colours; tone mapping would grade it. */
  srgb?: boolean
}

/** Draw into an offscreen canvas and hand back a texture. */
export function paint(
  w: number, h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: PaintOpts = {},
): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  draw(g, w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
  if (opts.repeat || opts.wrap) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1])
  } else {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  }
  t.anisotropy = 4
  return t
}

/** A vertical gradient, bottom stop first. */
export function gradientTex(stops: Array<[number, string]>, h = 256): THREE.CanvasTexture {
  return paint(4, h, (g, w, hh) => {
    const grd = g.createLinearGradient(0, hh, 0, 0)
    for (const [o, c] of stops) grd.addColorStop(o, c)
    g.fillStyle = grd
    g.fillRect(0, 0, w, hh)
  })
}

/** The hand-made paper grain the set has always had. */
export function paperTexture(base: string, grain: number, size = 256): THREE.CanvasTexture {
  return paint(size, size, (g, w, h) => {
    g.fillStyle = base
    g.fillRect(0, 0, w, h)
    const img = g.getImageData(0, 0, w, h)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * grain
      d[i] += n; d[i + 1] += n; d[i + 2] += n
    }
    g.putImageData(img, 0, 0)
  }, { wrap: true })
}

/**
 * Fine noise over a painted gradient.
 *
 * A sky is a big smooth ramp stretched over a dome, which is the exact case an
 * 8-bit texture bands in — visible as terraced stripes across the upper frame,
 * worst on the smaller `lite` textures. A pixel of dither costs one pass at
 * boot and removes it.
 */
export function dither(g: CanvasRenderingContext2D, w: number, h: number, amount = 5) {
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  g.putImageData(img, 0, 0)
}

export type SpriteKind = 'dot' | 'glow' | 'star' | 'flake' | 'chip' | 'streak' | 'bubble'

/** Point sprites, all built from the same soft radial falloff. */
export function spriteTex(kind: SpriteKind, size = 64): THREE.CanvasTexture {
  return paint(size, size, (g, w, h) => {
    const cx = w / 2, cy = h / 2, r = w / 2
    g.clearRect(0, 0, w, h)
    if (kind === 'dot' || kind === 'glow') {
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r)
      const core = kind === 'glow' ? 0.06 : 0.3
      grd.addColorStop(0, 'rgba(255,255,255,1)')
      grd.addColorStop(core, 'rgba(255,255,255,0.92)')
      grd.addColorStop(0.55, 'rgba(255,255,255,0.22)')
      grd.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grd
      g.fillRect(0, 0, w, h)
    } else if (kind === 'star') {
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r)
      grd.addColorStop(0, 'rgba(255,255,255,1)')
      grd.addColorStop(0.28, 'rgba(255,255,255,0.28)')
      grd.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grd
      g.fillRect(0, 0, w, h)
      // Two soft spikes: the difference between a dot and a star.
      g.strokeStyle = 'rgba(255,255,255,0.5)'
      g.lineWidth = Math.max(1, w / 32)
      g.beginPath()
      g.moveTo(cx, cy - r * 0.92); g.lineTo(cx, cy + r * 0.92)
      g.moveTo(cx - r * 0.92, cy); g.lineTo(cx + r * 0.92, cy)
      g.stroke()
    } else if (kind === 'bubble') {
      g.strokeStyle = 'rgba(255,255,255,0.85)'
      g.lineWidth = Math.max(1.5, w / 16)
      g.beginPath(); g.arc(cx, cy, r * 0.66, 0, Math.PI * 2); g.stroke()
      g.fillStyle = 'rgba(255,255,255,0.16)'
      g.beginPath(); g.arc(cx, cy, r * 0.62, 0, Math.PI * 2); g.fill()
      g.fillStyle = 'rgba(255,255,255,0.9)'
      g.beginPath(); g.arc(cx - r * 0.24, cy - r * 0.28, r * 0.13, 0, Math.PI * 2); g.fill()
    } else if (kind === 'flake') {
      g.fillStyle = 'rgba(255,255,255,0.95)'
      g.beginPath()
      g.ellipse(cx, cy, r * 0.78, r * 0.42, Math.PI * 0.18, 0, Math.PI * 2)
      g.fill()
    } else if (kind === 'chip') {
      g.fillStyle = 'rgba(255,255,255,1)'
      g.fillRect(w * 0.22, h * 0.1, w * 0.56, h * 0.8)
    } else {
      const grd = g.createLinearGradient(0, 0, w, h)
      grd.addColorStop(0, 'rgba(255,255,255,0)')
      grd.addColorStop(0.75, 'rgba(255,255,255,0.85)')
      grd.addColorStop(1, 'rgba(255,255,255,0)')
      g.strokeStyle = grd
      g.lineWidth = Math.max(2, w / 20)
      g.beginPath(); g.moveTo(w * 0.05, h * 0.05); g.lineTo(w * 0.95, h * 0.95); g.stroke()
    }
  })
}

/**
 * Soft-edged alpha ramp for light shafts and cones: opaque at the top of the
 * texture (the apex end of a cone) and gone by the bottom.
 */
export function shaftTex(topAlpha = 0.55): THREE.CanvasTexture {
  return paint(16, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, h, 0, 0)
    grd.addColorStop(0, 'rgba(255,255,255,0)')
    grd.addColorStop(0.35, `rgba(255,255,255,${topAlpha * 0.35})`)
    grd.addColorStop(1, `rgba(255,255,255,${topAlpha})`)
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
  })
}

// ---- disposal ---------------------------------------------------------------

const disposeMaterial = (m: THREE.Material) => {
  for (const v of Object.values(m as unknown as Record<string, unknown>)) {
    if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose()
  }
  m.dispose()
}

/**
 * Free every GPU resource under `root`.
 *
 * Themes are switched from a menu, so this runs as often as a player is
 * curious. Geometries and materials are shared inside a theme — a bank of
 * footlights is one geometry and one material — so both are tracked in a set
 * and disposed once.
 */
export function disposeTree(root: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>()
  const mats = new Set<THREE.Material>()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) geos.add(m.geometry)
    const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x))
    else if (mat) mats.add(mat)
  })
  geos.forEach((g) => g.dispose())
  mats.forEach(disposeMaterial)
  root.clear()
}

// ---- building blocks --------------------------------------------------------

/** The painted sky. Radius sits inside the camera's far plane with room over. */
export function skyDome(texture: THREE.Texture, radius = 15.5): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 40, 24),
    new THREE.MeshBasicMaterial({
      map: texture, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false,
    }),
  )
  mesh.renderOrder = -10
  return mesh
}

export interface BandOpts {
  radius: number
  height: number
  y: number
  texture: THREE.Texture
  /**
   * How many times the art tiles around the band.
   *
   * The single most important number in a backdrop, and the one that was got
   * wrong first: a tile drawn once around a band of radius 7 is forty-three
   * metres wide on screen, which turns a tree into a wall and a spectator into
   * a hill. Pick it so the tile's world size (2*PI*r / repeat by height) has
   * roughly the aspect ratio of the canvas it was painted on, and the art comes
   * out the size it was drawn.
   */
  repeat?: number
  color?: THREE.ColorRepresentation
  opacity?: number
  blending?: THREE.Blending
  /** Radians per second the band rotates. Free parallax. */
  drift?: number
  toneMapped?: boolean
  segments?: number
}

/**
 * A parallax layer: an open cylinder seen from the inside, wearing a tiled
 * alpha silhouette. Looks identical from every angle the play camera can reach.
 */
export class Band {
  readonly mesh: THREE.Mesh
  readonly drift: number
  constructor(o: BandOpts) {
    if (o.repeat && o.repeat !== 1) {
      o.texture.wrapS = THREE.RepeatWrapping
      o.texture.repeat.x = o.repeat
    }
    const geo = new THREE.CylinderGeometry(o.radius, o.radius, o.height, o.segments ?? 48, 1, true)
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: o.texture, side: THREE.BackSide, transparent: true, depthWrite: false,
      color: o.color ?? 0xffffff, opacity: o.opacity ?? 1, fog: false,
      blending: o.blending ?? THREE.NormalBlending,
      toneMapped: o.toneMapped ?? false,
    }))
    this.mesh.position.y = o.y
    this.mesh.renderOrder = -9 + Math.max(-8, -o.radius / 4)
    this.drift = o.drift ?? 0
  }
  update(dt: number) { if (this.drift) this.mesh.rotation.y += this.drift * dt }
}

/**
 * The contrast guard, and the one thing every theme must have.
 *
 * The heroes stand in the middle ~70% of the frame with their feet on the
 * floor. This is a dark veil across exactly that band of world, sitting between
 * them and the scenery: bright themes stop competing with the bodies, and dark
 * themes gain a little depth from it. Measured by eye against Cloudy — the pale
 * white hero — on every theme.
 */
export function scrim(color: THREE.ColorRepresentation, strength = 0.5, radius = 5.4): THREE.Mesh {
  const tex = paint(8, 128, (g, w, h) => {
    const grd = g.createLinearGradient(0, h, 0, 0)
    // Zero at the bottom edge on purpose. The veil is a cylinder standing at
    // radius 5.4 and the themed ground runs out to 11, so any alpha at its foot
    // is painted straight across the *distant floor* — which showed up as a
    // black ring round the stage on every light-floored theme. It starts above
    // the horizon and covers only the band the bodies are in.
    grd.addColorStop(0, 'rgba(255,255,255,0)')
    grd.addColorStop(0.12, 'rgba(255,255,255,0.85)')
    grd.addColorStop(0.35, 'rgba(255,255,255,1)')
    grd.addColorStop(0.75, 'rgba(255,255,255,0.55)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
  })
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 4.7, 32, 1, true),
    new THREE.MeshBasicMaterial({
      map: tex, side: THREE.BackSide, transparent: true, depthWrite: false,
      color, opacity: strength, fog: false, toneMapped: false,
    }),
  )
  mesh.position.y = 2.85
  mesh.renderOrder = -4
  return mesh
}

/** A soft glowing disc: light pools, suns, planet haze. */
export function glowDisc(color: THREE.ColorRepresentation, radius: number, opacity = 1,
  blending: THREE.Blending = THREE.AdditiveBlending): THREE.Mesh {
  const tex = paint(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    grd.addColorStop(0, 'rgba(255,255,255,1)')
    grd.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    grd.addColorStop(0.72, 'rgba(255,255,255,0.14)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
  })
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 32), new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false, blending, color, opacity,
    fog: false, toneMapped: false,
  }))
  return m
}

/** A volumetric-looking shaft of light. Cheap: one open cone, additive. */
export function lightShaft(color: THREE.ColorRepresentation, topR: number, botR: number,
  height: number, opacity = 0.3): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(topR, botR, height, 20, 1, true)
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: shaftTex(1), color, transparent: true, opacity, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
  }))
}

// ---- floor ------------------------------------------------------------------

export interface FloorOpts {
  radius: number
  /** The performance disc itself. */
  map: THREE.Texture
  color: THREE.ColorRepresentation
  roughness?: number
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  /** Ground beyond the disc, if the theme wants the world to continue. */
  surround?: { color: THREE.ColorRepresentation, map?: THREE.Texture, radius?: number }
  /** Warm pool of light under the performers. */
  pool?: { color: THREE.ColorRepresentation, opacity: number, radius?: number }
  /** Contact darkening under the line of heroes, for when shadows are off. */
  contact?: number
}

/**
 * The ground the heroes stand on, themed.
 *
 * Non-negotiable across every backdrop: without a floor and something dark
 * directly under the feet, an avatar reads as floating. Shadows are the first
 * thing the game drops when frames get slow, so the disc also carries a painted
 * contact shade that costs nothing and is always there.
 */
export function stageFloor(o: FloorOpts): THREE.Group {
  const g = new THREE.Group()

  if (o.surround) {
    const mat = new THREE.MeshStandardMaterial({
      color: o.surround.color, roughness: 1, metalness: 0, map: o.surround.map ?? null,
    })
    const m = new THREE.Mesh(new THREE.CircleGeometry(o.surround.radius ?? 13, 48), mat)
    m.rotation.x = -Math.PI / 2
    m.position.y = -0.03
    g.add(m)
  }

  const floorMat = new THREE.MeshStandardMaterial({
    color: o.color, roughness: o.roughness ?? 0.9, metalness: 0, map: o.map,
    emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 0,
  })
  const floor = new THREE.Mesh(new THREE.CircleGeometry(o.radius, 56), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  g.add(floor)

  if (o.contact) {
    const tex = paint(128, 128, (ctx, w, h) => {
      const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
      grd.addColorStop(0, 'rgba(0,0,0,0.9)')
      grd.addColorStop(0.45, 'rgba(0,0,0,0.42)')
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, w, h)
    })
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(o.radius * 1.7, o.radius * 0.62),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, opacity: o.contact,
        color: 0x000000, fog: false, toneMapped: false,
      }))
    shade.rotation.x = -Math.PI / 2
    shade.position.y = 0.006
    shade.renderOrder = -1
    g.add(shade)
  }

  if (o.pool) {
    const pool = glowDisc(o.pool.color, o.pool.radius ?? o.radius * 0.68, o.pool.opacity,
      THREE.AdditiveBlending)
    pool.rotation.x = -Math.PI / 2
    pool.position.y = 0.014
    g.add(pool)
  }
  return g
}

// ---- particles --------------------------------------------------------------

export interface ParticleOpts {
  count: number
  texture: THREE.Texture
  size: number
  /** Half-extents of the box the particles live in, centred on `centre`. */
  bounds: [number, number, number]
  centre?: [number, number, number]
  /** Base drift, m/s. Each particle gets ±40% of it. */
  velocity: [number, number, number]
  colors: string[]
  opacity?: number
  blending?: THREE.Blending
  /** Horizontal sway amplitude and rate. */
  sway?: number
  swayRate?: number
  /** How much the sprite size swells on the beat, 0..1. */
  beat?: number
  seed?: number
  /** Depth-sorted alpha for chips and leaves; additive for motes and stars. */
  depthWrite?: boolean
}

/**
 * A drifting field of sprites: dust, snow, confetti, bubbles, embers.
 *
 * One draw call, one buffer, and the whole simulation is a wrap-around box —
 * a particle that leaves the top comes back at the bottom, so a field never
 * empties and never needs respawn bookkeeping. `lite` keeps the same buffer and
 * simply draws fewer of them, which costs nothing to switch.
 */
export class Particles {
  readonly points: THREE.Points
  private pos: Float32Array
  private vel: Float32Array
  private phase: Float32Array
  private readonly opts: ParticleOpts
  private readonly baseSize: number
  private t = 0

  constructor(opts: ParticleOpts, quality: Quality) {
    this.opts = opts
    const n = opts.count
    const rng = makeRng(opts.seed ?? 1234)
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.phase = new Float32Array(n)
    const col = new Float32Array(n * 3)
    const c = new THREE.Color()
    const [bx, by, bz] = opts.bounds
    const [cx, cy, cz] = opts.centre ?? [0, 0, 0]
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = cx + (rng() * 2 - 1) * bx
      this.pos[i * 3 + 1] = cy + (rng() * 2 - 1) * by
      this.pos[i * 3 + 2] = cz + (rng() * 2 - 1) * bz
      for (let k = 0; k < 3; k++) this.vel[i * 3 + k] = opts.velocity[k] * (0.6 + rng() * 0.8)
      this.phase[i] = rng() * Math.PI * 2
      c.set(opts.colors[Math.floor(rng() * opts.colors.length)])
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setDrawRange(0, quality === 'lite' ? Math.max(8, Math.round(n * LITE_SCALE)) : n)
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz),
      Math.hypot(bx, by, bz) * 1.4)
    this.baseSize = opts.size
    const mat = new THREE.PointsMaterial({
      size: opts.size, map: opts.texture, transparent: true, vertexColors: true,
      depthWrite: opts.depthWrite ?? false, opacity: opts.opacity ?? 1,
      blending: opts.blending ?? THREE.AdditiveBlending, sizeAttenuation: true,
      fog: false, toneMapped: false,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
  }

  /** Draw fewer of the same particles. The buffer is untouched. */
  setQuality(q: Quality) {
    this.points.geometry.setDrawRange(0,
      q === 'lite' ? Math.max(8, Math.round(this.opts.count * LITE_SCALE)) : this.opts.count)
  }

  update(dt: number, beat = 0) {
    this.t += dt
    const o = this.opts
    const n = o.count
    const [bx, by, bz] = o.bounds
    const [cx, cy, cz] = o.centre ?? [0, 0, 0]
    const sway = o.sway ?? 0
    const rate = o.swayRate ?? 1.2
    const drawn = this.points.geometry.drawRange.count
    for (let i = 0; i < Math.min(n, drawn); i++) {
      const j = i * 3
      this.pos[j] += (this.vel[j] + (sway ? Math.cos(this.t * rate + this.phase[i]) * sway : 0)) * dt
      this.pos[j + 1] += this.vel[j + 1] * dt
      this.pos[j + 2] += this.vel[j + 2] * dt
      // Wrap: the field is a torus, so it can never run dry.
      if (this.pos[j] > cx + bx) this.pos[j] -= bx * 2
      else if (this.pos[j] < cx - bx) this.pos[j] += bx * 2
      if (this.pos[j + 1] > cy + by) this.pos[j + 1] -= by * 2
      else if (this.pos[j + 1] < cy - by) this.pos[j + 1] += by * 2
      if (this.pos[j + 2] > cz + bz) this.pos[j + 2] -= bz * 2
      else if (this.pos[j + 2] < cz - bz) this.pos[j + 2] += bz * 2
    }
    ;(this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    if (o.beat) {
      const mat = this.points.material as THREE.PointsMaterial
      mat.size = this.baseSize * (1 + o.beat * Math.max(0, Math.cos(beat * Math.PI * 2)))
    }
  }
}

/**
 * The cheap path, in one object.
 *
 * A theme registers its particle fields and its optional decorations — light
 * shafts, extra sprites, second star fields — and this turns them down. Extras
 * are always built, never conditionally created, so the switch works in both
 * directions and costs nothing but a visibility flag.
 */
export class QualitySwitch {
  constructor(
    private readonly fields: Particles[],
    private readonly extras: THREE.Object3D[] = [],
  ) {}
  apply(q: Quality) {
    for (const f of this.fields) f.setQuality(q)
    for (const e of this.extras) e.visible = q === 'full'
  }
}

/** Wonky geometry: a perfect shape looks CG, a hand-cut one looks made. */
export function wobble(geo: THREE.BufferGeometry, amount: number, seed: number) {
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

/** Deterministic helper for the painters below. */
export const rngFor = makeRng
