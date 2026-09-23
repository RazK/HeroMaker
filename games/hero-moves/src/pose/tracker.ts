import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-backend-webgl'
import { loadGraphModel, type GraphModel } from '@tensorflow/tfjs-converter'
import { KEYPOINT_NAMES, emptySkeleton, type Skeleton } from './keypoints'
import { SkeletonSmoother } from './smooth'

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

/**
 * A square window, which may hang off the edge of the frame.
 *
 * Deliberately not clamped into the frame. Sliding an edge lane's window inward
 * to fit puts that player off-centre in their own crop and their neighbour
 * dead-centre in it — and a model that returns one skeleton then returns the
 * neighbour's. Measured: the best dancer of three scored 44 and the worst
 * scored 3,753, purely because of which lane they stood in. The part that hangs
 * off the frame is drawn as black instead, which costs nothing and keeps the
 * subject in the middle where the model expects them.
 */
const square = (cx: number, cy: number, side: number) =>
  ({ x: cx - side / 2, y: cy - side / 2, w: side, h: side })

export class PoseTracker {
  state: TrackerState = 'idle'
  error = ''
  skeleton: Skeleton = emptySkeleton()
  /**
   * Lane width over frame height, for anything that draws a lane skeleton.
   *
   * Lane keypoints are **isotropic**: both axes are in units of one lane width,
   * so x runs 0..1 across the lane and y runs 0..(1 / laneAspect) down the
   * frame. That is not a convenience — every feature the classifier uses is an
   * angle, and an angle is only meaningful if both axes share a scale. Storing
   * x per lane width and y per frame height instead stretched every limb by the
   * lane's aspect ratio, which read a raised arm as a crouch.
   */
  laneAspect = 1
  /** One skeleton per lane, reused between frames so nothing is allocated. */
  readonly lanes: Skeleton[] = [emptySkeleton(), emptySkeleton(), emptySkeleton()]
  /**
   * Camera-playback time, in ms, of the frame each lane's skeleton came from.
   *
   * A lane is only re-inferred every `players` frames, so "what does lane 2
   * show" and "when was that true" are different questions. The gate harness
   * needs the second one to know which pose to expect, and without it a slow
   * machine looks like a broken classifier.
   */
  readonly laneAt: number[] = [0, 0, 0]
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
  /**
   * Where each lane's body was last seen, in raw video pixels.
   *
   * Null means "look at the whole lane again". See `aim`.
   */
  private window: Array<{ x: number; y: number; w: number; h: number } | null> = [null, null, null]
  /**
   * One landmark filter per lane.
   *
   * Without it the rig is driven straight from raw per-frame model output and
   * the character shakes even when its player is standing still. See
   * `smooth.ts` — this is the step the reference pose pipelines do inside their
   * own wrappers and that loading the bare graph model leaves to us.
   */
  private smoothers = [new SkeletonSmoother(), new SkeletonSmoother(), new SkeletonSmoother()]
  private smoothing = true

  /** Off only for `tools/jitter.mjs`, which measures what it is worth. */
  setSmoothing(on: boolean) {
    this.smoothing = on
    for (const f of this.smoothers) f.reset()
  }

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
        // 16:9, because three people stand side by side and a 4:3 frame spends
        // its pixels on the ceiling. Every consumer reads videoWidth/Height, so
        // whatever the device actually gives back is handled.
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: 'user' },
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
  /**
   * Draw one lane into the square model input, and say where it came from.
   *
   * Split out so a harness can look at exactly the picture the model is given
   * (`tools/lanecrop.mjs`). Every wrong answer this tracker has produced has
   * been a cropping question, and cropping questions are settled by looking at
   * the crop.
   *
   * ## The crop is always square, and always around a body
   *
   * The model input is a 192x192 square, and the vocabulary was measured at
   * 100% on square frames with one avatar filling them (`tools/posegate.mjs`).
   * Handing it a full-height lane strip instead loses on both counts: the strip
   * letterboxes, so a quarter of the input is black bars and the body lands
   * small, and standing shoulder to shoulder the strip contains two or three
   * people, which a model that returns exactly one skeleton answers with a
   * blend of them. Measured on the three-dancer feed that way: wrists at
   * 0.11-0.6 confidence and the classifier refusing to name a single frame.
   *
   * So the first look at a lane is the largest square that fits the frame's
   * height, centred on the lane — wide enough that an arm held out is not
   * amputated, which matters because MoveNet does not report a missing wrist,
   * it *invents* one at the edge, turning a clean T-pose into a shrug. Every
   * look after that is a square around the body the last one found, which is
   * the condition the vocabulary was measured in.
   */
  private drawLane(lane: number, n: number) {
    const vw = this.video.videoWidth || 640
    const vh = this.video.videoHeight || 480
    if (!this.crop) this.crop = document.createElement('canvas')
    const c = this.crop
    c.width = INPUT_SIZE
    c.height = INPUT_SIZE
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return null

    // The feed is shown mirrored, so the player standing on the *left of the
    // screen* is on the right of the raw frame. Crop from the raw frame — the
    // model must not see a mirrored body or every left bone becomes a right one.
    const laneW = vw / n
    const laneX = (n - 1 - lane) * laneW

    const found = this.window[lane] ?? square(
      laneX + laneW / 2, vh / 2, Math.min(vh, laneW * (1 + 2 * OVERLAP)))
    const { x: sx, y: sy, w: side } = found

    // The window is square and the input is square, so it maps one to one; only
    // the part of it that is actually inside the frame gets drawn, in its own
    // place, and the rest stays black.
    const scale = INPUT_SIZE / side
    const cx0 = Math.max(0, Math.min(vw, sx))
    const cx1 = Math.max(0, Math.min(vw, sx + side))
    const cy0 = Math.max(0, Math.min(vh, sy))
    const cy1 = Math.max(0, Math.min(vh, sy + side))
    g.fillStyle = '#000'
    g.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
    if (cx1 > cx0 && cy1 > cy0) {
      g.drawImage(this.video, cx0, cy0, cx1 - cx0, cy1 - cy0,
        (cx0 - sx) * scale, (cy0 - sy) * scale, (cx1 - cx0) * scale, (cy1 - cy0) * scale)
    }
    if (n > 1) this.vignette(g, (laneX + laneW / 2 - sx) * scale, laneW * scale)
    return { c, sx, sy, side, laneX, laneW, vw, vh }
  }

  /**
   * Dim everything that is not this player.
   *
   * A crop tall enough to hold one whole body is also wide enough to hold the
   * people either side of them — three players stand about six tenths of a body
   * height apart, which is what a family in a living room actually does — and a
   * model that returns exactly one skeleton will happily return the neighbour's.
   * Masking the neighbours outright is worse than useless, because an arm held
   * out crosses into their space and would be cut off. Shading them down leaves
   * every limb where it is and makes the centred body the obvious subject.
   */
  private vignette(g: CanvasRenderingContext2D, centre: number, laneWidth: number) {
    const clear = laneWidth * 0.62
    const gone = laneWidth * 1.15
    const grad = g.createLinearGradient(0, 0, INPUT_SIZE, 0)
    const stop = (px: number, a: number) =>
      grad.addColorStop(Math.max(0, Math.min(1, px / INPUT_SIZE)), `rgba(12,12,16,${a})`)
    stop(centre - gone, 0.82)
    stop(centre - clear, 0)
    stop(centre + clear, 0)
    stop(centre + gone, 0.82)
    g.fillStyle = grad
    g.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
  }

  /**
   * Aim the next look at this lane from the body just found in it.
   *
   * Sized off the **torso**, never off the pose. A window fitted to the
   * keypoints it just saw collapses: a crop that clipped the arms reports a
   * narrower body, which fits a narrower window, which clips more — measured,
   * this ate its way down to a head-and-shoulders shot in about a second, and
   * a model that cannot see the limbs cannot name the pose. Shoulders and hips
   * do not move when an arm goes up, so a multiple of them is stable, and the
   * four joints involved are the ones this tracker reads best.
   *
   * Three guards, all about not following the wrong person: the torso has to be
   * confidently read, big enough to be a body, and still inside this lane.
   * Failing any of them throws the window away and the next look is the whole
   * lane again — a tracker that quietly locks onto a neighbour is worse than
   * one that has to find its player twice.
   */
  private aim(lane: number, sk: Skeleton, laneX: number, laneW: number, vw: number, vh: number) {
    const corners = [sk.leftShoulder, sk.rightShoulder, sk.leftHip, sk.rightHip]
    if (corners.some((k) => k.score < 0.3)) { this.window[lane] = null; return }

    const mid = (sk.leftHip.x + sk.rightHip.x + sk.leftShoulder.x + sk.rightShoulder.x) / 4
    if (mid < -0.4 || mid > 1.4) { this.window[lane] = null; return }

    const cx = laneX + mid * laneW
    const cy = ((sk.leftShoulder.y + sk.rightShoulder.y + sk.leftHip.y + sk.rightHip.y) / 4) * laneW
    const torso = Math.abs(
      ((sk.leftHip.y + sk.rightHip.y) - (sk.leftShoulder.y + sk.rightShoulder.y)) / 2) * laneW
    if (torso < vh * 0.06) { this.window[lane] = null; return }

    // A standing body is about four and a half torsos tall, and an arm out
    // reaches about as wide as the body is tall; the floor keeps a short read
    // from zooming in on a chest.
    const side = Math.max(torso * 5.0, vh * 0.75)
    void vw
    this.window[lane] = square(cx, cy, side)
  }

  /** The exact picture lane `lane` is judged from, as a PNG data URL. */
  laneCrop(lane: number, count: number): string | null {
    if (this.video.readyState < 2) return null
    const box = this.drawLane(lane, Math.max(1, Math.min(this.lanes.length, count)))
    return box ? box.c.toDataURL('image/png') : null
  }

  async updateLanes(now: number, count: number): Promise<Skeleton[]> {
    const n = Math.max(1, Math.min(this.lanes.length, count))
    const live = this.lanes.slice(0, n)
    if (!this.model || this.busy) return live
    if (this.state !== 'ready' || this.video.readyState < 2) return live

    const lane = this.nextLane % n
    this.nextLane = (this.nextLane + 1) % n
    this.laneAspect = (this.video.videoWidth || 640) / n / (this.video.videoHeight || 480)

    const box = this.drawLane(lane, n)
    if (!box) return live
    const { c, sx, sy, side, laneX, laneW, vw, vh } = box

    this.busy = true
    const started = performance.now()
    try {
      const input = tf.tidy(() => tf.expandDims(
        tf.cast(tf.browser.fromPixels(c), 'int32'), 0))
      const out = this.model.execute(input) as tf.Tensor
      const data = await out.data()
      input.dispose(); out.dispose()

      this.laneAt[lane] = performance.now() - this.streamStartedAt
      // Undo the letterbox, then the overlap, so keypoints come back in the
      // lane's own 0..1 space. A hand reaching into a neighbour's third lands
      // outside 0..1, which is correct and which every consumer tolerates:
      // scoring is built from relative limb vectors, and the camera strip
      // clips to the lane it draws.
      const target = this.lanes[lane]
      for (let i = 0; i < KEYPOINT_NAMES.length; i++) {
        const k = target[KEYPOINT_NAMES[i]]
        const y = data[i * 3], x = data[i * 3 + 1]
        k.x = (sx + x * side - laneX) / laneW
        k.y = (sy + y * side) / laneW
        k.score = data[i * 3 + 2]
      }
      if (this.smoothing) this.smoothers[lane].apply(target, now)
      this.aim(lane, target, laneX, laneW, vw, vh)
      // An overlapping crop can find the *neighbour's* body when this lane is
      // empty, and would then hand one player's dancing to an absent one's
      // hero. A player standing in their lane has their torso in it, so a torso
      // centred outside the lane means the lane is empty, whatever the model
      // reports. Clearing the scores is enough: every consumer already knows
      // how to show nothing.
      const mid = (target.leftHip.x + target.rightHip.x
        + target.leftShoulder.x + target.rightShoulder.x) / 4
      if (n > 1 && (mid < -0.08 || mid > 1.08)) {
        for (const name of KEYPOINT_NAMES) target[name].score = 0
        this.window[lane] = null
        this.smoothers[lane].reset()
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
