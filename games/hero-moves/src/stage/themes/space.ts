/**
 * Deep Space — a nebula, a ringed planet and a glass dance floor.
 *
 * The easiest theme to keep the heroes legible in: everything behind them is
 * dark, so a crayon character is the brightest thing on screen by a mile. The
 * work here is depth — a painted nebula, two drifting cloud bands, a parallaxed
 * planet and a starfield that twinkles — because a black screen with dots is
 * flat, and this game is looked at for three minutes at a time.
 */
import * as THREE from 'three'
import {
  Band, Particles, QualitySwitch, disposeTree, dither, glowDisc, paint, rngFor, scrim, skyDome,
  spriteTex, stageFloor,
} from '../kit'
import type { Backdrop, Quality, StageEnv } from '../env'

/** The painted sky: deep field, a galactic band, and baked pinprick stars. */
const nebulaTex = (size: number) => paint(size, size / 2, (g, w, h) => {
  const rng = rngFor(20259)
  const base = g.createLinearGradient(0, 0, 0, h)
  base.addColorStop(0, '#05030f')
  base.addColorStop(0.55, '#0b0722')
  base.addColorStop(0.82, '#150c2e')
  base.addColorStop(1, '#04030c')
  g.fillStyle = base
  g.fillRect(0, 0, w, h)

  g.globalCompositeOperation = 'lighter'
  const clouds: Array<[string, number]> = [
    ['#5a1f7a', 1.0], ['#1d4f8c', 0.9], ['#8c2560', 0.75], ['#155e6b', 0.8], ['#3b2a8c', 0.9],
  ]
  for (let i = 0; i < 34; i++) {
    const [c, k] = clouds[Math.floor(rng() * clouds.length)]
    const x = rng() * w
    // Keep the loudest colour off the horizon, where the heroes stand.
    const y = h * (0.08 + rng() * 0.5)
    const r = (0.05 + rng() * 0.16) * w * k
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, `${c}aa`)
    grd.addColorStop(0.45, `${c}44`)
    grd.addColorStop(1, `${c}00`)
    g.fillStyle = grd
    g.beginPath()
    g.ellipse(x, y, r, r * (0.5 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.globalCompositeOperation = 'source-over'

  // Deliberately *no* pinprick stars painted here. A 1024-wide dome texture
  // stretched over a 97 m circumference magnifies one texel into roughly six
  // screen pixels, so painted stars arrive as soft grey squares — measured by
  // screenshot, and the reason every star in this theme is a point sprite.
  // What is baked is the faint far dust the sprites sit in front of.
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 14; i++) {
    const x = rng() * w, y = rng() * h * 0.8
    const r = w * (0.02 + rng() * 0.05)
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, 'rgba(190,205,255,0.10)')
    grd.addColorStop(1, 'rgba(190,205,255,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  g.globalCompositeOperation = 'source-over'
  dither(g, w, h, 6)
})

/** Wispy alpha clouds for the parallax bands. */
const wispTex = (size: number, seed: number) => paint(size, size / 2, (g, w, h) => {
  const rng = rngFor(seed)
  g.clearRect(0, 0, w, h)
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 22; i++) {
    const x = rng() * w
    const y = h * (0.1 + rng() * 0.6)
    const r = (0.06 + rng() * 0.14) * w
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, 'rgba(255,255,255,0.42)')
    grd.addColorStop(0.4, 'rgba(255,255,255,0.13)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.beginPath()
    g.ellipse(x, y, r, r * (0.35 + rng() * 0.4), rng() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
}, { repeat: [1, 1], wrap: true })

/** A gas giant: horizontal bands with a little turbulence. */
const planetTex = () => paint(256, 128, (g, w, h) => {
  const rng = rngFor(7717)
  const cols = ['#3d2a63', '#5b3a86', '#2b6f86', '#7a4a9c', '#1f2350', '#8a5aa8']
  let y = 0
  while (y < h) {
    const bh = 3 + rng() * 14
    g.fillStyle = cols[Math.floor(rng() * cols.length)]
    g.fillRect(0, y, w, bh + 1)
    y += bh
  }
  // Smear the bands sideways so they read as gas, not stripes.
  for (let i = 0; i < 60; i++) {
    const yy = rng() * h
    g.globalAlpha = 0.18
    g.drawImage(g.canvas, 0, yy, w, 4, (rng() - 0.5) * 26, yy, w, 4)
  }
  g.globalAlpha = 1
  const shade = g.createLinearGradient(0, 0, 0, h)
  shade.addColorStop(0, 'rgba(0,0,0,0.5)')
  shade.addColorStop(0.4, 'rgba(255,255,255,0.06)')
  shade.addColorStop(1, 'rgba(0,0,0,0.6)')
  g.fillStyle = shade
  g.fillRect(0, 0, w, h)
})

const ringTex = () => paint(256, 256, (g, w, h) => {
  const rng = rngFor(4242)
  g.clearRect(0, 0, w, h)
  const cx = w / 2, cy = h / 2
  for (let r = w * 0.5; r > w * 0.28; r -= 1) {
    const a = 0.06 + rng() * 0.3
    g.strokeStyle = `rgba(${190 + rng() * 60 | 0},${170 + rng() * 60 | 0},${230},${a})`
    g.lineWidth = 1.4
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke()
  }
})

/** The dance floor: concentric neon rings on black glass. */
const floorTex = () => paint(512, 512, (g, w, h) => {
  const cx = w / 2, cy = h / 2
  g.fillStyle = '#0a0a18'
  g.fillRect(0, 0, w, h)
  const glow = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2)
  glow.addColorStop(0, '#1d2a52')
  glow.addColorStop(0.55, '#131934')
  glow.addColorStop(1, '#07070f')
  g.fillStyle = glow
  g.fillRect(0, 0, w, h)
  for (let i = 1; i <= 7; i++) {
    g.strokeStyle = i % 2 ? 'rgba(90,220,255,0.30)' : 'rgba(190,110,255,0.22)'
    g.lineWidth = i % 2 ? 2.5 : 1.5
    g.beginPath(); g.arc(cx, cy, (i / 7.4) * (w / 2), 0, Math.PI * 2); g.stroke()
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    g.strokeStyle = 'rgba(120,180,255,0.10)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(cx, cy)
    g.lineTo(cx + Math.cos(a) * w * 0.5, cy + Math.sin(a) * w * 0.5)
    g.stroke()
  }
})

/**
 * Stars as points rather than pixels in the dome: they twinkle, and they sit
 * off the dome surface so the small camera orbit gives them parallax.
 */
class Starfield {
  readonly points: THREE.Points
  private base: Float32Array
  private phase: Float32Array
  private col: THREE.BufferAttribute
  private t = 0
  constructor(count: number, size: number, seed: number) {
    const rng = rngFor(seed)
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    this.base = new Float32Array(count * 3)
    this.phase = new Float32Array(count)
    const c = new THREE.Color()
    const tints = ['#ffffff', '#cfe0ff', '#ffe6c8', '#bfe9ff']
    for (let i = 0; i < count; i++) {
      // Upper hemisphere shell only: nothing sparkles behind a hero's knees.
      const a = rng() * Math.PI * 2
      const y = 0.06 + rng() * 0.9
      const r = Math.sqrt(1 - y * y)
      const d = 11 + rng() * 3
      pos[i * 3] = Math.cos(a) * r * d
      pos[i * 3 + 1] = y * d * 0.85 + 1
      pos[i * 3 + 2] = Math.sin(a) * r * d
      c.set(tints[Math.floor(rng() * tints.length)])
      this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
      this.phase[i] = rng() * Math.PI * 2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.col = new THREE.BufferAttribute(col, 3)
    geo.setAttribute('color', this.col)
    geo.setDrawRange(0, count)
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: spriteTex('star', 64), transparent: true, vertexColors: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
      fog: false, toneMapped: false,
    }))
    this.points.frustumCulled = false
  }
  /** Twinkle fewer of them on the cheap path. */
  setCount(n: number) { this.points.geometry.setDrawRange(0, n) }

  update(dt: number) {
    this.t += dt
    const n = Math.min(this.phase.length, this.points.geometry.drawRange.count)
    const arr = this.col.array as Float32Array
    for (let i = 0; i < n; i++) {
      const k = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this.t * 1.6 + this.phase[i]))
      arr[i * 3] = this.base[i * 3] * k
      arr[i * 3 + 1] = this.base[i * 3 + 1] * k
      arr[i * 3 + 2] = this.base[i * 3 + 2] * k
    }
    this.col.needsUpdate = true
    this.points.rotation.y += dt * 0.006
  }
}

export function create(q: Quality): Backdrop {
  const group = new THREE.Group()
  const full = q === 'full'

  group.add(skyDome(nebulaTex(full ? 1024 : 512)))

  const bands = [
    new Band({
      radius: 12.5, height: 16, y: 4, repeat: 2, texture: wispTex(full ? 512 : 256, 31),
      color: '#7c4bd0', opacity: 0.55, blending: THREE.AdditiveBlending, drift: 0.004,
    }),
    new Band({
      radius: 9.5, height: 13, y: 3.4, repeat: 2, texture: wispTex(full ? 512 : 256, 77),
      color: '#2f8fd0', opacity: 0.4, blending: THREE.AdditiveBlending, drift: -0.007,
    }),
  ]
  for (const b of bands) group.add(b.mesh)

  // Two fields: a fine dust, and a scatter of bright ones with visible spikes.
  const stars = [
    new Starfield(620, 0.075, 9091),
    new Starfield(90, 0.26, 3307),
  ]
  for (const f of stars) group.add(f.points)
  stars[0].setCount(full ? 620 : 220)
  stars[1].setCount(full ? 90 : 34)

  // The planet, parked high and to one side so it never sits behind a face.
  const planet = new THREE.Group()
  planet.position.set(-8.6, 6.4, -10.5)
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(2.5, 32, 24),
    new THREE.MeshStandardMaterial({ map: planetTex(), roughness: 1, metalness: 0 }),
  )
  planet.add(ball)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 5.1, 72),
    new THREE.MeshBasicMaterial({
      map: ringTex(), transparent: true, side: THREE.DoubleSide, depthWrite: false,
      opacity: 0.85, fog: false, toneMapped: false,
    }),
  )
  ring.rotation.set(-Math.PI * 0.36, 0.35, 0.2)
  planet.add(ring)
  const halo = glowDisc('#8f6cff', 8, 0.28)
  halo.position.z = -1.2
  planet.add(halo)
  group.add(planet)

  // A small moon on the other side, for balance.
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 20, 16),
    new THREE.MeshStandardMaterial({ color: '#cbd3e8', roughness: 1 }),
  )
  moon.position.set(7.4, 5.2, -9)
  group.add(moon)

  group.add(stageFloor({
    radius: 3.4, map: floorTex(), color: '#8fa8d8', roughness: 0.45,
    emissive: '#1b2a5c', emissiveIntensity: 0.5,
    pool: { color: '#7fd8ff', opacity: 0.3, radius: 2.6 },
    contact: 0.5,
  }))

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.06, 8, 72),
    new THREE.MeshStandardMaterial({
      color: '#5ce0ff', emissive: '#33c8ff', emissiveIntensity: 1.4, roughness: 0.4,
    }),
  )
  rim.rotation.x = -Math.PI / 2
  rim.position.y = 0.02
  group.add(rim)

  // Uplight under the platform edge, so it reads as glass rather than a decal.
  const under = glowDisc('#3aa0ff', 6.2, 0.24)
  under.rotation.x = -Math.PI / 2
  under.position.y = 0.005
  group.add(under)

  group.add(scrim('#06060f', 0.34))

  const motes = new Particles({
    count: full ? 180 : 70, texture: spriteTex('glow', 32), size: 0.07,
    bounds: [6, 3.2, 2.4], centre: [0, 2.4, -2], velocity: [0.05, 0.03, 0],
    colors: ['#9fd8ff', '#d7b6ff', '#ffffff'], opacity: 0.55, sway: 0.05, seed: 55, beat: 0.25,
  }, q)
  group.add(motes.points)

  // One shooting star, reused: it flies, then waits a random few seconds.
  const shot = new THREE.Sprite(new THREE.SpriteMaterial({
    map: spriteTex('streak', 128), color: '#ffffff', transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false,
  }))
  shot.scale.set(3.4, 3.4, 1)
  group.add(shot)
  let shotT = 0, shotWait = 2.5

  const quality = new QualitySwitch([motes], [shot])
  const setStars = (q: Quality) => {
    stars[0].setCount(q === 'full' ? 620 : 220)
    stars[1].setCount(q === 'full' ? 90 : 34)
  }

  const env: StageEnv = {
    hemi: { sky: '#7f96d8', ground: '#140c2c', intensity: 0.75 },
    key: { color: '#e9f0ff', intensity: 2.4, position: [1.1, 3.2, 4.4] },
    rims: [
      { color: '#38d6ff', intensity: 2.0, position: [-4.2, 2.4, -2.6] },
      { color: '#ff56c8', intensity: 1.8, position: [4.2, 2.6, -2.4] },
    ],
  }

  let t = 0
  return {
    group,
    env,
    update(dt, phase) {
      t += dt
      for (const f of stars) f.update(dt)
      motes.update(dt, phase)
      for (const b of bands) b.update(dt)
      planet.rotation.y += dt * 0.02
      ball.rotation.y += dt * 0.03
      const pulse = 1.05 + 0.75 * Math.max(0, Math.cos(phase * Math.PI * 2))
      ;(rim.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse
      ;(under.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.1 * (pulse - 1)

      shotT += dt
      if (shotT > shotWait) {
        const k = (shotT - shotWait) / 1.1
        if (k >= 1) { shotT = 0; shotWait = 3 + (t * 7919 % 5) }
        else {
          const m = shot.material as THREE.SpriteMaterial
          m.opacity = Math.sin(k * Math.PI) * 0.9
          shot.position.set(-9 + k * 17, 8.2 - k * 3.4, -9)
        }
      } else {
        (shot.material as THREE.SpriteMaterial).opacity = 0
      }
    },
    setQuality(q) { quality.apply(q); setStars(q) },
    dispose() { disposeTree(group) },
  }
}
