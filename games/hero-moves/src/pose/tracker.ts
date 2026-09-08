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

/** The largest square of `side` centred on (cx, cy) that still fits the frame. */
function squareIn(cx: number, cy: number, side: number, vw: number, vh: number) {
  const s = Math.min(side, vw, vh)
  return {
    x: Math.max(0, Math.min(vw - s, cx - s / 2)),
    y: Math.max(0, Math.min(vh - s, cy - s / 2)),
    w: s, h: s,
  }
}

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

    const found = this.window[lane] ?? squareIn(
      laneX + laneW / 2, vh / 2, Math.min(vh, laneW * (1 + 2 * OVERLAP)), vw, vh)
    const { x: sx, y: sy, w: sw, h: sh } = found

    // Letterbox into the square input rather than stretching: a squashed body
    // reads as a different pose, which is exactly the error the classifier
    // cannot recover from.
    const scale = Math.min(INPUT_SIZE / sw, INPUT_SIZE / sh)
    const dw = sw * scale
    const dh = sh * scale
    const dx = (INPUT_SIZE - dw) / 2
    const dy = (INPUT_SIZE - dh) / 2
    g.fillStyle = '#000'
    g.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE)
    g.drawImage(this.video, sx, sy, sw, sh, dx, dy, dw, dh)
    return { c, sx, sy, sw, sh, laneX, laneW, vw, vh, dx, dy, dw, dh }
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
    const side = Math.max(torso * 3.9, vh * 0.5)
    this.window[lane] = squareIn(cx, cy, side, vw, vh)
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
    const { c, sx, sy, sw, sh, laneX, laneW, vw, vh, dx, dw, dy, dh } = box

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
        const cropX = (x * INPUT_SIZE - dx) / dw
        const cropY = (y * INPUT_SIZE - dy) / dh
        k.x = (sx + cropX * sw - laneX) / laneW
        k.y = (sy + cropY * sh) / laneW
        k.score = data[i * 3 + 2]
      }
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
