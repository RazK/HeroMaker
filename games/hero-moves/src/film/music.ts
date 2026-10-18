import { makeRng } from '../core/math'

/**
 * The film's soundtrack, composed at run time. No audio file ships and no
 * licence is involved: every note below is synthesised by WebAudio from a few
 * oscillators and a buffer of seeded noise.
 *
 * The same `scheduleScore` drives both a live `AudioContext` (the player, and
 * the in-browser "Save video" recorder) and an `OfflineAudioContext` (the
 * frame-stepped renderer), so what a parent hears in the page is, sample for
 * sample, what lands in the exported MP4.
 *
 * Each story beat names a mood; each mood is a little arrangement over a
 * four-chord loop. Every section starts its own bar grid on the beat it
 * belongs to, so a cut always lands on a downbeat.
 */
export type Mood = 'calm' | 'party' | 'suspense' | 'triumph' | 'finale' | 'gentle' | 'hbd'
export type CueKind = 'whoosh' | 'pop' | 'sparkle' | 'drumroll' | 'crash' | 'tada' | 'zap' | 'rise' | 'chime'

export interface Cue { at: number; kind: CueKind; dur?: number }
export interface Section { start: number; end: number; mood: Mood }
export interface ScorePlan { duration: number; bpm: number; sections: Section[]; cues: Cue[] }

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

// ------------------------------------------------------------------ harmony
type Chord = { tones: number[]; root: number }
const C: Chord = { tones: [60, 64, 67], root: 48 }
const G: Chord = { tones: [59, 62, 67], root: 43 }
const Am: Chord = { tones: [57, 60, 64], root: 45 }
const F: Chord = { tones: [57, 60, 65], root: 41 }
const Dm: Chord = { tones: [57, 62, 65], root: 50 }
const E: Chord = { tones: [56, 59, 64], root: 40 }
const BRIGHT = [C, G, Am, F]
const DARK = [Am, F, Dm, E]

/** Two four-bar tunes on an eighth-note grid; null holds the previous note. */
const _ = null
const TUNE_A: Array<Array<number | null>> = [
  [76, _, 79, _, 84, _, 79, 76], [74, _, 79, _, 83, _, 79, 74],
  [72, _, 76, _, 81, _, 79, 76], [77, 76, 74, 72, 74, _, _, _],
]
const TUNE_B: Array<Array<number | null>> = [
  [84, _, 83, 81, 79, _, 76, _], [79, _, 81, 79, 74, _, 71, _],
  [72, 74, 76, _, 81, _, 79, _], [77, _, 76, _, 74, _, 72, _],
]
const TUNE_DARK: Array<Array<number | null>> = [
  [76, _, _, _, 72, _, _, _], [77, _, _, _, 72, _, _, _],
  [74, _, _, _, 77, _, _, _], [76, _, _, _, 71, _, _, _],
]
/** Happy Birthday to You (public domain), in 3/4 on an eighth grid, pickup first. */
const HBD_PICKUP = [67, 67]
const HBD: Array<Array<number | null>> = [
  [69, _, 67, _, 72, _], [71, _, _, _, 67, 67], [69, _, 67, _, 74, _], [72, _, _, _, 67, 67],
  [79, _, 76, _, 72, _], [71, _, 69, _, 77, 77], [76, _, 72, _, 74, _], [72, _, _, _, _, _],
]
const HBD_CHORDS = [C, G, G, C, F, C, G, C]

// ------------------------------------------------------------------ voices
class Synth {
  private noise: AudioBuffer
  readonly music: GainNode
  readonly sfx: GainNode

  constructor(private ctx: BaseAudioContext, out: AudioNode) {
    const rnd = makeRng(9001)
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.2
    const master = ctx.createGain(); master.gain.value = 0.9
    comp.connect(master); master.connect(out)
    this.music = ctx.createGain(); this.music.gain.value = 0.8; this.music.connect(comp)
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(comp)
  }

  private env(t: number, peak: number, attack: number, decay: number, dest: AudioNode) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    g.connect(dest)
    return g
  }

  private osc(type: OscillatorType, f: number, t: number, len: number, dest: AudioNode) {
    const o = this.ctx.createOscillator()
    o.type = type; o.frequency.setValueAtTime(f, t)
    o.connect(dest); o.start(t); o.stop(t + len + 0.05)
    return o
  }

  private noiseSrc(t: number, len: number, dest: AudioNode) {
    const s = this.ctx.createBufferSource()
    s.buffer = this.noise; s.loop = true
    s.connect(dest); s.start(t, (t * 7.31) % 0.9); s.stop(t + len + 0.05)
    return s
  }

  pluck(m: number, t: number, vol: number) {
    const g = this.env(t, vol, 0.004, 0.42, this.music)
    const lp = this.ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.Q.value = 1.2
    lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.35)
    lp.connect(g)
    this.osc('triangle', hz(m), t, 0.5, lp)
    const s = this.ctx.createGain(); s.gain.value = 0.22; s.connect(lp)
    this.osc('sawtooth', hz(m) * 1.004, t, 0.5, s)
  }

  glock(m: number, t: number, vol: number, decay = 1.0) {
    this.osc('sine', hz(m), t, decay + 0.1, this.env(t, vol, 0.003, decay, this.music))
    this.osc('sine', hz(m) * 2.756, t, 0.3, this.env(t, vol * 0.28, 0.002, 0.22, this.music))
  }

  bass(m: number, t: number, len: number, vol: number) {
    const g = this.env(t, vol, 0.008, Math.min(0.55, len), this.music)
    this.osc('triangle', hz(m), t, len, g)
    this.osc('sine', hz(m - 12), t, len, g)
  }

  pad(ms: number[], t: number, len: number, vol: number) {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.25)
    g.gain.setValueAtTime(vol, t + Math.max(0.26, len - 0.3))
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.2)
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500
    lp.connect(g); g.connect(this.music)
    for (const m of ms) for (const det of [-6, 6]) {
      const o = this.osc('sawtooth', hz(m), t, len + 0.25, lp)
      o.detune.value = det
    }
  }

  kick(t: number, vol: number) {
    const g = this.env(t, vol, 0.002, 0.24, this.music)
    const o = this.osc('sine', 150, t, 0.3, g)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
  }

  clap(t: number, vol: number) {
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.7
    bp.connect(this.env(t, vol, 0.002, 0.14, this.music))
    this.noiseSrc(t, 0.2, bp)
  }

  hat(t: number, vol: number) {
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000
    hp.connect(this.env(t, vol, 0.001, 0.045, this.music))
    this.noiseSrc(t, 0.08, hp)
  }

  // ---------------------------------------------------------------- effects
  cue(c: Cue, t: number) {
    const ctx = this.ctx, out = this.sfx
    switch (c.kind) {
      case 'whoosh': {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4
        bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.45)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.22)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
        bp.connect(g); g.connect(out)
        this.noiseSrc(t, 0.6, bp)
        break
      }
      case 'pop': {
        const o = this.osc('sine', 520, t, 0.12, this.env(t, 0.22, 0.003, 0.1, out))
        o.frequency.exponentialRampToValueAtTime(1250, t + 0.07)
        break
      }
      case 'sparkle':
        [84, 88, 91, 96, 100].forEach((m, i) => this.osc('sine', hz(m), t + i * 0.06, 0.6,
          this.env(t + i * 0.06, 0.09, 0.002, 0.5, out)))
        break
      case 'chime':
        [79, 84, 88].forEach((m, i) => this.osc('sine', hz(m), t + i * 0.1, 1.2,
          this.env(t + i * 0.1, 0.08, 0.003, 1.0, out)))
        break
      case 'drumroll': {
        const len = c.dur ?? 1
        for (let k = 0; k * 0.05 < len; k++) {
          const tt = t + k * 0.05
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.6
          bp.connect(this.env(tt, 0.03 + 0.14 * (k * 0.05) / len, 0.002, 0.06, out))
          this.noiseSrc(tt, 0.08, bp)
        }
        break
      }
      case 'crash': {
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500
        hp.connect(this.env(t, 0.22, 0.003, 1.3, out))
        this.noiseSrc(t, 1.4, hp)
        this.kick(t, 0.5)
        break
      }
      case 'tada': {
        const stab = (tt: number, len: number, vol: number) => {
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600
          const g = ctx.createGain()
          g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(vol, tt + 0.015)
          g.gain.setValueAtTime(vol, tt + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, tt + len)
          lp.connect(g); g.connect(out)
          for (const m of [60, 64, 67, 72]) this.osc('sawtooth', hz(m), tt, len, lp)
        }
        stab(t, 0.16, 0.09)
        stab(t + 0.18, 1.3, 0.11)
        this.kick(t + 0.18, 0.4)
        break
      }
      case 'zap': {
        const o = this.osc('square', 1400, t, 0.3, this.env(t, 0.07, 0.002, 0.26, out))
        o.frequency.exponentialRampToValueAtTime(180, t + 0.26)
        break
      }
      case 'rise': {
        const len = c.dur ?? 1.2
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + len)
        g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.1)
        g.connect(out)
        const o = this.osc('sawtooth', 180, t, len + 0.1, g)
        o.frequency.exponentialRampToValueAtTime(900, t + len)
        break
      }
    }
  }
}

// ------------------------------------------------------------------ arrangement
interface Note { at: number; play: (s: Synth, t: number) => void }

function arrange(sec: Section, bpm: number): Note[] {
  const notes: Note[] = []
  const add = (at: number, play: Note['play']) => { if (at >= sec.start - 1e-6 && at < sec.end - 0.02) notes.push({ at, play }) }
  const q = 60 / bpm
  const e8 = q / 2

  if (sec.mood === 'hbd') {
    // Faster, in three: the song everybody knows.
    const q3 = 60 / (bpm * 1.42), e = q3 / 2
    const t0 = sec.start + 2 * e
    HBD_PICKUP.forEach((m, i) => add(sec.start + i * e, (s, t) => s.glock(m + 12, t, 0.16, 0.5)))
    HBD.forEach((bar, b) => {
      const bt = t0 + b * 6 * e
      const ch = HBD_CHORDS[b]
      add(bt, (s, t) => { s.bass(ch.root, t, q3, 0.2); s.kick(t, 0.32) })
      for (const k of [1, 2]) add(bt + k * q3, (s, t) => { ch.tones.forEach((m) => s.pluck(m, t, 0.05)); s.hat(t, 0.05) })
      bar.forEach((m, k) => {
        if (m === null) return
        let len = 1
        while (k + len < bar.length && bar[k + len] === null) len++
        add(bt + k * e, (s, t) => { s.glock(m + 12, t, 0.15, Math.min(1.2, len * e + 0.3)); s.pluck(m, t, 0.06) })
      })
    })
    add(t0 + 7 * 6 * e + 2 * e, (s, t) => s.pad([60, 64, 67, 72], t, 1.4, 0.04))
    return notes
  }

  const dark = sec.mood === 'suspense'
  const prog = dark ? DARK : BRIGHT
  const drums = sec.mood === 'party' || sec.mood === 'triumph' || sec.mood === 'finale'
  const bars = Math.ceil((sec.end - sec.start) / (4 * q))
  for (let b = 0; b < bars; b++) {
    const bt = sec.start + b * 4 * q
    const ch = prog[b % 4]
    const tune = dark ? TUNE_DARK : (Math.floor(b / 4) % 2 ? TUNE_B : TUNE_A)
    const line = tune[b % 4]

    // Bass.
    if (drums) for (let k = 0; k < 8; k++) add(bt + k * e8, (s, t) => s.bass(ch.root + (k % 2 ? 12 : 0), t, e8, 0.15))
    else add(bt, (s, t) => s.bass(ch.root, t, dark ? 4 * q : 2 * q, dark ? 0.14 : 0.16))
    if (!drums && !dark) add(bt + 2 * q, (s, t) => s.bass(ch.root + 7, t, 2 * q, 0.12))

    // Chords.
    if (dark) {
      for (const k of [0, 2]) add(bt + k * q, (s, t) => ch.tones.forEach((m) => s.pluck(m - 12, t, 0.045)))
    } else if (drums) {
      for (let k = 0; k < 8; k++) if (k % 2) add(bt + k * e8, (s, t) => ch.tones.forEach((m) => s.pluck(m, t, 0.045)))
    } else {
      const arp = [0, 1, 2, 1, 0, 1, 2, 1]
      for (let k = 0; k < 8; k++) add(bt + k * e8, (s, t) => s.pluck(ch.tones[arp[k]] + (k === 2 || k === 6 ? 12 : 0), t, sec.mood === 'gentle' ? 0.05 : 0.06))
    }
    if (sec.mood === 'triumph' || sec.mood === 'finale') add(bt, (s, t) => s.pad(ch.tones, t, 4 * q, 0.026))

    // Drums.
    if (drums) {
      for (let k = 0; k < 4; k++) add(bt + k * q, (s, t) => s.kick(t, 0.42))
      for (const k of [1, 3]) add(bt + k * q, (s, t) => s.clap(t, 0.16))
      for (let k = 0; k < 8; k++) add(bt + k * e8, (s, t) => s.hat(t, k % 2 ? 0.05 : 0.03))
    }

    // Tune.
    const melodyVol = dark ? 0.1 : drums ? 0.12 : 0.09
    const sparse = sec.mood === 'calm' || sec.mood === 'gentle'
    line.forEach((m, k) => {
      if (m === null) return
      if (sparse && k % 2) return
      let len = 1
      while (k + len < line.length && line[k + len] === null) len++
      add(bt + k * e8, (s, t) => s.glock(m, t, melodyVol, Math.min(1.1, len * e8 + 0.35)))
    })
  }
  return notes
}

/**
 * Schedule the score on `ctx`. Film time `from` plays at context time `at`;
 * anything earlier than `from` is skipped, so the player can start mid-film.
 */
export function scheduleScore(ctx: BaseAudioContext, out: AudioNode, plan: ScorePlan, from = 0, at = ctx.currentTime + 0.05) {
  const synth = new Synth(ctx, out)
  const notes = plan.sections.flatMap((s) => arrange(s, plan.bpm))
  for (const n of notes) if (n.at >= from - 1e-3) n.play(synth, at + (n.at - from))
  for (const c of plan.cues) if (c.at >= from - 1e-3) synth.cue(c, at + (c.at - from))
}

/** Render the whole score offline and hand back a 16-bit stereo WAV. */
export async function renderWav(plan: ScorePlan, sampleRate = 44100): Promise<Blob> {
  return new Blob([encodeWav(await renderAudio(plan, sampleRate))], { type: 'audio/wav' })
}

/** The whole score as samples, faster than real time. */
export function renderAudio(plan: ScorePlan, sampleRate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(plan.duration * sampleRate), sampleRate)
  scheduleScore(ctx, ctx.destination, plan, 0, 0)
  return ctx.startRendering()
}

function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate
  const out = new ArrayBuffer(44 + n * ch * 2)
  const v = new DataView(out)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true)
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * ch * 2, true)
  const data = Array.from({ length: ch }, (_, i) => buf.getChannelData(i))
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const x = Math.max(-1, Math.min(1, data[c][i]))
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2
  }
  return out
}
