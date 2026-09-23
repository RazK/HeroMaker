/**
 * Forest Glade — a sunlit clearing.
 *
 * The bright themes are the hard ones. A pale hero (Cloudy) in front of a pale
 * sky is a silhouette nobody can read, so the sky is kept *above* the bodies:
 * three tree bands stack up to a dark green wall exactly across the band of
 * world the heroes occupy, and the sun and the sky live over their heads. The
 * clearing floor is the light thing, which is where the feet are.
 */
import * as THREE from 'three'
import {
  Band, Particles, QualitySwitch, disposeTree, dither, glowDisc, lightShaft, paint, rngFor,
  scrim, skyDome, spriteTex, stageFloor,
} from '../kit'
import type { Backdrop, Quality, StageEnv } from '../env'

const skyTex = (size: number) => paint(size, size / 2, (g, w, h) => {
  const rng = rngFor(3311)
  const sky = g.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#2f6fc4')
  sky.addColorStop(0.35, '#79b6e8')
  sky.addColorStop(0.66, '#bfe2f2')
  sky.addColorStop(0.85, '#ecf0cd')
  sky.addColorStop(1, '#cfe0a8')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)

  // Sun, well up the dome and off to one side.
  const sx = w * 0.24, sy = h * 0.2
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, w * 0.2)
  sun.addColorStop(0, 'rgba(255,252,230,0.95)')
  sun.addColorStop(0.16, 'rgba(255,238,190,0.5)')
  sun.addColorStop(0.5, 'rgba(255,230,170,0.14)')
  sun.addColorStop(1, 'rgba(255,230,170,0)')
  g.fillStyle = sun
  g.fillRect(0, 0, w, h)

  // Fat summer clouds, flattened underneath.
  for (let i = 0; i < 16; i++) {
    const x = rng() * w
    const y = h * (0.12 + rng() * 0.42)
    const s = (0.03 + rng() * 0.05) * w
    g.save()
    g.translate(x, y)
    for (let k = 0; k < 7; k++) {
      const px = (rng() - 0.5) * s * 3.2
      const py = (rng() - 0.5) * s * 0.7
      const pr = s * (0.5 + rng() * 0.7)
      const grd = g.createRadialGradient(px, py - pr * 0.2, 0, px, py, pr)
      grd.addColorStop(0, 'rgba(255,255,255,0.95)')
      grd.addColorStop(0.6, 'rgba(246,250,255,0.7)')
      grd.addColorStop(1, 'rgba(230,240,255,0)')
      g.fillStyle = grd
      g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill()
    }
    g.restore()
  }
  dither(g, w, h, 5)
})

interface TreeOpts {
  seed: number
  /**
   * Draw a continuous ridge instead of separate trees.
   *
   * The far layer used the same tree painter, and its trunks came out as pale
   * vertical slabs behind the heroes once the mist was applied — a white wall
   * exactly where a white hero stands. A ridge has no trunks and no gaps.
   */
  hill?: boolean
  /**
   * Fraction of the tile filled from the bottom with a bushy understory.
   *
   * Trees on their own leave gaps at trunk height, and through the gaps the
   * pale distant layer showed as a bright strip directly behind the heroes'
   * legs. A real tree line has undergrowth; this is it, and it is what closes
   * the dark band the bodies are read against.
   */
  understory?: number
  /** Trunk-to-canopy colours, dark first. */
  canopy: string[]
  trunk: string
  count: number
  /** Canopy height as a fraction of the canvas. */
  minH: number
  maxH: number
  mist?: string
}

/** A tiling tree line. Shapes are drawn three times so the seam never shows. */
const treeTex = (w: number, h: number, o: TreeOpts) => paint(w, h, (g, cw, ch) => {
  const rng = rngFor(o.seed)
  g.clearRect(0, 0, cw, ch)
  const one = (x: number) => {
    const th = ch * (o.minH + rng() * (o.maxH - o.minH))
    const base = ch
    const col = o.canopy[Math.floor(rng() * o.canopy.length)]
    const conifer = rng() < 0.55
    const wdt = th * (conifer ? 0.34 : 0.5)
    g.fillStyle = o.trunk
    g.fillRect(x - th * 0.035, base - th * 0.5, th * 0.07, th * 0.5)
    g.fillStyle = col
    if (conifer) {
      const tiers = 4
      for (let i = 0; i < tiers; i++) {
        const ty = base - th * (0.28 + (i / tiers) * 0.72)
        const tw = wdt * (1 - i / (tiers + 1.2))
        g.beginPath()
        g.moveTo(x, ty - th * 0.24)
        g.lineTo(x + tw, ty + th * 0.06)
        g.lineTo(x - tw, ty + th * 0.06)
        g.closePath()
        g.fill()
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const px = x + (rng() - 0.5) * wdt * 1.5
        const py = base - th * (0.5 + rng() * 0.42)
        g.beginPath()
        g.arc(px, py, wdt * (0.34 + rng() * 0.3), 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  const bushes = () => {
    if (!o.understory) return
    const top = ch * (1 - o.understory)
    g.fillStyle = o.canopy[0]
    g.beginPath()
    g.moveTo(0, ch)
    for (let x = 0; x <= cw; x += 6) {
      const y = top + Math.sin((x / cw) * Math.PI * 8) * ch * 0.03
        + Math.sin((x / cw) * Math.PI * 22 + 1.1) * ch * 0.018
      g.lineTo(x, y)
    }
    g.lineTo(cw, ch)
    g.closePath()
    g.fill()
    for (let i = 0; i < 30; i++) {
      const x = rng() * cw
      const r = ch * (0.02 + rng() * 0.05)
      g.fillStyle = o.canopy[Math.floor(rng() * o.canopy.length)]
      g.beginPath(); g.arc(x, top + ch * 0.02, r, 0, Math.PI * 2); g.fill()
    }
  }

  if (o.hill) {
    // A rolling ridge, summed from sines that complete a whole number of cycles
    // across the tile so the seam is invisible.
    const ridge = (x: number) => ch * (0.42
      + 0.16 * Math.sin((x / cw) * Math.PI * 2)
      + 0.09 * Math.sin((x / cw) * Math.PI * 6 + 1.3)
      + 0.05 * Math.sin((x / cw) * Math.PI * 10 + 2.6))
    g.fillStyle = o.canopy[0]
    g.beginPath()
    g.moveTo(0, ch)
    for (let x = 0; x <= cw; x += 4) g.lineTo(x, ridge(x))
    g.lineTo(cw, ch)
    g.closePath()
    g.fill()
    // A second, nearer ridge for depth.
    g.fillStyle = o.canopy[1] ?? o.canopy[0]
    g.beginPath()
    g.moveTo(0, ch)
    for (let x = 0; x <= cw; x += 4) g.lineTo(x, ridge(x + cw * 0.31) + ch * 0.2)
    g.lineTo(cw, ch)
    g.closePath()
    g.fill()
    // Tree tops breaking the ridge line, so it reads as forest not fog.
    g.fillStyle = o.canopy[0]
    for (let i = 0; i < o.count * 3; i++) {
      const x = rng() * cw
      const y = ridge(x)
      const r = ch * (0.02 + rng() * 0.035)
      g.beginPath()
      g.moveTo(x, y - r * 2.6); g.lineTo(x + r, y + r); g.lineTo(x - r, y + r)
      g.closePath(); g.fill()
    }
  } else {
    bushes()
    for (let i = 0; i < o.count; i++) {
      const x = (i / o.count) * cw + (rng() - 0.5) * (cw / o.count)
      one(x)
      if (x < cw * 0.08) one(x + cw)
      if (x > cw * 0.92) one(x - cw)
    }
  }
  if (o.mist) {
    const m = g.createLinearGradient(0, ch, 0, ch * 0.35)
    m.addColorStop(0, o.mist)
    m.addColorStop(1, 'rgba(255,255,255,0)')
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = m
    g.fillRect(0, 0, cw, ch)
    g.globalCompositeOperation = 'source-over'
  }
}, { repeat: [1, 1], wrap: true })

/** Mossy ground: layered greens with blade flecks and a worn centre. */
const grassTex = (size: number, worn: boolean) => paint(size, size, (g, w, h) => {
  const rng = rngFor(worn ? 606 : 909)
  g.fillStyle = worn ? '#7f9b4d' : '#4b6c33'
  g.fillRect(0, 0, w, h)
  const cols = worn
    ? ['#93ac5c', '#6f8c42', '#a8bb6e', '#82994c']
    : ['#3d5c29', '#59783a', '#2f4a20', '#65834a']
  for (let i = 0; i < size * 14; i++) {
    g.fillStyle = cols[Math.floor(rng() * cols.length)]
    const x = rng() * w, y = rng() * h
    g.fillRect(x, y, 1 + rng() * 2, 2 + rng() * 4)
  }
  if (worn) {
    // Dapple: sunlight through leaves is what makes a clearing feel like one.
    g.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 40; i++) {
      const x = rng() * w, y = rng() * h, r = 8 + rng() * 34
      const grd = g.createRadialGradient(x, y, 0, x, y, r)
      grd.addColorStop(0, 'rgba(255,246,196,0.30)')
      grd.addColorStop(1, 'rgba(255,246,196,0)')
      g.fillStyle = grd
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
    }
    g.globalCompositeOperation = 'source-over'
  }
}, { wrap: true })

export function create(q: Quality): Backdrop {
  const group = new THREE.Group()
  const full = q === 'full'
  const T = full ? 1024 : 512

  group.add(skyDome(skyTex(T)))

  const bands = [
    // Far hills: pale, misty, barely there. Each band's `repeat` is solved so
    // the painted tile lands at roughly the world size it was drawn at — see
    // BandOpts.repeat, which is the difference between a forest and a wall.
    new Band({
      radius: 13.5, height: 7, y: 3.5, repeat: 3,
      texture: treeTex(T, T / 4, {
        seed: 12, hill: true, canopy: ['#93b4bd', '#a6c3c9'], trunk: '#9cb6bc',
        count: 12, minH: 0.4, maxH: 0.75, mist: 'rgba(206,228,235,0.7)',
      }),
      opacity: 0.85, drift: 0.002,
    }),
    // Mid forest.
    new Band({
      radius: 10, height: 6, y: 3, repeat: 3,
      texture: treeTex(T, T / 3, {
        seed: 44, canopy: ['#3f6b3a', '#4b7a3f', '#355c31'], trunk: '#4a3a2a',
        count: 9, minH: 0.55, maxH: 0.95, understory: 0.26, mist: 'rgba(190,222,224,0.4)',
      }),
      drift: -0.004,
    }),
    // Near wall of trees: the dark ground the heroes are read against. It stops
    // below the top of the frame, so the sky is still the sky.
    new Band({
      radius: 7.2, height: 4.4, y: 2.2, repeat: 4,
      texture: treeTex(T, T / 2, {
        seed: 88, canopy: ['#1f3a1e', '#284924', '#274a24', '#1a3319'], trunk: '#2c2115',
        count: 5, minH: 0.6, maxH: 0.96, understory: 0.3,
      }),
    }),
  ]
  for (const b of bands) group.add(b.mesh)

  // Ground, then the clearing itself.
  const surround = grassTex(full ? 512 : 256, false)
  surround.repeat.set(9, 9)
  const clearing = grassTex(full ? 512 : 256, true)
  clearing.repeat.set(2.4, 2.4)
  group.add(stageFloor({
    radius: 3.6, map: clearing, color: '#c9d59a', roughness: 1,
    surround: { color: '#93a86a', map: surround, radius: 13 },
    pool: { color: '#fff0b8', opacity: 0.26, radius: 2.8 },
    contact: 0.42,
  }))

  // Sunbeams through the canopy, from the same side as the painted sun.
  const shafts: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const s = lightShaft('#ffeeb8', 0.7, 2.4, 11, 0.11 + i * 0.02)
    s.position.set(-3.4 + i * 3.1, 5.4, -3.6 + i * 0.8)
    s.rotation.z = 0.36 - i * 0.06
    s.rotation.x = -0.12
    s.visible = full
    group.add(s)
    shafts.push(s)
  }
  const sunGlow = glowDisc('#fff2c0', 7, 0.3)
  sunGlow.position.set(-6.5, 7.4, -9)
  group.add(sunGlow)

  group.add(scrim('#14260f', 0.34))

  const pollen = new Particles({
    count: full ? 260 : 100, texture: spriteTex('glow', 32), size: 0.06,
    bounds: [6, 3, 3], centre: [0, 2.2, -1.4], velocity: [0.06, 0.05, 0],
    colors: ['#fff4bc', '#ffe89a', '#eaffc8'], opacity: 0.75, sway: 0.09, seed: 17, beat: 0.2,
  }, q)
  group.add(pollen.points)

  const leaves = new Particles({
    count: full ? 60 : 24, texture: spriteTex('flake', 48), size: 0.14,
    bounds: [6, 3.4, 3], centre: [0, 3, -2], velocity: [0.14, -0.22, 0],
    colors: ['#8fbf44', '#c9d96a', '#e0b158', '#7fae3f'],
    opacity: 0.95, sway: 0.26, swayRate: 0.9, seed: 23, blending: THREE.NormalBlending,
  }, q)
  group.add(leaves.points)

  const quality = new QualitySwitch([pollen, leaves], shafts)

  const env: StageEnv = {
    hemi: { sky: '#cfe8ff', ground: '#4e6a2e', intensity: 1.05 },
    key: { color: '#fff4d8', intensity: 2.7, position: [-1.4, 3.6, 4.0] },
    rims: [
      { color: '#ffe6a0', intensity: 1.3, position: [-4, 3, -2.4] },
      { color: '#9fd8ff', intensity: 1.1, position: [4, 2.6, -2.6] },
    ],
  }

  let t = 0
  return {
    group,
    env,
    update(dt, phase) {
      t += dt
      pollen.update(dt, phase)
      leaves.update(dt, phase)
      for (const b of bands) b.update(dt)
      // The near trees breathe rather than rotate: a forest that spins reads
      // as a carousel.
      bands[2].mesh.rotation.y = Math.sin(t * 0.13) * 0.012
      bands[2].mesh.scale.set(1 + Math.sin(t * 0.5) * 0.002, 1, 1 + Math.cos(t * 0.4) * 0.002)
      for (let i = 0; i < shafts.length; i++) {
        if (!shafts[i].visible) continue
        const m = shafts[i].material as THREE.MeshBasicMaterial
        m.opacity = 0.09 + 0.035 * Math.sin(t * 0.5 + i * 1.7) + 0.02 * Math.max(0, Math.cos(phase * Math.PI * 2))
      }
    },
    setQuality(q) { quality.apply(q) },
    dispose() { disposeTree(group) },
  }
}
