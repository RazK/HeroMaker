/**
 * Rooftop Sunset — a city skyline at golden hour, seen from a roof.
 *
 * The brightest sky of the six, so the layout does the contrast work: the sun
 * sits low and off to one side rather than behind the line of heroes, and three
 * skyline bands stack into a near-black horizon exactly where the bodies are.
 * The warmth comes back in as festoon lights strung round the roof, which are
 * also what pulses on the beat.
 */
import * as THREE from 'three'
import {
  Band, Particles, disposeTree, glowDisc, paint, rngFor, scrim, skyDome, spriteTex, stageFloor,
} from '../kit'
import type { Backdrop, Quality, StageEnv } from '../env'

const skyTex = (size: number) => paint(size, size / 2, (g, w, h) => {
  const rng = rngFor(6060)
  const sky = g.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#221a4d')
  sky.addColorStop(0.22, '#4b2a6b')
  sky.addColorStop(0.44, '#95396f')
  sky.addColorStop(0.62, '#d46154')
  sky.addColorStop(0.76, '#f79c4e')
  sky.addColorStop(0.88, '#ffcf7a')
  sky.addColorStop(1, '#ffe6a8')
  g.fillStyle = sky
  g.fillRect(0, 0, w, h)

  // The sun, parked a third of the way round so it is never behind a face.
  const sx = w * 0.68, sy = h * 0.79
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, w * 0.17)
  sun.addColorStop(0, 'rgba(255,250,222,1)')
  sun.addColorStop(0.09, 'rgba(255,232,160,0.92)')
  sun.addColorStop(0.3, 'rgba(255,170,90,0.35)')
  sun.addColorStop(1, 'rgba(255,140,80,0)')
  g.fillStyle = sun
  g.fillRect(0, 0, w, h)

  // Streaky, backlit cloud bars — the whole character of a sunset.
  for (let i = 0; i < 30; i++) {
    const y = h * (0.18 + rng() * 0.62)
    const x = rng() * w
    const len = w * (0.06 + rng() * 0.22)
    const th = h * (0.008 + rng() * 0.03)
    const lit = 1 - Math.abs(x - sx) / w
    const grd = g.createLinearGradient(x, y, x + len, y)
    const warm = `rgba(${255},${170 + lit * 70 | 0},${120 + lit * 90 | 0},`
    grd.addColorStop(0, `${warm}0)`)
    grd.addColorStop(0.4, `${warm}${(0.18 + lit * 0.5).toFixed(2)})`)
    grd.addColorStop(1, `${warm}0)`)
    g.fillStyle = grd
    g.beginPath()
    g.ellipse(x + len / 2, y, len / 2, th, 0, 0, Math.PI * 2)
    g.fill()
    // Their shadowed undersides.
    g.fillStyle = `rgba(70,40,90,${0.1 + rng() * 0.18})`
    g.beginPath()
    g.ellipse(x + len / 2, y + th * 0.9, len / 2.4, th * 0.5, 0, 0, Math.PI * 2)
    g.fill()
  }

  // First stars, high up where the sky has already gone blue.
  for (let i = 0; i < size; i++) {
    const y = rng() * h * 0.26
    g.fillStyle = `rgba(255,255,255,${0.1 + rng() * 0.5 * (1 - y / (h * 0.26))})`
    g.beginPath(); g.arc(rng() * w, y, 0.6 + rng() * 0.7, 0, Math.PI * 2); g.fill()
  }
})

interface CityOpts {
  seed: number
  color: string
  count: number
  minH: number
  maxH: number
  /** Lit windows, off for the hazy far layer. */
  windows?: boolean
  haze?: string
}

/** A tiling skyline: boxes, setbacks, water towers, aerials. */
const cityTex = (w: number, h: number, o: CityOpts) => paint(w, h, (g, cw, ch) => {
  const rng = rngFor(o.seed)
  g.clearRect(0, 0, cw, ch)
  const tower = (x: number) => {
    const bw = cw / o.count * (0.5 + rng() * 0.8)
    const bh = ch * (o.minH + rng() * (o.maxH - o.minH))
    g.fillStyle = o.color
    g.fillRect(x, ch - bh, bw, bh)
    // A setback or a spire on some of them.
    if (rng() < 0.4) g.fillRect(x + bw * 0.25, ch - bh - bh * 0.18, bw * 0.5, bh * 0.2)
    if (rng() < 0.25) g.fillRect(x + bw * 0.46, ch - bh - bh * 0.45, bw * 0.06, bh * 0.3)
    if (rng() < 0.3) {
      // Water tower.
      const tx = x + bw * (0.2 + rng() * 0.5)
      const tw = bw * 0.22
      g.fillRect(tx, ch - bh - tw * 1.5, tw, tw * 1.2)
      g.fillRect(tx + tw * 0.1, ch - bh - tw * 0.4, tw * 0.1, tw * 0.4)
      g.fillRect(tx + tw * 0.8, ch - bh - tw * 0.4, tw * 0.1, tw * 0.4)
    }
    if (o.windows) {
      const cols = Math.max(2, Math.floor(bw / (ch * 0.022)))
      const rows = Math.max(3, Math.floor(bh / (ch * 0.03)))
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          if (rng() > 0.26) continue
          const a = 0.35 + rng() * 0.6
          g.fillStyle = rng() < 0.75 ? `rgba(255,206,120,${a})` : `rgba(180,225,255,${a * 0.7})`
          g.fillRect(x + (cx + 0.25) * (bw / cols), ch - bh + (cy + 0.3) * (bh / rows),
            (bw / cols) * 0.5, (bh / rows) * 0.42)
        }
      }
    }
  }
  for (let i = 0; i < o.count; i++) {
    const x = (i / o.count) * cw
    tower(x)
    if (i === 0) tower(cw)
  }
  if (o.haze) {
    const m = g.createLinearGradient(0, ch, 0, ch * 0.2)
    m.addColorStop(0, o.haze)
    m.addColorStop(1, 'rgba(255,255,255,0)')
    g.globalCompositeOperation = 'source-atop'
    g.fillStyle = m
    g.fillRect(0, 0, cw, ch)
    g.globalCompositeOperation = 'source-over'
  }
}, { repeat: [1, 1], wrap: true })

/** Weathered roof deck: tar, gravel, a painted circle where the dancing goes. */
const roofTex = (size: number) => paint(size, size, (g, w, h) => {
  const rng = rngFor(3131)
  g.fillStyle = '#41414f'
  g.fillRect(0, 0, w, h)
  for (let i = 0; i < size * 12; i++) {
    const v = 40 + rng() * 70 | 0
    g.fillStyle = `rgba(${v},${v - 4},${v + 8},${0.25 + rng() * 0.4})`
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 2.5, 1 + rng() * 2.5)
  }
  // Seams between the roofing sheets.
  g.strokeStyle = 'rgba(20,20,28,0.5)'
  g.lineWidth = 2
  for (let i = 0; i < 4; i++) {
    const y = (i / 4) * h + rng() * 8
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke()
  }
}, { wrap: true })

const birdTex = () => paint(64, 32, (g, w, h) => {
  g.clearRect(0, 0, w, h)
  g.strokeStyle = '#241a30'
  g.lineWidth = 3
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(w * 0.1, h * 0.62)
  g.quadraticCurveTo(w * 0.3, h * 0.28, w * 0.5, h * 0.55)
  g.quadraticCurveTo(w * 0.7, h * 0.28, w * 0.9, h * 0.62)
  g.stroke()
})

export function create(q: Quality): Backdrop {
  const group = new THREE.Group()
  const full = q === 'full'
  const T = full ? 1024 : 512

  group.add(skyDome(skyTex(T)))

  const bands = [
    new Band({
      radius: 13, height: 7, y: 2.6,
      texture: cityTex(T, T / 4, {
        seed: 2, color: '#6b4a86', count: 26, minH: 0.25, maxH: 0.7,
        haze: 'rgba(255,186,150,0.75)',
      }),
      opacity: 0.9,
    }),
    new Band({
      radius: 9.6, height: 8, y: 2.4,
      texture: cityTex(T, T / 3, {
        seed: 19, color: '#3a2547', count: 18, minH: 0.3, maxH: 0.85, windows: true,
        haze: 'rgba(255,150,120,0.28)',
      }),
    }),
    new Band({
      radius: 6.8, height: 8, y: 1.9,
      texture: cityTex(T, T / 2, {
        seed: 74, color: '#171122', count: 9, minH: 0.28, maxH: 0.7, windows: true,
      }),
    }),
  ]
  for (const b of bands) group.add(b.mesh)

  const sunGlow = glowDisc('#ffb056', 9, 0.4)
  sunGlow.position.set(6.6, 2.6, -10)
  group.add(sunGlow)

  const roof = roofTex(full ? 512 : 256)
  roof.repeat.set(3, 3)
  const surround = roofTex(full ? 512 : 256)
  surround.repeat.set(10, 10)
  group.add(stageFloor({
    radius: 3.5, map: roof, color: '#8d8a9c', roughness: 0.95,
    surround: { color: '#5c5a6b', map: surround, radius: 11 },
    pool: { color: '#ffcf8a', opacity: 0.34, radius: 2.9 },
    contact: 0.46,
  }))

  // A parapet wall, low enough to stay under the heroes' knees at the sides.
  const parapet = new THREE.Mesh(
    new THREE.CylinderGeometry(6.4, 6.4, 0.62, 40, 1, true),
    new THREE.MeshStandardMaterial({
      color: '#2c2436', roughness: 1, side: THREE.DoubleSide, map: roofTex(256),
    }),
  )
  parapet.position.y = 0.31
  group.add(parapet)

  // Festoon lights: a catenary of warm bulbs strung across the roof behind the
  // line. This is the theme's beat, and its warmth.
  const bulbs: THREE.Mesh[] = []
  const bulbGeo = new THREE.SphereGeometry(0.085, 8, 6)
  const wire = new THREE.Group()
  for (let i = 0; i < 18; i++) {
    const t = i / 17
    const a = -Math.PI * 0.62 + t * Math.PI * 1.24
    const sag = Math.sin(t * Math.PI) * 0.55
    const b = new THREE.Mesh(bulbGeo, new THREE.MeshStandardMaterial({
      color: '#fff0cc', emissive: '#ffb45a', emissiveIntensity: 1.4, roughness: 0.4,
    }))
    b.position.set(Math.sin(a) * 5.2, 3.1 - sag, Math.cos(a) * 5.2)
    wire.add(b)
    bulbs.push(b)
  }
  group.add(wire)

  group.add(scrim('#1a1026', 0.36))

  const haze = new Particles({
    count: full ? 170 : 70, texture: spriteTex('glow', 32), size: 0.08,
    bounds: [6, 3, 3], centre: [0, 2.4, -1.6], velocity: [0.07, 0.05, 0],
    colors: ['#ffd7a0', '#ffb98a', '#fff0d0'], opacity: 0.45, sway: 0.07, seed: 41, beat: 0.2,
  }, q)
  group.add(haze.points)

  // Birds, drifting across the far sky.
  const flock = new THREE.Group()
  if (full) {
    const tex = birdTex()
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, opacity: 0.7,
        fog: false, toneMapped: false,
      }))
      s.scale.set(0.5, 0.25, 1)
      s.position.set((i % 3) * 0.9 - 1, 5.4 + (i % 2) * 0.5 + Math.sin(i) * 0.3, -9)
      flock.add(s)
    }
    group.add(flock)
  }

  const env: StageEnv = {
    hemi: { sky: '#ffc79a', ground: '#2d2140', intensity: 1.0 },
    key: { color: '#ffe9cf', intensity: 2.4, position: [0.4, 3.4, 4.2] },
    rims: [
      { color: '#ff9040', intensity: 2.2, position: [4.4, 2.2, -2.6] },
      { color: '#7f9bff', intensity: 1.2, position: [-4.2, 2.8, -2.4] },
    ],
  }

  let t = 0
  return {
    group,
    env,
    update(dt, phase) {
      t += dt
      haze.update(dt, phase)
      for (const b of bands) b.update(dt)
      const beat = Math.max(0, Math.cos(phase * Math.PI * 2))
      for (let i = 0; i < bulbs.length; i++) {
        const m = bulbs[i].material as THREE.MeshStandardMaterial
        const off = (i / bulbs.length) * 0.5
        m.emissiveIntensity = 0.95 + 0.75 * Math.max(0, Math.cos((phase - off) * Math.PI * 2))
      }
      wire.position.y = Math.sin(t * 0.6) * 0.02
      ;(sunGlow.material as THREE.MeshBasicMaterial).opacity = 0.34 + beat * 0.06
      if (flock.children.length) {
        flock.position.x = ((t * 0.35 + 8) % 22) - 11
        flock.position.y = Math.sin(t * 0.25) * 0.5
        for (let i = 0; i < flock.children.length; i++) {
          const s = flock.children[i] as THREE.Sprite
          s.scale.y = 0.25 * (0.7 + 0.5 * Math.abs(Math.sin(t * 3 + i)))
        }
      }
    },
    dispose() { disposeTree(group) },
  }
}
