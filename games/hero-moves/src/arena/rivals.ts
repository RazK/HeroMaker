import * as THREE from 'three'
import { parseHero, type Hero } from '../avatar/loader'
import { loadRetargeted } from '../anim/clips'
import { animUrl } from '../anim/files'

/**
 * Rival heroes: other children's Editors' choice heroes, wandering into the
 * room to raid the toy chest. The player bops them — and a bop is a game of
 * tag, never a fight: the rival tumbles onto its bottom, sees stars, waves to
 * the camera and runs off, whole and happy. Nobody breaks, nobody "dies".
 *
 * Every rival is a real gallery hero, loaded with the same loader as the
 * player's and animated with the same rotation-only retargeted CC0 clips, so
 * a round is a parade of what the gallery has made. The player's own hero is
 * never a rival.
 */

export interface RivalSource { url: string; name: string }

interface CreationLite {
  id: string
  user_id: string
  character_name?: string | null
  name?: string | null
  steps?: { step_name: string; status: string }[]
}

/**
 * Up to `max` featured heroes from the gallery (same origin, as the app
 * serves the game), excluding the player's. Falls back to the sample heroes
 * this build ships, so the game works without the app too.
 */
export async function rivalSources(own: string | null, samples: Record<string, string>, max = 4): Promise<RivalSource[]> {
  const ownPath = own ? new URL(own, location.href).pathname : ''
  let out: RivalSource[] = []
  try {
    const r = await fetch('/api/creations/?featured_only=true', { headers: { Accept: 'application/json' } })
    if (r.ok) {
      const body = await r.json() as CreationLite[] | { creations?: CreationLite[] }
      const list = Array.isArray(body) ? body : body.creations ?? []
      out = list
        .filter((c) => c.steps?.some((s) => s.step_name === 'convert_vrm' && s.status === 'completed'))
        .map((c) => ({
          url: `/api/files/${c.user_id}/${c.id}/opt_avatar.vrm`,
          name: (c.character_name || c.name || 'A hero').trim(),
        }))
        .filter((s) => s.url !== ownPath)
    }
  } catch { /* no gallery here: use the samples */ }
  if (!out.length) {
    out = Object.entries(samples)
      .filter(([, url]) => new URL(url, location.href).pathname !== ownPath)
      .map(([k, url]) => ({ url, name: k.split('/').pop()!.replace('.opt.vrm', '').replace(/_/g, ' ') }))
  }
  // A different handful every round.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, max)
}

const CLIPS = {
  walk: 'Walk.glb',
  run: 'Run_Anime.glb',
  knock: 'Hit_Knockback.glb',
  dizzy: 'Dizzy.glb',
  wave: 'Greeting.glb',
  cheer: 'Victory.glb',
} as const
export type RivalMove = keyof typeof CLIPS

let starTex: THREE.Texture | null = null
function starTexture() {
  if (starTex) return starTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.translate(32, 33); g.scale(2.4, 2.4); g.translate(-12, -12)
  const p = new Path2D('M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z')
  g.fillStyle = '#ffc233'; g.strokeStyle = '#231942'; g.lineWidth = 1.6; g.lineJoin = 'round'
  g.fill(p); g.stroke(p)
  starTex = new THREE.CanvasTexture(c)
  starTex.colorSpace = THREE.SRGBColorSpace
  return starTex
}

export class Rival {
  readonly mixer: THREE.AnimationMixer
  private actions = new Map<RivalMove, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  /** Three dizzy stars circling the head, one draw call. */
  readonly stars: THREE.Points
  /** In the room now. */
  busy = false
  move: RivalMove | null = null

  constructor(readonly hero: Hero, readonly name: string) {
    this.mixer = new THREE.AnimationMixer(hero.vrm.scene)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.26, map: starTexture(), transparent: true, alphaTest: 0.3, depthWrite: false }))
    this.stars.frustumCulled = false
    this.stars.visible = false
    hero.root.add(this.stars)
  }

  async load(): Promise<boolean> {
    const done = await Promise.all((Object.entries(CLIPS) as [RivalMove, string][]).map(async ([id, file]) => {
      try {
        const { clip } = await loadRetargeted(animUrl(file), this.hero.vrm)
        this.actions.set(id, this.mixer.clipAction(clip))
        return true
      } catch { return false }
    }))
    return done.every(Boolean) || this.actions.has('walk')
  }

  play(id: RivalMove, { loop = true, speed = 1, from = 0, fade = 0.18 } = {}) {
    const a = this.actions.get(id)
    if (!a) return
    this.move = id
    a.reset()
    a.time = from
    a.timeScale = speed
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
    a.clampWhenFinished = !loop
    a.enabled = true
    a.setEffectiveWeight(1)
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false)
    a.play()
    this.current = a
  }

  update(dt: number, t: number) {
    this.mixer.update(dt)
    this.hero.vrm.update(dt)
    if (this.stars.visible) {
      const pos = this.stars.geometry.getAttribute('position') as THREE.BufferAttribute
      const h = this.hero.height + 0.12
      const r = Math.max(0.28, this.hero.width * 0.22)
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + (i * Math.PI * 2) / 3
        pos.setXYZ(i, Math.cos(a) * r, h + Math.sin(a * 2) * 0.04, Math.sin(a) * r)
      }
      pos.needsUpdate = true
    }
  }

  reset() {
    this.mixer.stopAllAction()
    this.current = null
    this.move = null
    this.stars.visible = false
    this.hero.vrm.humanoid.resetNormalizedPose()
  }
}

/** Download, parse and bind one rival; resolves null if it cannot play. */
export async function loadRival(src: RivalSource): Promise<Rival | null> {
  try {
    const r = await fetch(src.url)
    if (!r.ok) return null
    const hero = await parseHero(await r.arrayBuffer())
    const rival = new Rival(hero, src.name)
    return (await rival.load()) ? rival : null
  } catch {
    return null
  }
}
