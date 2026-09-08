/**
 * Coral Reef — a sunlit lagoon floor.
 *
 * Everything here is about light coming from one direction: down. The surface
 * shimmers overhead, god rays fall through it, and the same caustic pattern
 * that lights the sand is scrolled across the dance floor, which is the cheapest
 * way to make a static disc look like it is underwater. Bubbles rise, kelp
 * sways, and a school of fish crosses the back every few bars.
 */
import * as THREE from 'three'
import {
  Band, Particles, disposeTree, lightShaft, paint, rngFor, scrim, skyDome, spriteTex, stageFloor,
} from '../kit'
import type { Backdrop, Quality, StageEnv } from '../env'

const waterTex = (size: number) => paint(size, size / 2, (g, w, h) => {
  const rng = rngFor(808)
  const grd = g.createLinearGradient(0, 0, 0, h)
  grd.addColorStop(0, '#9ff2f0')
  grd.addColorStop(0.14, '#3fc4d8')
  grd.addColorStop(0.42, '#1878ad')
  grd.addColorStop(0.72, '#0b3f74')
  grd.addColorStop(1, '#05203f')
  g.fillStyle = grd
  g.fillRect(0, 0, w, h)
  // Shafts baked into the sky, so the water has depth before anything moves.
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 26; i++) {
    const x = rng() * w
    const wd = w * (0.004 + rng() * 0.02)
    const len = h * (0.2 + rng() * 0.45)
    const s = g.createLinearGradient(x, 0, x + wd * 3, len)
    s.addColorStop(0, 'rgba(190,255,255,0.34)')
    s.addColorStop(1, 'rgba(190,255,255,0)')
    g.fillStyle = s
    g.beginPath()
    g.moveTo(x, 0); g.lineTo(x + wd, 0); g.lineTo(x + wd * 5, len); g.lineTo(x + wd * 2, len)
    g.closePath(); g.fill()
  }
  // Distant particulate, which is what actually says "underwater".
  for (let i = 0; i < size * 2; i++) {
    g.fillStyle = `rgba(220,255,255,${0.05 + rng() * 0.2})`
    g.beginPath(); g.arc(rng() * w, rng() * h, 0.5 + rng() * 1.2, 0, Math.PI * 2); g.fill()
  }
  g.globalCompositeOperation = 'source-over'
})

/** A tiling caustic web, summed from sine waves so the tile is seamless. */
const causticTex = (size: number) => paint(size, size, (g, w, h) => {
  const img = g.createImageData(w, h)
  const d = img.data
  const k = (n: number) => (2 * Math.PI * n) / w
  const waves = [
    [k(3), k(2), 0.0], [k(-2), k(3), 1.7], [k(4), k(-1), 3.1], [k(1), k(5), 2.2],
  ]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (const [kx, ky, p] of waves) s += Math.sin(kx * x + ky * y + p)
      const v = Math.pow(Math.max(0, s / waves.length) , 3)
      const a = Math.min(255, v * 520)
      const i = (y * w + x) * 4
      d[i] = 200; d[i + 1] = 255; d[i + 2] = 250; d[i + 3] = a
    }
  }
  g.putImageData(img, 0, 0)
}, { repeat: [1, 1], wrap: true })

const sandTex = (size: number) => paint(size, size, (g, w, h) => {
  const rng = rngFor(4646)
  g.fillStyle = '#d9cba2'
  g.fillRect(0, 0, w, h)
  // Ripples: the sand under shallow water is never flat.
  for (let y = 0; y < h; y += 3) {
    const off = Math.sin(y * 0.06) * 8
    g.strokeStyle = `rgba(160,145,110,${0.12 + rng() * 0.1})`
    g.lineWidth = 1.6
    g.beginPath()
    for (let x = 0; x <= w; x += 6) g.lineTo(x, y + Math.sin(x * 0.05 + y * 0.1) * 2.2 + off * 0.1)
    g.stroke()
  }
  for (let i = 0; i < size * 8; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,250,230,0.5)' : 'rgba(140,125,95,0.35)'
    g.fillRect(rng() * w, rng() * h, 1.5, 1.5)
  }
}, { wrap: true })

interface WeedOpts { seed: number, colors: string[], count: number, minH: number, maxH: number }

/** Kelp and coral silhouettes: swaying fronds and knobbly heads. */
const weedTex = (w: number, h: number, o: WeedOpts) => paint(w, h, (g, cw, ch) => {
  const rng = rngFor(o.seed)
  g.clearRect(0, 0, cw, ch)
  const stalk = (x: number) => {
    const hh = ch * (o.minH + rng() * (o.maxH - o.minH))
    const col = o.colors[Math.floor(rng() * o.colors.length)]
    g.strokeStyle = col
    g.fillStyle = col
    if (rng() < 0.6) {
      // Kelp: a curved stalk with leaves.
      const bend = (rng() - 0.5) * cw * 0.03
      g.lineWidth = Math.max(2, ch * 0.012)
      g.beginPath()
      g.moveTo(x, ch)
      g.quadraticCurveTo(x + bend, ch - hh * 0.6, x + bend * 2.4, ch - hh)
      g.stroke()
      for (let i = 1; i < 7; i++) {
        const t = i / 7
        const px = x + bend * 2.4 * t * t
        const py = ch - hh * t
        g.beginPath()
        g.ellipse(px + (i % 2 ? 1 : -1) * hh * 0.06, py, hh * 0.07, hh * 0.022,
          (i % 2 ? 0.3 : -0.3), 0, Math.PI * 2)
        g.fill()
      }
    } else {
      // Coral head: a cluster of lumps.
      for (let i = 0; i < 9; i++) {
        const px = x + (rng() - 0.5) * hh * 0.7
        const py = ch - rng() * hh * 0.6
        g.beginPath(); g.arc(px, py, hh * (0.08 + rng() * 0.14), 0, Math.PI * 2); g.fill()
      }
    }
  }
  for (let i = 0; i < o.count; i++) {
    const x = (i / o.count) * cw + (rng() - 0.5) * (cw / o.count)
    stalk(x)
    if (x < cw * 0.08) stalk(x + cw)
    if (x > cw * 0.92) stalk(x - cw)
  }
}, { repeat: [1, 1], wrap: true })

/** A little fish, drawn once and instanced as sprites. */
const fishTex = () => paint(64, 32, (g, w, h) => {
  g.clearRect(0, 0, w, h)
  g.fillStyle = '#ffd27a'
  g.beginPath()
  g.ellipse(w * 0.42, h * 0.5, w * 0.32, h * 0.3, 0, 0, Math.PI * 2)
  g.fill()
  g.beginPath()
  g.moveTo(w * 0.72, h * 0.5); g.lineTo(w * 0.97, h * 0.16); g.lineTo(w * 0.97, h * 0.84)
  g.closePath(); g.fill()
  g.fillStyle = 'rgba(255,255,255,0.55)'
  g.beginPath(); g.ellipse(w * 0.35, h * 0.4, w * 0.16, h * 0.12, 0, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#22303a'
  g.beginPath(); g.arc(w * 0.2, h * 0.46, w * 0.03, 0, Math.PI * 2); g.fill()
})

export function create(q: Quality): Backdrop {
  const group = new THREE.Group()
  const full = q === 'full'
  const T = full ? 1024 : 512

  group.add(skyDome(waterTex(T)))

  // The surface, seen from underneath.
  const surfaceTex = causticTex(full ? 256 : 128)
  surfaceTex.repeat.set(4, 4)
  const surface = new THREE.Mesh(
    new THREE.CircleGeometry(14, 40),
    new THREE.MeshBasicMaterial({
      map: surfaceTex, transparent: true, opacity: 0.5, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
    }),
  )
  surface.rotation.x = Math.PI / 2
  surface.position.y = 9.5
  group.add(surface)

  const bands = [
    new Band({
      radius: 11, height: 9, y: 3.2,
      texture: weedTex(T, T / 3, {
        seed: 5, colors: ['#12546f', '#166b82', '#0e4560'], count: 20, minH: 0.4, maxH: 0.8,
      }),
      opacity: 0.9, drift: 0.003,
    }),
    new Band({
      radius: 7.2, height: 8, y: 2.6,
      texture: weedTex(T, T / 2, {
        seed: 66, colors: ['#0b3347', '#0f4257', '#123b4a', '#1d5a5e'], count: 14,
        minH: 0.5, maxH: 0.95,
      }),
    }),
  ]
  for (const b of bands) group.add(b.mesh)

  const sand = sandTex(full ? 512 : 256)
  sand.repeat.set(8, 8)
  const disc = sandTex(full ? 512 : 256)
  disc.repeat.set(3, 3)
  group.add(stageFloor({
    radius: 3.5, map: disc, color: '#bfd9d8', roughness: 1,
    surround: { color: '#8fb2b4', map: sand, radius: 13 },
    pool: { color: '#bff4ff', opacity: 0.22, radius: 2.8 },
    contact: 0.4,
  }))

  // Caustics crawling across the floor: the same tile, scrolled.
  const floorCaustic = causticTex(full ? 256 : 128)
  floorCaustic.repeat.set(3, 3)
  const caustic = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 48),
    new THREE.MeshBasicMaterial({
      map: floorCaustic, transparent: true, opacity: 0.42, depthWrite: false,
      blending: THREE.AdditiveBlending, color: '#a8fff2', fog: false, toneMapped: false,
    }),
  )
  caustic.rotation.x = -Math.PI / 2
  caustic.position.y = 0.02
  group.add(caustic)

  // God rays.
  const rays: THREE.Mesh[] = []
  const rayCount = full ? 4 : 2
  for (let i = 0; i < rayCount; i++) {
    const s = lightShaft('#cffcff', 0.5, 2.2, 12, 0.14)
    const a = -0.9 + (i / (rayCount - 1 || 1)) * 1.8
    s.position.set(Math.sin(a) * 4.6, 5.6, -3.2 - Math.cos(a) * 1.6)
    s.rotation.z = a * 0.34
    group.add(s)
    rays.push(s)
  }

  group.add(scrim('#052236', 0.42))

  const bubbles = new Particles({
    count: full ? 150 : 60, texture: spriteTex('bubble', 48), size: 0.13,
    bounds: [5.2, 3.6, 2.4], centre: [0, 3.4, -1.6], velocity: [0.02, 0.5, 0],
    colors: ['#dffcff', '#bfe9ff', '#ffffff'], opacity: 0.6, sway: 0.14, swayRate: 2.2,
    seed: 33, blending: THREE.NormalBlending, beat: 0.2,
  }, q)
  group.add(bubbles.points)

  const plankton = new Particles({
    count: full ? 200 : 80, texture: spriteTex('glow', 32), size: 0.05,
    bounds: [6, 3.4, 3], centre: [0, 2.6, -1.6], velocity: [0.09, 0.02, 0],
    colors: ['#c9fff4', '#9fe0ff', '#fff6c8'], opacity: 0.5, sway: 0.06, seed: 12,
  }, q)
  group.add(plankton.points)

  // A school crossing the back. Sprites, so they always face the camera.
  const school = new THREE.Group()
  if (full) {
    const fish = fishTex()
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: fish, transparent: true, depthWrite: false, fog: false, toneMapped: false,
        color: i % 3 === 0 ? '#ff9f5a' : i % 3 === 1 ? '#ffd27a' : '#8fe0ff',
      }))
      s.scale.set(0.55, 0.28, 1)
      s.position.set((i % 3) * 0.7, 2.6 + Math.sin(i) * 0.7, -5.4 - (i % 4) * 0.5)
      school.add(s)
    }
    group.add(school)
  }

  const env: StageEnv = {
    hemi: { sky: '#7fe6f0', ground: '#0b3a52', intensity: 1.15 },
    key: { color: '#dff6ff', intensity: 2.4, position: [0.6, 4.2, 3.6] },
    rims: [
      { color: '#39d6ff', intensity: 1.6, position: [-4, 3, -2.6] },
      { color: '#7affd6', intensity: 1.2, position: [4, 2.6, -2.6] },
    ],
  }

  let t = 0
  return {
    group,
    env,
    update(dt, phase) {
      t += dt
      bubbles.update(dt, phase)
      plankton.update(dt, phase)
      for (const b of bands) b.update(dt)
      // Kelp sways by shearing the band a hair, not by animating vertices.
      bands[1].mesh.rotation.y = Math.sin(t * 0.35) * 0.02
      bands[0].mesh.rotation.z = Math.sin(t * 0.22) * 0.004
      floorCaustic.offset.set(t * 0.017, t * 0.023)
      surfaceTex.offset.set(Math.sin(t * 0.06) * 0.2, t * 0.012)
      const beat = Math.max(0, Math.cos(phase * Math.PI * 2))
      ;(caustic.material as THREE.MeshBasicMaterial).opacity = 0.34 + beat * 0.14
      for (let i = 0; i < rays.length; i++) {
        const m = rays[i].material as THREE.MeshBasicMaterial
        m.opacity = 0.1 + 0.045 * Math.sin(t * 0.6 + i * 1.3) + beat * 0.02
        rays[i].rotation.z = (-0.9 + (i / (rays.length - 1 || 1)) * 1.8) * 0.34
          + Math.sin(t * 0.3 + i) * 0.03
      }
      if (school.children.length) {
        school.position.x = Math.sin(t * 0.16) * 5.5
        school.position.z = Math.cos(t * 0.16) * 1.2
        school.position.y = Math.sin(t * 0.4) * 0.25
        const dir = Math.cos(t * 0.16) >= 0 ? 1 : -1
        for (let i = 0; i < school.children.length; i++) {
          const s = school.children[i] as THREE.Sprite
          s.scale.x = 0.55 * dir
          s.position.y += Math.sin(t * 2 + i) * dt * 0.12
        }
      }
    },
    dispose() { disposeTree(group) },
  }
}
