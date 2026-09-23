import { LIMBS, type Skeleton } from '../pose/keypoints'
import type { Move } from '../pose/moves'

/**
 * The move icons on the strip.
 *
 * Drawn from `move.skeleton` — the same canonical shape the leader is posed
 * from and the player is scored against — so an icon can never disagree with
 * the move it stands for. They are stick figures rather than little renders of
 * the avatar on purpose: at 44 pixels a chibi hero is an unreadable blob, while
 * a silhouette is exactly the information the player needs, which is the shape
 * to make.
 */

const SIZE = 96
/**
 * Cached as data URLs rather than as canvases. A canvas is a DOM node and can
 * only be in one place at a time, so handing the same one to two tiles moves it
 * out of the first — and a routine repeats its moves, so the live tile kept
 * losing its figure to a later copy of itself.
 */
const cache = new Map<string, string>()

/** Bounds of the drawn joints, so every pose fills its tile the same amount. */
function extent(s: Skeleton) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0
  for (const [a, b] of LIMBS) {
    for (const k of [s[a], s[b]]) {
      minX = Math.min(minX, k.x); maxX = Math.max(maxX, k.x)
      minY = Math.min(minY, k.y); maxY = Math.max(maxY, k.y)
    }
  }
  return { minX, maxX, minY, maxY }
}

export function pictogram(move: Move, color = '#fff8ec'): string {
  const key = `${move.id}:${color}`
  const hit = cache.get(key)
  if (hit) return hit

  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const g = c.getContext('2d')!
  const s = move.skeleton
  const { minX, maxX, minY, maxY } = extent(s)

  // Fit the pose into the tile with a margin, keeping the aspect so a star
  // jump stays wide and a squat stays low.
  const pad = SIZE * 0.14
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const scale = (SIZE - pad * 2) / span
  const offX = pad + ((SIZE - pad * 2) - (maxX - minX) * scale) / 2
  const offY = pad + ((SIZE - pad * 2) - (maxY - minY) * scale) / 2
  const px = (x: number) => offX + (x - minX) * scale
  const py = (y: number) => offY + (y - minY) * scale

  g.strokeStyle = color
  g.fillStyle = color
  g.lineWidth = SIZE * 0.085
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const [a, b] of LIMBS) {
    g.beginPath()
    g.moveTo(px(s[a].x), py(s[a].y))
    g.lineTo(px(s[b].x), py(s[b].y))
    g.stroke()
  }
  // A head, so the figure reads as a body rather than a diagram.
  const headY = py(s.nose.y) - SIZE * 0.02
  g.beginPath()
  g.arc(px(s.nose.x), headY, SIZE * 0.1, 0, Math.PI * 2)
  g.fill()

  const url = c.toDataURL('image/png')
  cache.set(key, url)
  return url
}

/** Build every icon a routine needs up front, so the strip never stutters. */
export function warmPictograms(moves: Move[]) {
  for (const m of moves) pictogram(m)
}
