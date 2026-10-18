/**
 * The show: what every hero is doing at every moment, as data.
 *
 * Everything on the class stage is a pure function of one clock, `t` seconds
 * into the show. That is what lets the same page run live on a kindergarten TV
 * and be rendered frame by frame into a video — and it is why nothing here
 * uses the AnimationMixer's own clock: the mixer is only ever *told* where
 * each clip is.
 *
 * The group dances in unison to one beat. Clip rates are chosen so every clip
 * spans a whole number of beats, which keeps twelve heroes in step through
 * every change of dance.
 */

/** Charleston's loop is four beats long: 2.333 s, so ~103 BPM. */
export const BEAT = 2.3333 / 4
export const BPM = 60 / BEAT

/** Clip ids from anim/performer.ts CLIPS, and how many beats each is made to last. */
export const CLIP_BEATS: Record<string, number> = {
  dance: 4, bodyroll: 12, victory: 4, backflip: 4, land: 3, punch: 2, jump: 3, fly: 1,
}

/** One stretch of one clip on one hero. */
export interface Seg {
  clip: string
  /** When this segment takes over (crossfading from the previous one). */
  from: number
  /** Where the clip's own time zero sits on the show clock. */
  phase: number
  loop: boolean
}

export interface Spot {
  hero: number
  from: number
  to: number
  /** The solo moves, played back to back once the hero has stepped forward. */
  moves: string[]
}

export interface Caption { kind: 'intro' | 'outro'; from: number; to: number }

export interface Program {
  kind: 'tv' | 'phone'
  duration: number
  /** When hero i appears (pop in). */
  popAt: number[]
  /** Per-hero clip timeline. */
  tracks: Seg[][]
  spots: Spot[]
  captions: Caption[]
  /** Confetti between these times. */
  confetti: [number, number] | null
}

const b = (n: number) => n * BEAT

/** What the whole class dances, in order: [clip, beats]. */
type Groove = Array<[string, number]>

function groupTrack(groove: Groove, start = 0): Seg[] {
  const segs: Seg[] = []
  let t = start
  for (const [clip, beats] of groove) {
    segs.push({ clip, from: t, phase: t, loop: true })
    t += b(beats)
  }
  return segs
}

/** The group clip running at `t`, so a hero can rejoin the group in step. */
function groupAt(track: Seg[], t: number): Seg {
  let s = track[0]
  for (const x of track) if (x.from <= t) s = x
  return s
}

/**
 * Splice one-shot moves into a hero's track at `at`, then hand it back to
 * whatever the group is doing — on the group's phase, so it lands in step.
 */
function splice(track: Seg[], group: Seg[], at: number, moves: string[], clipSeconds: (id: string) => number): number {
  let t = at
  const inserts: Seg[] = []
  for (const m of moves) {
    inserts.push({ clip: m, from: t, phase: t, loop: false })
    t += clipSeconds(m)
  }
  const back = groupAt(group, t)
  inserts.push({ ...back, from: t })
  const kept = track.filter((s) => s.from < at || s.from >= t)
  const out = [...kept, ...inserts].sort((x, y) => x.from - y.from)
  track.length = 0
  track.push(...out)
  return t
}

export interface Arrangement {
  /** Screen-space order for the jump wave: index of each hero, first to jump first. */
  waveOrder: number[]
  /** Heroes to give the spotlight to, in order of preference. */
  spotlight: number[]
}

/**
 * The TV show, ~38 s: hello, Charleston, a solo, body roll, a second solo, a
 * jump wave that runs across the class, a third solo, and everyone jumping
 * together under the confetti.
 *
 * No fist pumps: on a hero whose head is a third of its height, a fist pumped
 * in front of the chest covers the face the child drew.
 */
export function tvProgram(n: number, arr: Arrangement, clipSeconds: (id: string) => number, loop = 0): Program {
  const intro = loop === 0
  const groove: Groove = [['dance', 24], ['bodyroll', 12], ['dance', 16], ['jump', 3], ['jump', 3], ['dance', 2], ['jump', 3], ['dance', 8]]
  const group = groupTrack(groove)
  const tracks = Array.from({ length: n }, () => group.map((s) => ({ ...s })))
  const pick = (k: number) => arr.spotlight[(loop * 3 + k) % arr.spotlight.length]
  const spots: Spot[] = []

  const spot = (k: number, from: number, moves: string[]) => {
    if (n < 2) return
    const hero = pick(k)
    const step = 0.7
    const end = splice(tracks[hero], group, from + step, moves, clipSeconds)
    spots.push({ hero, from, to: end + step, moves })
  }
  spot(0, b(10), ['backflip', 'jump'])
  spot(1, b(24), ['punch', 'jump'])
  // The jump wave: one after another across the class, in reading order.
  const waveAt = b(36)
  arr.waveOrder.forEach((hero, k) => {
    splice(tracks[hero], group, waveAt + k * 0.16, ['jump'], clipSeconds)
  })
  spot(2, b(42), ['punch', 'backflip'])

  const finale = groove.slice(0, 3).reduce((s, [, beats]) => s + b(beats), 0)
  const duration = finale + b(16) + 0.6
  return {
    kind: 'tv', duration,
    popAt: Array.from({ length: n }, (_, i) => (intro ? 0.35 + i * 0.13 : -1)),
    tracks, spots,
    captions: [
      ...(intro ? [{ kind: 'intro' as const, from: 0, to: 2.9 }] : []),
      { kind: 'outro', from: finale + b(8), to: duration + 10 },
    ],
    confetti: [finale, duration + 10],
  }
}

/**
 * The phone cut, ~20 s: hello, Charleston, one solo — then a parent taps their
 * child's hero (the recorder does that) and gets the solo page.
 */
export function phoneProgram(n: number, arr: Arrangement, clipSeconds: (id: string) => number): Program {
  const groove: Groove = [['dance', 16], ['bodyroll', 12], ['dance', 32]]
  const group = groupTrack(groove)
  const tracks = Array.from({ length: n }, () => group.map((s) => ({ ...s })))
  const spots: Spot[] = []
  if (n > 1) {
    const hero = arr.spotlight[0]
    const from = b(7)
    const end = splice(tracks[hero], group, from + 0.7, ['backflip', 'jump'], clipSeconds)
    spots.push({ hero, from, to: end + 0.7, moves: ['backflip', 'jump'] })
  }
  return {
    kind: 'phone', duration: b(60),
    popAt: Array.from({ length: n }, (_, i) => 0.35 + i * 0.12),
    tracks, spots,
    captions: [{ kind: 'intro', from: 0, to: 2.8 }],
    confetti: null,
  }
}

/**
 * Where each clip is at time `t` on a track: the current segment and, during a
 * crossfade, the one it is taking over from.
 */
export interface Sample { clip: string; /** 0..1 through the clip */ time: number; weight: number }

/** How long a clip lasts on the show clock. */
export const showSeconds = (id: string) => (CLIP_BEATS[id] ?? 4) * BEAT
export const FADE = 0.3

export function sampleTrack(track: Seg[], t: number, clipSeconds: (id: string) => number, out: Sample[]): Sample[] {
  out.length = 0
  let k = 0
  for (let i = 0; i < track.length; i++) if (track[i].from <= t) k = i
  // As a fraction of the clip: each clip is stretched to its whole number of beats.
  const at = (s: Seg) => {
    const dur = clipSeconds(s.clip)
    const local = Math.max(0, t - s.phase)
    return s.loop ? (local % dur) / dur : Math.min(local / dur, 0.9995)
  }
  const cur = track[k]
  const into = t - cur.from
  if (k > 0 && into < FADE) {
    const w = into / FADE
    const e = w * w * (3 - 2 * w)
    out.push({ clip: track[k - 1].clip, time: at(track[k - 1]), weight: 1 - e })
    out.push({ clip: cur.clip, time: at(cur), weight: e })
  } else {
    out.push({ clip: cur.clip, time: at(cur), weight: 1 })
  }
  return out
}
