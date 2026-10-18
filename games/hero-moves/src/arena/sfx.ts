/**
 * Every sound is synthesised: a few oscillators and a noise burst. No files
 * to download, nothing to license, and it costs nothing until the first tap
 * unlocks audio.
 */
export class Sfx {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null

  /** Call from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      try {
        this.ctx = new Ctor()
        this.out = this.ctx.createGain()
        this.out.gain.value = 0.35
        this.out.connect(this.ctx.destination)
        const len = Math.floor(this.ctx.sampleRate * 0.4)
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
        const d = this.noiseBuf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      } catch { this.ctx = null; return }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    const c = this.ctx, out = this.out
    if (!c || !out) return
    const t = c.currentTime + delay
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g); g.connect(out)
    o.start(t); o.stop(t + dur + 0.03)
  }

  private noise(dur: number, vol: number, freq: number, q = 1) {
    const c = this.ctx, out = this.out
    if (!c || !out || !this.noiseBuf) return
    const t = c.currentTime
    const src = c.createBufferSource()
    src.buffer = this.noiseBuf
    const f = c.createBiquadFilter()
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q
    const g = c.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f); f.connect(g); g.connect(out)
    src.start(t); src.stop(t + dur + 0.02)
  }

  whoosh() { this.noise(0.12, 0.25, 1800, 0.8) }
  hit(combo: number) {
    const up = Math.min(combo, 12) * 40
    this.tone(520 + up, 160 + up / 2, 0.14, 'square', 0.18)
    this.noise(0.08, 0.4, 900)
  }
  pop() { this.tone(900, 1800, 0.08, 'sine', 0.3); this.noise(0.05, 0.3, 3000) }
  /** A spring: a mushroom squashed, a bouncy ball knocked away. */
  boing() { this.tone(220, 660, 0.12, 'sine', 0.32); this.tone(660, 300, 0.2, 'triangle', 0.18, 0.1) }
  /** The crowd: a soft rising "yay" of three voices. */
  cheer() { [392, 494, 587].forEach((f, i) => this.tone(f * 0.9, f * 1.25, 0.32, 'triangle', 0.06, i * 0.03)); this.noise(0.35, 0.12, 2400, 0.5) }
  crate() { this.tone(180, 60, 0.25, 'triangle', 0.4); this.noise(0.18, 0.5, 400) }
  jump() { this.tone(300, 720, 0.18, 'sine', 0.22) }
  slam() { this.tone(140, 40, 0.4, 'sine', 0.6); this.noise(0.3, 0.6, 250, 0.6) }
  hurt() { this.tone(400, 120, 0.3, 'sawtooth', 0.15) }
  steal() { this.tone(500, 260, 0.2, 'triangle', 0.2); this.tone(380, 200, 0.25, 'triangle', 0.2, 0.12) }
  bonus() { [660, 880, 1320].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.12, i * 0.07)) }
  tick() { this.tone(1200, 1200, 0.05, 'square', 0.08) }
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f * 1.01, 0.22, 'triangle', 0.25, i * 0.12)) }
}
