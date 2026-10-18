import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer'
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer'
import type { Film } from './director'
import { renderAudio } from './music'

/**
 * "Save video" without a real-time recording: the film is stepped frame by
 * frame — the same `render(t)` the offline renderer uses — straight into the
 * browser's own video and audio encoders (WebCodecs), and muxed into a file.
 *
 * Why not `MediaRecorder` on the playing canvas: that records whatever frames
 * the device managed to draw in real time, so a slow phone saves a slideshow,
 * and under load it can save nothing at all (measured in a loaded sandbox: a
 * canvas recorded for 1.5 s came back as 0-1 KB). Stepping costs the same
 * work, never drops a frame, and finishes faster than real time on anything
 * with a GPU.
 *
 * MP4 (H.264 + AAC) where the browser can encode both — what WhatsApp and iOS
 * want — else WebM (VP9 + Opus), which a server-side ffmpeg turns into MP4.
 */
export interface Exported { blob: Blob; ext: 'mp4' | 'webm'; frames: number; seconds: number }

const FPS = 30

export function canExport(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'
}

async function supported(video: VideoEncoderConfig, audio: AudioEncoderConfig | null) {
  try {
    const v = await VideoEncoder.isConfigSupported(video)
    if (!v.supported) return false
    if (!audio) return true
    return typeof AudioEncoder !== 'undefined' && !!(await AudioEncoder.isConfigSupported(audio)).supported
  } catch { return false }
}

export async function exportFilm(film: Film, opts: { end?: number; onProgress?: (f: number) => void } = {}): Promise<Exported> {
  const { width, height } = film.canvas
  const end = Math.min(film.duration, opts.end ?? film.duration)
  const sampleRate = 48000
  const audioCfg = (codec: string): AudioEncoderConfig => ({ codec, sampleRate, numberOfChannels: 2, bitrate: 160_000 })
  const videoCfg = (codec: string): VideoEncoderConfig => ({ codec, width, height, bitrate: 6_000_000, framerate: FPS })

  const mp4 = await supported(videoCfg('avc1.640028'), audioCfg('mp4a.40.2'))
  const ext: 'mp4' | 'webm' = mp4 ? 'mp4' : 'webm'
  const vCodec = mp4 ? 'avc1.640028' : 'vp09.00.31.08'
  const aCodec = mp4 ? 'mp4a.40.2' : 'opus'
  if (!mp4 && !(await supported(videoCfg(vCodec), null))) throw new Error('This browser cannot encode video')
  const withAudio = await supported(videoCfg(vCodec), audioCfg(aCodec))

  const muxer: { addVideoChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void; addAudioChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void; finalize: () => void; target: { buffer: ArrayBuffer | null } } = mp4
    ? new Mp4Muxer({
      target: new Mp4Target(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
      video: { codec: 'avc', width, height, frameRate: FPS },
      ...(withAudio ? { audio: { codec: 'aac', sampleRate, numberOfChannels: 2 } } : {}),
    }) as never
    : new WebmMuxer({
      target: new WebmTarget(), firstTimestampBehavior: 'offset',
      video: { codec: 'V_VP9', width, height, frameRate: FPS },
      ...(withAudio ? { audio: { codec: 'A_OPUS', sampleRate, numberOfChannels: 2 } } : {}),
    }) as never

  let failure: unknown = null
  // ---- audio first: it is quick, and an encoder error should fail fast.
  if (withAudio) {
    const buf = await renderAudio(film.plan, sampleRate)
    const ae = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e } })
    ae.configure(audioCfg(aCodec))
    const total = Math.min(buf.length, Math.ceil(end * sampleRate))
    const block = 4800
    const l = buf.getChannelData(0), r = buf.getChannelData(1)
    for (let at = 0; at < total; at += block) {
      const n = Math.min(block, total - at)
      const planar = new Float32Array(n * 2)
      planar.set(l.subarray(at, at + n), 0)
      planar.set(r.subarray(at, at + n), n)
      const data = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at / sampleRate) * 1e6), data: planar })
      ae.encode(data)
      data.close()
    }
    await ae.flush()
    ae.close()
  }

  // ---- video, frame by frame.
  const ve = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e } })
  ve.configure(videoCfg(vCodec))
  const frames = Math.round(end * FPS)
  const started = performance.now()
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure
    film.render(i / FPS)
    const frame = new VideoFrame(film.canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) })
    ve.encode(frame, { keyFrame: i % (FPS * 2) === 0 })
    frame.close()
    // Let the encoder drain and the page breathe (progress ring, taps).
    if (ve.encodeQueueSize > 3 || i % 4 === 0) await new Promise((ok) => setTimeout(ok, 0))
    opts.onProgress?.((i + 1) / frames)
  }
  await ve.flush()
  ve.close()
  if (failure) throw failure
  muxer.finalize()
  const blob = new Blob([muxer.target.buffer!], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' })
  return { blob, ext, frames, seconds: (performance.now() - started) / 1000 }
}
