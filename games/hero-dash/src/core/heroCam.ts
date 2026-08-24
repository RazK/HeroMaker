import { clamp } from './math'

export interface CamReading {
  /** −1 (player at frame left) … +1 (frame right), already un-mirrored. */
  lean: number
  /** Silhouette top edge relative to the calibrated standing height. */
  rise: number
  /** Silhouette width relative to the calibrated standing width. */
  spread: number
  /** Fraction of the frame occupied — used to tell "nobody there" apart. */
  mass: number
}

export type CamState =
  | 'idle'
  | 'starting'
  /** Learning the empty room, so the player can be told apart from the sofa. */
  | 'learnRoom'
  /** Player has stepped back in; measuring their standing pose. */
  | 'measure'
  | 'ready'
  | 'denied'
  | 'unsupported'

const W = 80, H = 60          // analysis resolution; plenty for body-scale motion
const PIXELS = W * H
/**
 * Calibration is timed, not frame-counted: a phone at 60 fps and a laptop at
 * 20 fps must give the player the same couple of seconds to step out and back.
 */
const ROOM_SECONDS = 2.6
const MEASURE_SECONDS = 1.3

/**
 * Body control without a downloaded pose model.
 *
 * A slowly-adapting background estimate gives a foreground silhouette, and the
 * silhouette's centroid, top edge and width are enough to read the four things
 * this game needs: step left/right, jump, crouch, and throw a star pose. It
 * costs nothing to ship, runs anywhere getUserMedia does, and — unlike a CDN
 * pose model — still works inside a sandbox that blocks external requests.
 */
export class HeroCam {
  state: CamState = 'idle'
  reading: CamReading = { lean: 0, rise: 0, spread: 1, mass: 0 }
  error = ''
  /** False when the frame has no moving body in it — the player is out of shot. */
  seesPlayer = false

  private video = document.createElement('video')
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private stream: MediaStream | null = null
  private background = new Float32Array(PIXELS)
  private phaseStart = 0
  private baseTop = 0.18
  private baseWidth = 0.30
  private baseCentre = 0.5
  private samples: Array<[number, number, number]> = []
  private roomSeeded = false
  /** Mirrored preview the UI can show the player. */
  readonly preview = document.createElement('canvas')

  constructor() {
    this.canvas.width = W; this.canvas.height = H
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
    this.preview.width = 160; this.preview.height = 120
    this.video.playsInline = true
    this.video.muted = true
  }

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  }

  async start(): Promise<CamState> {
    if (!this.supported) { this.state = 'unsupported'; return this.state }
    this.state = 'starting'
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' },
        audio: false,
      })
      this.video.srcObject = this.stream
      await this.video.play()
      this.beginCalibration()
    } catch (err: any) {
      this.error = err?.name === 'NotAllowedError' ? 'Camera permission denied' : (err?.message ?? 'Camera unavailable')
      this.state = 'denied'
    }
    return this.state
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    this.state = 'idle'
  }

  /** Restart the whole two-step calibration. */
  recalibrate() {
    if (this.state === 'idle' || this.state === 'denied' || this.state === 'unsupported') return
    this.beginCalibration()
  }

  private beginCalibration() {
    this.background.fill(-1)
    this.phaseStart = performance.now()
    this.roomSeeded = false
    this.samples.length = 0
    this.seesPlayer = false
    this.state = 'learnRoom'
  }

  /** Roughly how far through the current calibration step we are, 0..1. */
  get progress() {
    const secs = (performance.now() - this.phaseStart) / 1000
    if (this.state === 'learnRoom') return Math.min(1, secs / ROOM_SECONDS)
    if (this.state === 'measure') return Math.min(1, secs / MEASURE_SECONDS)
    return 1
  }

  update(): CamReading | null {
    if (this.state === 'idle' || this.state === 'starting' || this.state === 'denied' || this.state === 'unsupported') return null
    if (this.video.readyState < 2) return null

    this.ctx.drawImage(this.video, 0, 0, W, H)
    const data = this.ctx.getImageData(0, 0, W, H).data

    if (this.state === 'learnRoom') {
      // Average the empty room. Everything after this is "what changed".
      for (let i = 0; i < PIXELS; i++) {
        const p = i * 4
        const luma = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) / 255
        this.background[i] = this.roomSeeded ? this.background[i] + (luma - this.background[i]) * 0.25 : luma
      }
      this.roomSeeded = true
      if (this.progress >= 1) { this.state = 'measure'; this.phaseStart = performance.now() }
      this.drawPreview(null)
      return null
    }

    let minRow = H, sumX = 0, minX = W, maxX = 0, mass = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x
        const p = i * 4
        const luma = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) / 255
        const diff = Math.abs(luma - this.background[i])
        if (diff > 0.13) {
          mass++
          sumX += x
          if (y < minRow) minRow = y
          if (x < minX) minX = x
          if (x > maxX) maxX = x
        } else {
          // Only background-classified pixels drift, so a still player is never
          // absorbed back into the room.
          this.background[i] += (luma - this.background[i]) * 0.01
        }
      }
    }

    const frac = mass / PIXELS
    this.seesPlayer = frac >= 0.02
    if (!this.seesPlayer) {
      this.reading = { lean: 0, rise: 0, spread: 1, mass: frac }
      this.drawPreview(null)
      return this.state === 'ready' ? this.reading : null
    }

    const centre = sumX / mass / W
    const top = minRow / H
    const width = (maxX - minX + 1) / W
    this.drawPreview({ centre, top, width })

    if (this.state === 'measure') {
      // Restart the clock until the player is actually standing in shot.
      if (this.samples.length === 0) this.phaseStart = performance.now()
      this.samples.push([centre, top, width])
      if (this.progress >= 1 && this.samples.length >= 8) {
        const median = (k: number) => {
          const v = this.samples.map((sample) => sample[k]).sort((a, b) => a - b)
          return v[Math.floor(v.length / 2)]
        }
        this.baseCentre = median(0)
        this.baseTop = median(1)
        this.baseWidth = Math.max(0.10, median(2))
        this.state = 'ready'
      }
      return null
    }

    this.reading = {
      lean: clamp((centre - this.baseCentre) * 4.2, -1, 1),
      rise: (this.baseTop - top) / 0.16,
      spread: width / this.baseWidth,
      mass: frac,
    }
    return this.reading
  }

  private drawPreview(box: { centre: number; top: number; width: number } | null) {
    const g = this.preview.getContext('2d')!
    const { width: pw, height: ph } = this.preview
    g.save()
    g.translate(pw, 0); g.scale(-1, 1)          // mirror, so it reads like a mirror
    g.drawImage(this.video, 0, 0, pw, ph)
    g.restore()
    if (!box) return
    g.strokeStyle = this.state === 'ready' ? '#ffd23f' : '#ff5c8a'
    g.lineWidth = 3
    const x = (1 - box.centre) * pw
    g.beginPath()
    g.moveTo(x, box.top * ph); g.lineTo(x, ph)
    g.stroke()
  }
}
