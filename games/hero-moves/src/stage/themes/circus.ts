/**
 * Big Top — inside the tent, under the lights.
 *
 * Stripes are the whole identity of a circus tent and also the loudest possible
 * thing to put behind a character, so they live overhead: the canvas converges
 * to the apex above the heroes, and at their eye level there is a dark ring of
 * audience instead. Two sweeping specials cross behind the line and the beat
 * shows up as a swell of confetti and a pulse in the ring lights.
 */
import * as THREE from 'three'
import {
  Band, Particles, disposeTree, glowDisc, lightShaft, paint, paperTexture, rngFor, scrim,
  skyDome, spriteTex, stageFloor,
} from '../kit'
import type { Backdrop, Quality, StageEnv } from '../env'

/** The canvas overhead: meridian stripes that meet at the apex of the dome. */
const tentTex = (size: number) => paint(size, size / 2, (g, w, h) => {
  const stripes = 28
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#c62b3b' : '#f7ead0'
    g.fillRect((i / stripes) * w, 0, w / stripes + 1, h)
  }
  // Shade down towards the horizon so the tent recedes and the ring is dark.
  const v = g.createLinearGradient(0, 0, 0, h)
  v.addColorStop(0, 'rgba(255,240,210,0.35)')
  v.addColorStop(0.3, 'rgba(0,0,0,0)')
  v.addColorStop(0.5, 'rgba(40,6,14,0.55)')
  v.addColorStop(0.62, 'rgba(24,4,10,0.9)')
  v.addColorStop(1, 'rgba(12,2,6,1)')
  g.fillStyle = v
  g.fillRect(0, 0, w, h)
  // Seams where the panels are laced together.
  g.strokeStyle = 'rgba(90,20,30,0.35)'
  g.lineWidth = Math.max(1, size / 512)
  for (let i = 0; i <= stripes; i++) {
    g.beginPath(); g.moveTo((i / stripes) * w, 0); g.lineTo((i / stripes) * w, h * 0.6); g.stroke()
  }
})

/** Triangular bunting hanging from a swagged cord. */
const buntingTex = (w: number, colors: string[], seed: number) => paint(w, w / 8, (g, cw, ch) => {
  const rng = rngFor(seed)
  g.clearRect(0, 0, cw, ch)
  const n = 24
  const sag = ch * 0.22
  const cordY = (x: number) => ch * 0.12 + Math.abs(Math.sin((x / cw) * Math.PI * n / 3)) * 0 + sag * Math.sin((x / cw) * Math.PI * 6) ** 2
  g.strokeStyle = '#f3e4c2'
  g.lineWidth = Math.max(1.5, cw / 400)
  g.beginPath()
  for (let x = 0; x <= cw; x += 4) {
    const y = cordY(x)
    if (x === 0) g.moveTo(x, y); else g.lineTo(x, y)
  }
  g.stroke()
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * (cw / n)
    const y = cordY(x)
    const fw = cw / n * 0.78
    const fh = ch * 0.62
    g.fillStyle = colors[Math.floor(rng() * colors.length)]
    g.beginPath()
    g.moveTo(x - fw / 2, y)
    g.lineTo(x + fw / 2, y)
    g.lineTo(x, y + fh)
    g.closePath()
    g.fill()
    g.fillStyle = 'rgba(0,0,0,0.18)'
    g.beginPath()
    g.moveTo(x + fw * 0.1, y); g.lineTo(x + fw / 2, y); g.lineTo(x, y + fh)
    g.closePath(); g.fill()
  }
}, { repeat: [1, 1], wrap: true })

/** The house: rows of heads in the dark, with the odd catchlight. */
const crowdTex = (w: number) => paint(w, w / 4, (g, cw, ch) => {
  const rng = rngFor(515)
  g.clearRect(0, 0, cw, ch)
  const rows = [
    { y: ch * 1.0, s: 0.30, c: '#1a0710' },
    { y: ch * 0.92, s: 0.24, c: '#2a0d18' },
    { y: ch * 0.84, s: 0.19, c: '#3a1422' },
  ]
  for (const r of rows) {
    const n = Math.round(cw / (ch * r.s * 1.5))
    for (let i = 0; i < n; i++) {
      const x = (i + rng() * 0.6) * (cw / n)
      const hd = ch * r.s
      g.fillStyle = r.c
      g.beginPath(); g.arc(x, r.y - hd * 1.15, hd * 0.42, 0, Math.PI * 2); g.fill()
      g.beginPath()
      g.ellipse(x, r.y, hd * 0.85, hd * 1.0, 0, Math.PI, Math.PI * 2)
      g.fill()
      g.fillRect(x - hd * 0.85, r.y, hd * 1.7, ch - r.y)
      if (rng() < 0.16) {
        g.fillStyle = 'rgba(255,196,120,0.5)'
        g.beginPath(); g.arc(x + hd * 0.2, r.y - hd * 1.2, hd * 0.09, 0, Math.PI * 2); g.fill()
      }
    }
  }
}, { repeat: [1, 1], wrap: true })

/** Sawdust: warm, dusty, trodden. */
const sawdustTex = (size: number) => paint(size, size, (g, w, h) => {
  const rng = rngFor(1212)
  g.fillStyle = '#d8b985'
  g.fillRect(0, 0, w, h)
  const cols = ['#c9a870', '#e6cd9c', '#bb9a63', '#f0dcb2']
  for (let i = 0; i < size * 18; i++) {
    g.fillStyle = cols[Math.floor(rng() * cols.length)]
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 2.5, 1 + rng() * 2)
  }
}, { wrap: true })

/** Red and cream barrier stripes for the ring kerb. */
const kerbTex = () => paint(256, 16, (g, w, h) => {
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? '#d8342f' : '#f6ead2'
    g.fillRect((i / 24) * w, 0, w / 24 + 1, h)
  }
}, { repeat: [8, 1] })

export function create(q: Quality): Backdrop {
  const group = new THREE.Group()
  const full = q === 'full'
  const T = full ? 1024 : 512

  group.add(skyDome(tentTex(T)))

  const bands = [
    new Band({
      radius: 8.4, height: 4.2, y: 1.5, texture: crowdTex(T), opacity: 1,
    }),
    new Band({
      radius: 9.6, height: 2.4, y: 6.4,
      texture: buntingTex(T, ['#ffd23f', '#e8453c', '#3fa9f5', '#59c36a', '#ff8ac4'], 3),
      drift: 0.008,
    }),
    new Band({
      radius: 6.6, height: 1.9, y: 5.0,
      texture: buntingTex(T, ['#ffd23f', '#e8453c', '#3fa9f5', '#59c36a', '#ff8ac4'], 9),
      drift: -0.012,
    }),
  ]
  for (const b of bands) group.add(b.mesh)

  // Two striped poles well outside the line of heroes.
  const poleMat = new THREE.MeshStandardMaterial({
    map: (() => { const t = kerbTex(); t.repeat.set(1, 14); t.rotation = Math.PI / 2; t.center.set(0.5, 0.5); return t })(),
    color: '#ffffff', roughness: 0.7,
  })
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 9, 12), poleMat)
    pole.position.set(side * 5.2, 4.5, -3.4)
    group.add(pole)
  }

  const sawdust = sawdustTex(full ? 512 : 256)
  sawdust.repeat.set(3, 3)
  const surround = paperTexture('#b08c5c', 24)
  surround.repeat.set(8, 8)
  group.add(stageFloor({
    radius: 3.5, map: sawdust, color: '#f0d6a8', roughness: 1,
    surround: { color: '#7a5a38', map: surround, radius: 12 },
    pool: { color: '#ffe0a8', opacity: 0.34, radius: 2.8 },
    contact: 0.44,
  }))

  // The ring kerb.
  const kerb = new THREE.Mesh(
    new THREE.TorusGeometry(3.5, 0.16, 10, 96),
    new THREE.MeshStandardMaterial({ map: kerbTex(), roughness: 0.75, color: '#ffffff' }),
  )
  kerb.rotation.x = -Math.PI / 2
  kerb.position.y = 0.13
  group.add(kerb)

  // Two specials sweeping across the ring, crossing behind the performers.
  const specials: THREE.Group[] = []
  const specColors = ['#ff9de0', '#8fd6ff']
  for (let i = 0; i < (full ? 2 : 1); i++) {
    const pivot = new THREE.Group()
    pivot.position.set((i ? 3.6 : -3.6), 7.6, -2.2)
    const cone = lightShaft(specColors[i], 0.22, 1.5, 8.4, 0.22)
    cone.position.y = -4.2
    pivot.add(cone)
    group.add(pivot)
    specials.push(pivot)
  }

  // Ring of festoon bulbs above the kerb.
  const bulbs: THREE.Mesh[] = []
  const bulbGeo = new THREE.SphereGeometry(0.1, 8, 6)
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI * 0.55 + (i / 13) * Math.PI * 1.1
    const b = new THREE.Mesh(bulbGeo, new THREE.MeshStandardMaterial({
      color: '#fff0c0', emissive: '#ffbe4a', emissiveIntensity: 1.2, roughness: 0.5,
    }))
    b.position.set(Math.sin(a) * 4.1, 0.24, Math.cos(a) * 4.1)
    group.add(b)
    bulbs.push(b)
  }

  const halo = glowDisc('#ffb96a', 6, 0.22)
  halo.position.set(0, 2.2, -5.6)
  group.add(halo)

  group.add(scrim('#2a0a14', 0.4))

  const confetti = new Particles({
    count: full ? 220 : 90, texture: spriteTex('chip', 32), size: 0.1,
    bounds: [5.5, 3.6, 2.6], centre: [0, 3.2, -1.4], velocity: [0.1, -0.42, 0],
    colors: ['#ffd23f', '#e8453c', '#3fa9f5', '#59c36a', '#ff8ac4', '#ffffff'],
    opacity: 0.95, sway: 0.42, swayRate: 1.9, seed: 71, blending: THREE.NormalBlending,
    beat: 0.35,
  }, q)
  group.add(confetti.points)

  const env: StageEnv = {
    hemi: { sky: '#ffe3c8', ground: '#59202a', intensity: 0.95 },
    key: { color: '#fff1d8', intensity: 2.6, position: [0.8, 3.4, 4.2] },
    rims: [
      { color: '#ff6b8f', intensity: 1.7, position: [-4, 2.8, -2.4] },
      { color: '#7fd4ff', intensity: 1.5, position: [4, 2.8, -2.4] },
    ],
  }

  let t = 0
  return {
    group,
    env,
    update(dt, phase) {
      t += dt
      confetti.update(dt, phase)
      for (const b of bands) b.update(dt)
      for (let i = 0; i < specials.length; i++) {
        const dir = i ? -1 : 1
        specials[i].rotation.z = dir * (0.34 + Math.sin(t * 0.55 + i * 2.1) * 0.26)
        specials[i].rotation.x = Math.sin(t * 0.37 + i) * 0.1
      }
      const beat = Math.max(0, Math.cos(phase * Math.PI * 2))
      for (let i = 0; i < bulbs.length; i++) {
        const m = bulbs[i].material as THREE.MeshStandardMaterial
        m.emissiveIntensity = i % 2 === (Math.floor(t * 2) % 2) ? 0.5 + beat * 1.3 : 0.4
      }
      ;(halo.material as THREE.MeshBasicMaterial).opacity = 0.18 + beat * 0.08
    },
    dispose() { disposeTree(group) },
  }
}
