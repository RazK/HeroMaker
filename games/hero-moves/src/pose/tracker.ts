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
 */

export type TrackerState = 'idle' | 'starting' | 'ready' | 'denied' | 'unsupported' | 'failed'

const INPUT_SIZE = 192

export class PoseTracker {
  state: TrackerState = 'idle'
  error = ''
  skeleton: Skeleton = emptySkeleton()
  /** Wall-clock ms of the last inference, for the performance readout. */
  lastInferenceMs = 0
  fps = 0

  readonly video = document.createElement('video')
  private model: GraphModel | null = null
  private stream: MediaStream | null = null
  private busy = false
  private frames = 0
  private fpsSince = 0

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
  async update(now: number): Promise<Skeleton | null> {
    if (this.state !== 'ready' || !this.model || this.busy) return null
    if (this.video.readyState < 2) return null
    this.busy = true
    const started = performance.now()
    try {
      const input = tf.tidy(() => tf.expandDims(
        tf.cast(tf.image.resizeBilinear(tf.browser.fromPixels(this.video), [INPUT_SIZE, INPUT_SIZE]), 'int32'), 0))
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
}
