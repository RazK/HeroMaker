import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
import { loadGraphModel, type GraphModel } from '@tensorflow/tfjs-converter'
import { KEYPOINT_NAMES, emptySkeleton, type Skeleton } from './keypoints'

/**
 * Body tracking from the camera, with no network access of any kind.
 *
 * MoveNet Lightning rather than MediaPipe: MediaPipe's WASM runtime alone is
 * 11.8 MB before any model, which cannot fit a published page, while MoveNet is
 * 4.7 MB of weights that load straight from memory. `tf.io.fromMemory` keeps
 * the model in RAM, so a strict `connect-src` never comes into it.
 *
 * The trade is that MoveNet is 2D: it cannot tell an arm reaching forward from
 * one reaching back. The choreography is written to live in the frontal plane,
 * where that distinction does not arise.
 *
 * ## Several players
 *
 * This model finds one person. MoveNet also ships a MultiPose variant that
 * finds six in a single pass, and it was measured at **9.45 MB of weights
 * against this one's 4.65** — on a phone-first game that is the whole budget
 * again, for a worse result: at three-player distance each body occupies a
 * third of the frame, and the model is resized to 192x192 square regardless.
 *
 * So players stand in lanes and each lane is cropped and inferred separately.
 * That costs one inference per player, and buys three things: no extra
 * download, a subject that *fills* its crop rather than a third of it, and
 * player identity for free — a lane cannot be confused with another lane, so
 * nobody's score is ever handed to the wrong hero.
 */

export type TrackerState = 'idle' | 'starting' | 'ready' | 'denied' | 'unsupported' | 'failed'

const INPUT_SIZE = 192
/** How far into each neighbour a lane's crop reaches, as a fraction of a lane. */
const OVERLAP = 0.3

export class PoseTracker {
  state: TrackerState = 'idle'
  error = ''
  skeleton: Skeleton = emptySkeleton()
  /** One skeleton per lane, reused between frames so nothing is allocated. */
  readonly lanes: Skeleton[] = [emptySkeleton(), emptySkeleton(), emptySkeleton()]
  /** Wall-clock ms of the last inference, for the performance readout. */
  lastInferenceMs = 0
  /**
   * `performance.now()` at the moment the camera stream began playing.
   *
   * Only a recording uses it: a fake camera is a file with a known timeline, so
   * this is what lets a capture put the game's beat zero on the feed's first
   * beat without guessing. Nothing in the game reads it.
   */
  streamStartedAt = 0
  fps = 0

  readonly video = document.createElement('video')
  private model: GraphModel | null = null
  private stream: MediaStream | null = null
  private busy = false
  private frames = 0
  private fpsSince = 0
  /** Scratch canvas for cropping one lane out of the camera frame. */
  private crop: HTMLCanvasElement | null = null
  /** Lane the next inference will run on, so the cost is spread across frames. */
  private nextLane = 0

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  }

  /** Model bytes come from the page itself, never from a URL. */
  async loadModel(spec: { modelTopology: unknown; weightSpecs: unknown[]; weightDataB64: string }) {
    await tf.setBackend('webgl')
    await tf.ready()
    const binary = atob(spec.weightDataB64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    this.model = await loadGraphModel(tf.io.fromMemory({
      modelTopology: spec.modelTopology,
      weightSpecs: spec.weightSpecs,
      weightData: bytes.buffer,
    }) as never)
  }

  async start(): Promise<TrackerState> {
    if (!this.supported) { this.state = 'unsupported'; return this.state }
    this.state = 'starting'
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
      this.video.srcObject = this.stream
      this.video.playsInline = true
      this.video.muted = true
      await this.video.play()
      this.streamStartedAt = performance.now()
      this.state = this.model ? 'ready' : 'failed'
      if (!this.model) this.error = 'Pose model was not loaded'
    } catch (err) {
      const e = err as { name?: string; message?: string }
      this.error = e.name === 'NotAllowedError' ? 'Camera permission denied' : (e.message ?? 'Camera unavailable')
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

  /**
   * Run one inference. Skips if the previous one is still in flight, so a slow
   * device drops tracking frames instead of queueing them and falling behind.
   */
  async update(now: number, source?: TexImageSource): Promise<Skeleton | null> {
    if (!this.model || this.busy) return null
    if (!source && (this.state !== 'ready' || this.video.readyState < 2)) return null
    const pixels = source ?? this.video
    this.busy = true
    const started = performance.now()
    try {
      const input = tf.tidy(() => tf.expandDims(
        tf.cast(tf.image.resizeBilinear(tf.browser.fromPixels(pixels as never), [INPUT_SIZE, INPUT_SIZE]), 'int32'), 0))
      const out = this.model.execute(input) as tf.Tensor
      const data = await out.data()
      input.dispose(); out.dispose()

      // MoveNet returns [1,1,17,3] of (y, x, score), normalised to the input.
      for (let i = 0; i < KEYPOINT_NAMES.length; i++) {
        const k = this.skeleton[KEYPOINT_NAMES[i]]
        k.y = data[i * 3]
        k.x = data[i * 3 + 1]
        k.score = data[i * 3 + 2]
      }
      this.lastInferenceMs = performance.now() - started
      this.frames++
      if (now - this.fpsSince > 1000) {
        this.fps = (this.frames * 1000) / (now - this.fpsSince)
        this.frames = 0
        this.fpsSince = now
      }
      return this.skeleton
    } catch (err) {
      this.error = (err as Error).message
      this.state = 'failed'
      return null
    } finally {
      this.busy = false
    }
  }

  /**
   * Track `count` players standing side by side, one lane each.
   *
   * Only one lane is inferred per call, round-robin. Running all three every
   * frame would triple the frame cost and make the whole game stutter on the
   * device it is aimed at; a player holds a pose for four beats, so a lane
   * refreshed every third frame is still sampled many times inside the window
   * that scores it.
   *
   * Returns every lane's latest skeleton, including the ones not refreshed
   * this frame, so callers always have a full picture.
   */
  async updateLanes(now: number, count: number): Promise<Skeleton[]> {
    const n = Math.max(1, Math.min(this.lanes.length, count))
    const live = this.lanes.slice(0, n)
    if (!this.model || this.busy) return live
    if (this.state !== 'ready' || this.video.readyState < 2) return live

    const lane = this.nextLane % n
    this.nextLane = (this.nextLane + 1) % n

    const vw = this.video.videoWidth || 640
    const vh = this.video.videoHeight || 480
    if (!this.crop) this.crop = document.createElement('canvas')
    const c = this.crop
    c.width = INPUT_SIZE
    c.height = INPUT_SIZE
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return live

    // The feed is shown mirrored, so the player standing on the *left of the
    // screen* is on the right of the raw frame. Crop from the raw frame — the
    // model must not see a mirrored body or every left bone becomes a right one.
    const laneW = vw / n
    const laneX = (n - 1 - lane) * laneW
    // Crops overlap.
    //
    // Three people side by side own a third of the frame each, but an arm out
    // is wider than a third of a frame — a T-pose crosses well into the next
    // lane. Cropping at the lane edge amputates it, and MoveNet does not report
    // a missing wrist, it *guesses* one at the edge, which turns a clean T into
    // a shrug. So each crop takes a bite of its neighbours and lets the model
    // pick the body in the middle.
    const pad = n > 1 ? laneW * OVERLAP : 0
    const sx = Math.max(0, laneX - pad)
    const sw = Math.min(vw - sx, laneW + pad * 2)
    // Letterbox the crop into the square input rather than stretching it: a
    // squashed body reads as a different pose, which is exactly the error the
    // classifier cannot recover from.
    const scale = Math.min(INPUT_SIZE / sw, INPUT_SIZE / vh)
    const dw = sw * scale
    const dh = vh * scale
    const dx = (INPUT_SIZE - dw) / 2
    const dy = (INPUT_SIZE - dh) / 2
    g.fillStyle = '#000'
    g.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
    g.drawImage(this.video, sx, 0, sw, vh, dx, dy, dw, dh)

    this.busy = true
    const started = performance.now()
    try {
      const input = tf.tidy(() => tf.expandDims(
        tf.cast(tf.browser.fromPixels(c), 'int32'), 0))
      const out = this.model.execute(input) as tf.Tensor
      const data = await out.data()
      input.dispose(); out.dispose()

      // Undo the letterbox, then the overlap, so keypoints come back in the
      // lane's own 0..1 space. A hand reaching into a neighbour's third lands
      // outside 0..1, which is correct and which every consumer tolerates:
      // scoring is built from relative limb vectors, and the camera strip
      // clips to the lane it draws.
      const target = this.lanes[lane]
      for (let i = 0; i < KEYPOINT_NAMES.length; i++) {
        const k = target[KEYPOINT_NAMES[i]]
        const y = data[i * 3], x = data[i * 3 + 1]
        const cropX = (x * INPUT_SIZE - dx) / dw
        k.x = (sx + cropX * sw - laneX) / laneW
        k.y = (y * INPUT_SIZE - dy) / dh
        k.score = data[i * 3 + 2]
      }
      this.lastInferenceMs = performance.now() - started
      this.frames++
      if (now - this.fpsSince > 1000) {
        this.fps = (this.frames * 1000) / (now - this.fpsSince)
        this.frames = 0
        this.fpsSince = now
      }
    } catch (err) {
      this.error = (err as Error).message
      this.state = 'failed'
    } finally {
      this.busy = false
    }
    return live
  }
}
