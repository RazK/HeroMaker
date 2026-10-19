import * as THREE from 'three'
import { PAL, STAND } from './world'

/**
 * The fans' own drawings, pinned to the back wall above the grandstand as
 * the app's polaroids: a white card, the drawing contained (never cropped),
 * the child's first name and age under it, a slight tilt and a coloured
 * pushpin. Raz: "hang the original drawings on the wall, with pins maybe".
 *
 * Decor only. The cards live under the crowd's group, never in `Game.things`
 * (the only list the punch reads); `window.__arena.audit()` checks it.
 *
 * Cheap and never in the way:
 * - the image is the backend's small thumbnail (`thumb_original.jpg`, 512 px
 *   at most), drawn once into a 192x236 canvas: ~180 KB of texture a card;
 * - it loads after the crowd, while the round is already playable, and a
 *   drawing that does not arrive is simply not hung;
 * - one draw call a card, plus one for every pin head (instanced).
 */

/** Card size on the wall, in metres, before a layout scales it. */
const W = 0.54
const H = 0.66

/**
 * Where cards hang depends on what the camera can see of the back wall, and
 * the two shapes of screen see different parts of it:
 *
 * - **portrait** sees the wall narrow (about ±3.4 m) but tall (up to ~3.6 m):
 *   the cards hang in a band above the fans' heads, leaving the middle free
 *   for the combo pill at the top of the stage;
 * - **landscape** sees the whole wall but only up to ~2.2 m, which the fans
 *   fill: the cards hang either side of the grandstand instead, bigger.
 *
 * Slot i is on the same side in both, so a card stays on its fan's side when
 * the phone turns; the board re-hangs itself when the camera's shape flips.
 */
type Layout = 'portrait' | 'landscape'
const LAYOUTS: Record<Layout, { xs: number[]; y: number; scale: number }> = {
  portrait: { xs: [-1.55, 1.55, -2.27, 2.27, -2.99, 2.99], y: 2.75, scale: 1.2 },
  landscape: { xs: [-3.95, 3.95, -4.77, 4.77, -5.59, 5.59], y: 1.42, scale: 1.45 },
}
export const CARD_SLOTS = LAYOUTS.portrait.xs.length

export interface Drawing { url: string; artist?: string | null; age?: number | null; near: number }

let fontReady: Promise<unknown> | null = null
function displayFont() {
  // The card's caption is in the app's display face, once the page has it.
  fontReady ??= (document.fonts?.load?.('600 30px Barriecito') ?? Promise.resolve()).catch(() => undefined)
  return fontReady
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/** The polaroid, painted: white card, drawing contained, "Maya, 6". */
function paintCard(img: HTMLImageElement, artist?: string | null, age?: number | null): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = 192; c.height = 236
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.beginPath(); g.roundRect(0, 0, 192, 236, 14); g.fill()
  // The drawing, never cropped, on the polaroid's paper tint.
  g.fillStyle = '#faf7f2'
  g.beginPath(); g.roundRect(10, 10, 172, 172, 8); g.fill()
  const k = Math.min(172 / img.naturalWidth, 172 / img.naturalHeight)
  const w = img.naturalWidth * k, h = img.naturalHeight * k
  g.save()
  g.beginPath(); g.roundRect(10, 10, 172, 172, 8); g.clip()
  g.drawImage(img, 10 + (172 - w) / 2, 10 + (172 - h) / 2, w, h)
  g.restore()
  const first = (artist ?? '').trim().split(/\s+/)[0]
  const caption = first ? (age ? `${first}, ${age}` : first) : ''
  if (caption) {
    g.fillStyle = '#5c5578'
    g.textAlign = 'center'; g.textBaseline = 'middle'
    let size = 30
    do { g.font = `${size}px Barriecito, Fredoka, system-ui, sans-serif`; size -= 2 } while (g.measureText(caption).width > 176 && size > 14)
    g.fillText(caption, 96, 210)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

let shadowTex: THREE.Texture | null = null
function cardShadow() {
  if (shadowTex) return shadowTex
  const c = document.createElement('canvas')
  c.width = 64; c.height = 76
  const g = c.getContext('2d')!
  g.filter = 'blur(5px)'
  g.fillStyle = 'rgba(35,25,66,0.32)'
  g.beginPath(); g.roundRect(10, 10, 44, 56, 6); g.fill()
  shadowTex = new THREE.CanvasTexture(c)
  return shadowTex
}

const PIN_COLOURS = [PAL.red, PAL.sun, PAL.grape, PAL.green, 0x2fa8e0, 0xff8a3d]

export class Pinboard {
  readonly root = new THREE.Group()
  readonly cards: THREE.Mesh[] = []
  private hung: { card: THREE.Group; slot: number; tilt: number }[] = []
  private pins: THREE.InstancedMesh
  private used = new Set<number>()
  layout: Layout = 'portrait'
  private pops: { obj: THREE.Object3D; t: number }[] = []
  private cardGeo = new THREE.PlaneGeometry(W, H)
  private shadowGeo = new THREE.PlaneGeometry(W * 1.33, H * 1.27)

  constructor(parent: THREE.Object3D) {
    this.root.name = 'pinboard'
    parent.add(this.root)
    const head = new THREE.SphereGeometry(0.035, 12, 8)
    head.scale(1, 1, 0.7)
    this.pins = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ roughness: 0.35 }), CARD_SLOTS)
    this.pins.count = 0
    this.pins.frustumCulled = false
    this.root.add(this.pins)
  }

  get size() { return this.cards.length }

  /** Hang one drawing, near `near` (its fan's x). Never awaited by the game. */
  async hang(d: Drawing): Promise<boolean> {
    if (this.used.size >= CARD_SLOTS) return false
    const [img] = await Promise.all([loadImage(d.url), displayFont()])
    if (!img || !img.naturalWidth) return false
    // The free slot nearest its fan, so a drawing hangs on its hero's side.
    const xs = LAYOUTS.portrait.xs
    let slot = -1
    for (let i = 0; i < CARD_SLOTS; i++) {
      if (this.used.has(i)) continue
      if (slot < 0 || Math.abs(xs[i] - d.near) < Math.abs(xs[slot] - d.near)) slot = i
    }
    if (slot < 0) return false
    this.used.add(slot)
    const tilt = ((slot * 37) % 9 - 4) * 0.022 + (slot % 2 ? 0.03 : -0.03)
    const card = new THREE.Group()
    card.rotation.z = tilt
    const shadow = new THREE.Mesh(this.shadowGeo, new THREE.MeshBasicMaterial({ map: cardShadow(), transparent: true, depthWrite: false }))
    shadow.position.set(0.02, -0.03, -0.01)
    card.add(shadow)
    const face = new THREE.Mesh(this.cardGeo, new THREE.MeshStandardMaterial({ map: paintCard(img, d.artist, d.age), roughness: 0.85, transparent: true, alphaTest: 0.5 }))
    face.name = 'drawing'
    card.add(face)
    this.root.add(card)
    this.cards.push(face)
    this.hung.push({ card, slot, tilt })
    this.pins.setColorAt(this.hung.length - 1, new THREE.Color(PIN_COLOURS[slot % PIN_COLOURS.length]))
    this.pins.count = this.hung.length
    if (this.pins.instanceColor) this.pins.instanceColor.needsUpdate = true
    // Pops in with a small bounce, like everything else that arrives.
    card.scale.setScalar(0.01)
    this.pops.push({ obj: card, t: 0 })
    this.place()
    return true
  }

  /** Hang every card (and its pin) where the current layout puts it. */
  private place() {
    const L = LAYOUTS[this.layout]
    this.hung.forEach(({ card, slot, tilt }, i) => {
      card.position.set(L.xs[slot], L.y, STAND.wallZ + 0.03)
      card.userData.scale = L.scale
      if (!this.pops.some((p) => p.obj === card)) card.scale.setScalar(L.scale)
      // The pin, at the top centre of the card, in the card's own tilt.
      const pin = new THREE.Vector3(0, (H / 2 - 0.05) * L.scale, 0.03).applyAxisAngle(new THREE.Vector3(0, 0, 1), tilt).add(card.position)
      this.pins.setMatrixAt(i, new THREE.Matrix4().makeTranslation(pin.x, pin.y, pin.z))
    })
    this.pins.instanceMatrix.needsUpdate = true
  }

  /** Follow the camera's shape: re-hang the cards when it flips. */
  setLayout(layout: Layout) {
    if (layout === this.layout) return
    this.layout = layout
    this.place()
  }

  update(dt: number) {
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i]
      p.t = Math.min(1, p.t + dt / 0.28)
      const k = p.t - 1
      const full = (p.obj.userData.scale as number) ?? 1
      p.obj.scale.setScalar(full * (p.t >= 1 ? 1 : Math.max(0.01, 1 + 2.2 * k ** 3 + 1.2 * k ** 2)))
      if (p.t >= 1) this.pops.splice(i, 1)
    }
  }

  /** Every card hangs flat on the back wall, behind the court, within the wall. */
  onWall(): boolean {
    return this.cards.every((c) => {
      const p = c.getWorldPosition(new THREE.Vector3())
      const half = (W * ((c.parent?.userData.scale as number) ?? 1)) / 2
      return Math.abs(p.z - STAND.wallZ) < 0.1 && Math.abs(p.x) + half <= STAND.wallHalfWidth && p.y > 0 && p.y < STAND.wallHeight
    })
  }
}
