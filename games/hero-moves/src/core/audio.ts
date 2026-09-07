/**
 * Every sound in the game is synthesised at runtime — no audio files to ship,
 * which matters because the whole game has to fit in a single HTML page.
 */
export class Audio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private musicTimer = 0
  private step = 0
  enabled = true

  /** Must be called from a user gesture or the context stays suspended. */
  resume() {
    if (!this.ctx) {
      const Ctor = (window.AudioContext ?? (window as any).webkitAudioContext)
      if (!Ctor) return
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(this.ctx.destination)
      this.musicGain = this.ctx.createGain()
      this.musicGain.gain.value = 0.0
      this.musicGain.connect(this.master)
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (this.master) this.master.gain.value = on ? 0.5 : 0
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, bend = 1, dest?: AudioNode) {
    if (!this.ctx || !this.master || !this.enabled) return
    const t = this.ctx.currentTime
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (bend !== 1) osc.frequency.exponentialRampToValueAtTime(freq * bend, t + dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g); g.connect(dest ?? this.master)
    osc.start(t); osc.stop(t + dur + 0.02)
  }

  private noise(dur: number, vol: number, freq: number) {
    if (!this.ctx || !this.master || !this.enabled) return
    const t = this.ctx.currentTime
    const len = Math.floor(this.ctx.sampleRate * dur)
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = this.ctx.createBufferSource(); src.buffer = buf
    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'; filter.frequency.value = freq
    const g = this.ctx.createGain(); g.gain.value = vol
    src.connect(filter); filter.connect(g); g.connect(this.master)
    src.start(t)
  }

  star(combo: number) {
    // Rising pentatonic ladder so a collection streak sounds like a streak.
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21]
    const n = scale[Math.min(combo, scale.length - 1)]
    this.tone(523.25 * Math.pow(2, n / 12), 0.16, 'triangle', 0.18)
  }
  jump() { this.tone(300, 0.18, 'square', 0.10, 2.2) }
  land() { this.noise(0.09, 0.16, 900) }
  slide() { this.noise(0.34, 0.14, 2600) }
  pose() { this.tone(660, 0.1, 'sawtooth', 0.09, 1.6); this.tone(990, 0.22, 'triangle', 0.12, 1.35) }
  gate() { [0, 4, 7, 12].forEach((n, i) => setTimeout(() => this.tone(660 * Math.pow(2, n / 12), 0.2, 'triangle', 0.14), i * 55)) }
  crash() { this.noise(0.4, 0.4, 380); this.tone(150, 0.4, 'sawtooth', 0.16, 0.4) }
  powerUp() { [0, 4, 7, 12, 16, 19].forEach((n, i) => setTimeout(() => this.tone(440 * Math.pow(2, n / 12), 0.3, 'square', 0.11), i * 65)) }
  powerDown() { this.tone(600, 0.5, 'triangle', 0.1, 0.45) }
  gameOver() { [12, 7, 4, 0].forEach((n, i) => setTimeout(() => this.tone(440 * Math.pow(2, n / 12), 0.45, 'triangle', 0.16), i * 150)) }
  uiClick() { this.tone(880, 0.06, 'square', 0.07) }

  // ---------------------------------------------------------------- rhythm
  /**
   * Beat-locked backing, driven by the game clock rather than a timer of its
   * own.
   *
   * `updateMusic` below runs on its own interval, which is fine for a runner
   * where the music is atmosphere. It is wrong for a game where the player is
   * being scored against a beat: two clocks drift, and the thing you hear stops
   * being the thing you are judged on. This is called once per beat crossing
   * with the absolute beat index, so the audio and the choreography cannot
   * disagree.
   */
  danceBeat(beat: number) {
    if (!this.ctx || !this.enabled) return
    const inBar = ((beat % 4) + 4) % 4
    if (inBar === 0 || inBar === 2) this.kick()
    else this.snare()
    this.hat(inBar === 0 ? 0.055 : 0.03)

    // Eight-bar bass figure in A minor pentatonic, one note per beat.
    const BASS = [0, 0, 3, 5, 0, 0, 7, 5]
    const i = ((beat % 8) + 8) % 8
    this.tone(110 * Math.pow(2, BASS[i] / 12), 0.42, 'sine', 0.17, 1, this.musicGain ?? undefined)
    // A lead note on the off-quarters keeps the loop from feeling like a
    // metronome without competing with the calls.
    if (i === 2 || i === 6) {
      this.tone(440 * Math.pow(2, BASS[i] / 12), 0.3, 'triangle', 0.06, 1, this.musicGain ?? undefined)
    }
  }

  private kick() { this.tone(130, 0.2, 'sine', 0.34, 0.34); this.noise(0.03, 0.1, 500) }
  private snare() { this.noise(0.13, 0.16, 3200); this.tone(190, 0.09, 'triangle', 0.09, 0.7) }
  private hat(vol: number) { this.noise(0.035, vol, 9000) }

  /** Counted in over the lead-in. `n` is beats remaining; 0 is "go". */
  countIn(n: number) {
    if (n > 0) this.tone(n === 1 ? 880 : 660, 0.09, 'square', 0.13)
    else this.tone(1320, 0.24, 'triangle', 0.18, 1.25)
  }

  /** One sting per graded call, pitched by how well it went. */
  grade(name: string) {
    switch (name) {
      case 'PERFECT': [0, 7, 12, 16].forEach((n, i) =>
        setTimeout(() => this.tone(660 * Math.pow(2, n / 12), 0.2, 'triangle', 0.15), i * 45)); break
      case 'GREAT': [0, 7, 12].forEach((n, i) =>
        setTimeout(() => this.tone(587 * Math.pow(2, n / 12), 0.18, 'triangle', 0.13), i * 50)); break
      case 'GOOD': this.tone(523, 0.16, 'triangle', 0.12); break
      case 'OK': this.tone(392, 0.16, 'sine', 0.11); break
      default: this.tone(220, 0.26, 'sawtooth', 0.10, 0.62)
    }
  }

  setMusic(on: boolean) {
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.4)
    }
  }

  /** Sparse arpeggio bed; intensity rises with game speed. */
  updateMusic(dt: number, intensity: number) {
    if (!this.ctx || !this.enabled || !this.musicGain) return
    this.musicTimer -= dt
    if (this.musicTimer > 0) return
    const beat = 0.34 - 0.10 * intensity
    this.musicTimer = beat
    const BASS = [0, 0, 5, 5, 7, 7, 3, 3]
    const LEAD = [12, 16, 19, 16, 17, 21, 24, 19]
    const i = this.step++ % 8
    this.tone(110 * Math.pow(2, BASS[i] / 12), beat * 1.7, 'sine', 0.20, 1, this.musicGain)
    if (i % 2 === 0 || intensity > 0.5) {
      this.tone(220 * Math.pow(2, LEAD[i] / 12), beat * 0.85, 'triangle', 0.085, 1, this.musicGain)
    }
  }
}
