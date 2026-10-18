/**
 * "Save video", in the browser, at no cost to us: the film's own canvas and its
 * own soundtrack go into a `MediaRecorder` while the film plays once in real
 * time. Safari and recent Chrome record MP4 directly; anything else records
 * WebM, which a server-side `ffmpeg -c:v libx264` turns into the MP4 WhatsApp
 * and iOS want (tools/render-film.mjs does the same offline).
 */
/**
 * WebM first. Chromium builds without the proprietary codecs answer yes to
 * `isTypeSupported('video/mp4')` and then write an MP4 holding only the audio
 * track — measured, not guessed (tools/filmcheck.mjs). Safari cannot record
 * WebM at all, so it falls through to MP4, which it does record properly.
 */
const TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
]

export function recorderType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null
}

export interface Recording { stop(): Promise<Blob>; type: string }

export function startRecording(canvas: HTMLCanvasElement, audio: MediaStream | null, fps = 30): Recording {
  const type = recorderType()
  if (!type) throw new Error('This browser cannot record video')
  const video = canvas.captureStream(fps)
  const stream = new MediaStream([...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])])
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 128_000 })
  const parts: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
  rec.start(500)
  return {
    type,
    stop: () => new Promise<Blob>((ok) => {
      rec.onstop = () => {
        video.getTracks().forEach((t) => t.stop())
        ok(new Blob(parts, { type: type.split(';')[0] }))
      }
      rec.stop()
    }),
  }
}

/** Hand the file to the share sheet where there is one, else download it. */
export async function deliver(blob: Blob, name: string): Promise<'shared' | 'downloaded'> {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
  const file = new File([blob], `${name}.${ext}`, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await nav.share({ files: [file] }); return 'shared' } catch { /* fall through to a download */ }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
  return 'downloaded'
}
