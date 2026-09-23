/**
 * Theatre — the original set, rebuilt on the backdrop kit.
 *
 * A purple house with the lights down and one warm special on the performers.
 * It is the default because it is the most neutral thing to put behind a
 * brightly coloured character: dark, low-contrast, and warm exactly where the
 * bodies are.
 */
import * as THREE from 'three'
import {
  Band, Particles, QualitySwitch, disposeTree, glowDisc, gradientTex, lightShaft, paint,
  paperTexture, scrim, spriteTex, stageFloor, wobble,
} from '../kit'
import type { Backdrop, Quality, StageEnv } from '../env'

/** Deep velvet folds, tiled around the house. */
const curtainTex = () => paint(512, 512, (g, w, h) => {
  g.fillStyle = '#2a1340'
  g.fillRect(0, 0, w, h)
  const folds = 16
  for (let i = 0; i < folds; i++) {
    const x = (i / folds) * w
    const fw = w / folds
    const grd = g.createLinearGradient(x, 0, x + fw, 0)
    grd.addColorStop(0, '#170a24')
    grd.addColorStop(0.42, '#5b2470')
    grd.addColorStop(0.55, '#6d2d84')
    grd.addColorStop(1, '#1c0c2c')
    g.fillStyle = grd
    g.fillRect(x, 0, fw + 1, h)
  }
  // Vertical falloff: the top of a hung curtain catches the light.
  const v = g.createLinearGradient(0, 0, 0, h)
  v.addColorStop(0, 'rgba(255,214,150,0.20)')
  v.addColorStop(0.35, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,0.55)')
  g.fillStyle = v
  g.fillRect(0, 0, w, h)
}, { repeat: [3, 1] })

/** The scalloped pelmet across the top of the proscenium, with gold trim. */
const pelmetTex = () => paint(512, 256, (g, w, h) => {
  g.clearRect(0, 0, w, h)
  const scallops = 8
  const r = w / scallops / 2
  g.fillStyle = '#5c2472'
  g.beginPath()
  g.moveTo(0, 0)
  g.lineTo(w, 0)
  g.lineTo(w, h * 0.42)
  for (let i = scallops - 1; i >= 0; i--) {
    g.arc(i * 2 * r + r, h * 0.42, r, 0, Math.PI, false)
  }
  g.lineTo(0, 0)
  g.closePath()
  g.fill()
  const v = g.createLinearGradient(0, 0, 0, h * 0.7)
  v.addColorStop(0, 'rgba(255,220,160,0.28)')
  v.addColorStop(1, 'rgba(0,0,0,0.45)')
  g.fillStyle = v
  g.fillRect(0, 0, w, h * 0.7)
  // Gold bobbles along the scallop edge.
  g.fillStyle = '#f6c453'
  for (let i = 0; i < scallops; i++) {
    g.beginPath()
    g.arc(i * 2 * r + r, h * 0.42 + r, r * 0.14, 0, Math.PI * 2)
    g.fill()
  }
}, { repeat: [2, 1] })

export function create(q: Quality): Backdrop {
  const group = new THREE.Group()
  const full = q === 'full'

  // House: violet, darker overhead so the eye falls to the stage.
  group.add((() => {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(15.5, 32, 20),
      new THREE.MeshBasicMaterial({
        map: gradientTex([
          [0, '#150a24'], [0.32, '#2b1f47'], [0.62, '#241640'], [1, '#0d0718'],
        ]),
        side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false,
      }),
    )
    dome.renderOrder = -10
    return dome
  })())

  const bands: Band[] = []
  const curtain = new Band({
    radius: 8.6, height: 13, y: 4.6, repeat: 3, texture: curtainTex(), toneMapped: false,
  })
  bands.push(curtain)
  group.add(curtain.mesh)

  const pelmet = new Band({ radius: 8.2, height: 3.2, y: 8.4, repeat: 6, texture: pelmetTex() })
  bands.push(pelmet)
  group.add(pelmet.mesh)

  // Two legs downstage, framing the shot without ever crossing the bodies.
  const legMat = new THREE.MeshStandardMaterial({
    color: '#3d1a52', roughness: 1, metalness: 0, map: paperTexture('#ffffff', 20),
  })
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 12), legMat)
    leg.position.set(side * 4.6, 4.4, 1.2)
    leg.rotation.y = -side * 0.55
    group.add(leg)
  }

  // Floor: the cream performance disc, warm pool, hot pink rim.
  const floorMap = paperTexture('#ffffff', 26)
  floorMap.repeat.set(4, 4)
  group.add(stageFloor({
    radius: 3.2, map: floorMap, color: '#e8cfa6', roughness: 0.86,
    emissive: '#3a2547', emissiveIntensity: 0.35,
    pool: { color: '#ffdca6', opacity: 0.3 },
    contact: 0.42,
  }))

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.07, 8, 56),
    new THREE.MeshStandardMaterial({ color: '#ff5c8a', roughness: 0.6, emissive: '#ff2d6a', emissiveIntensity: 0.35 }),
  )
  rim.rotation.x = -Math.PI / 2
  rim.position.y = 0.02
  group.add(rim)

  // Footlights. They separate the feet from the floor, which is what makes
  // footwork legible — and they chase around the stage on the beat.
  const bulbs: THREE.Mesh[] = []
  const bulbGeo = wobble(new THREE.SphereGeometry(0.11, 10, 8), 0.02, 7)
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.42 + (i / 8) * Math.PI * 0.84
    const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshStandardMaterial({
      color: '#ffd23f', emissive: '#ffb020', emissiveIntensity: 1.1, roughness: 0.5,
    }))
    bulb.position.set(Math.sin(a) * 3.54, 0.11, Math.cos(a) * 3.54)
    group.add(bulb)
    bulbs.push(bulb)
  }

  // Two specials from the rig, crossing over the performers. Built either way
  // and hidden on the cheap path — see QualitySwitch.
  const shafts: THREE.Mesh[] = []
  for (const side of [-1, 1]) {
    const s = lightShaft('#ffd9a0', 0.5, 2.6, 9, 0.13)
    s.position.set(side * 2.2, 4.6, -1.4)
    s.rotation.z = side * 0.16
    s.visible = full
    group.add(s)
    shafts.push(s)
  }

  const halo = glowDisc('#ffcf8a', 5.5, 0.16)
  halo.position.set(0, 2.4, -6.4)
  group.add(halo)

  group.add(scrim('#170a26', 0.5))

  // Dust in the beam. Nothing sells a theatre like it.
  const dust = new Particles({
    count: full ? 220 : 90, texture: spriteTex('glow', 32), size: 0.055,
    bounds: [4.2, 2.6, 3], centre: [0, 2.6, -1], velocity: [0.02, 0.035, 0],
    colors: ['#ffe6bd', '#ffd08a', '#fff6e2'], opacity: 0.5, sway: 0.06, seed: 91,
  }, q)
  group.add(dust.points)

  const quality = new QualitySwitch([dust], shafts)

  const env: StageEnv = {
    hemi: { sky: '#bfd4ff', ground: '#3a2b4d', intensity: 0.85 },
    key: { color: '#fff3e0', intensity: 2.5, position: [0.9, 3.4, 4.2] },
    rims: [
      { color: '#7ad7ff', intensity: 1.5, position: [-4, 2.6, -2.4] },
      { color: '#ff8fc7', intensity: 1.5, position: [4, 2.6, -2.4] },
    ],
  }

  let t = 0
  return {
    group,
    env,
    update(dt, phase) {
      t += dt
      dust.update(dt, phase)
      for (let i = 0; i < bulbs.length; i++) {
        const m = bulbs[i].material as THREE.MeshStandardMaterial
        const offset = (i / bulbs.length) * 0.35
        m.emissiveIntensity = 0.75 + 0.65 * Math.max(0, Math.cos((phase - offset) * Math.PI * 2))
      }
      const pulse = 0.35 + 0.14 * Math.max(0, Math.cos(phase * Math.PI * 2))
      ;(rim.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse
      for (let i = 0; i < shafts.length; i++) {
        const s = shafts[i]
        if (!s.visible) continue
        s.rotation.z = (i ? 1 : -1) * (0.16 + Math.sin(t * 0.4 + i) * 0.05)
        ;(s.material as THREE.MeshBasicMaterial).opacity =
          0.11 + 0.05 * Math.max(0, Math.cos((phase + i * 0.5) * Math.PI * 2))
      }
      for (const b of bands) b.update(dt)
    },
    setQuality(q) { quality.apply(q) },
    dispose() { disposeTree(group) },
  }
}
