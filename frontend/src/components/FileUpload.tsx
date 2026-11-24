import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Webcam from 'react-webcam';
import { useOverlayBack } from '../routes';
import { Icon } from './tb/Icon';
import { guideToSource, paperTrim } from './camera/frame';
import './tb/HeroTile.css';
import './FileUpload.css';

/**
 * The camera: photograph the drawing (docs/design/proposals/camera.md,
 * Maya, approved by Raz 2026-11-24). Used by "Make a hero" (App.tsx) and
 * the class's "Take a photo" (class/JoinFlow.tsx).
 *
 * Capture: the rear lens, full-bleed, a 3:4 guide with a scrim outside it,
 * and one row: Photos · shutter · Flip. Review: what was in the guide,
 * trimmed to the paper, as the app's polaroid, with Retake and Use this photo.
 * On a desktop the same screen is a 760 px card.
 */
interface FileUploadProps {
  /** A photo taken with the camera. */
  onUpload: (file: File) => void;
  /** A photo chosen with "Photos". Defaults to `onUpload`. */
  onChoose?: (file: File) => void;
  disabled?: boolean;
  onClose?: () => void;
}

type Lens = { facingMode: 'environment' | 'user' } | { deviceId: string };

/** A phone's lenses are chosen by the way they face; a desktop's by device. */
const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export function FileUpload({ onUpload, onChoose, disabled = false, onClose }: FileUploadProps) {
  const cam = useRef<Webcam>(null);
  const guide = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [lens, setLens] = useState<Lens>({ facingMode: 'environment' });
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [front, setFront] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shot, setShot] = useState<{ file: File; url: string; backdrop: string } | null>(null);

  const close = useCallback(() => onClose?.(), [onClose]);
  // Back (Android's too) closes the camera, not the screen under it.
  useOverlayBack(true, close);

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const onStream = (stream: MediaStream) => {
    setReady(true);
    setFailed(false);
    const track = stream.getVideoTracks()[0];
    const facing = track?.getSettings().facingMode;
    // Only the front lens is mirrored. A desktop webcam rarely says which
    // way it faces; one that faces the user is the usual case.
    setFront(facing === 'user' || (!facing && ('facingMode' in lens ? lens.facingMode === 'user' : !coarse())));
    navigator.mediaDevices?.enumerateDevices?.()
      .then((all) => setCameras(all.filter((d) => d.kind === 'videoinput')))
      .catch(() => {});
  };

  const flip = () => {
    setReady(false);
    if (coarse()) {
      setLens('facingMode' in lens && lens.facingMode === 'user' ? { facingMode: 'environment' } : { facingMode: 'user' });
      return;
    }
    const now = cam.current?.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const at = cameras.findIndex((d) => d.deviceId === now);
    const next = cameras[(at + 1) % cameras.length];
    if (next) setLens({ deviceId: next.deviceId });
  };

  const capture = () => {
    const video = cam.current?.video;
    const box = video?.getBoundingClientRect();
    const g = guide.current?.getBoundingClientRect();
    if (!video || !box || !g || !video.videoWidth) return;
    const src = guideToSource(video.videoWidth, video.videoHeight, box.width, box.height,
      { x: g.left - box.left, y: g.top - box.top, w: g.width, h: g.height }, front);

    // Look for the paper on a small copy, then cut the full-size one.
    const small = document.createElement('canvas');
    const k = Math.min(1, 240 / src.w);
    small.width = Math.max(1, Math.round(src.w * k));
    small.height = Math.max(1, Math.round(src.h * k));
    const sctx = small.getContext('2d', { willReadFrequently: true });
    if (!sctx) return;
    sctx.drawImage(video, src.x, src.y, src.w, src.h, 0, 0, small.width, small.height);
    const t = paperTrim(sctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
    const cut = {
      x: src.x + Math.round(t.left / k),
      y: src.y + Math.round(t.top / k),
      w: src.w - Math.round((t.left + t.right) / k),
      h: src.h - Math.round((t.top + t.bottom) / k),
    };

    const out = document.createElement('canvas');
    out.width = cut.w;
    out.height = cut.h;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    // The saved photo is never mirrored: the drawing reads the right way round.
    ctx.drawImage(video, cut.x, cut.y, cut.w, cut.h, 0, 0, cut.w, cut.h);

    // The review sits over the frozen feed, blurred.
    const back = document.createElement('canvas');
    back.width = 160;
    back.height = Math.round((160 * box.height) / box.width);
    const bctx = back.getContext('2d');
    const seen = guideToSource(video.videoWidth, video.videoHeight, box.width, box.height, { x: 0, y: 0, w: box.width, h: box.height });
    bctx?.drawImage(video, seen.x, seen.y, seen.w, seen.h, 0, 0, back.width, back.height);
    const backdrop = back.toDataURL('image/jpeg', 0.6);

    out.toBlob((blob) => {
      if (!blob) return;
      setShot({ file: new File([blob], 'drawing.jpg', { type: 'image/jpeg' }), url: URL.createObjectURL(blob), backdrop });
    }, 'image/jpeg', 0.92);
  };

  const chosen = (f: File | undefined) => { if (f) (onChoose ?? onUpload)(f); };

  return createPortal(
    <div className="cam" role="dialog" aria-modal="true" aria-label="Take a photo of the drawing">
      <div className="cam-card">
        <Webcam
          ref={cam}
          className="cam-feed"
          audio={false}
          mirrored={front}
          playsInline
          muted
          videoConstraints={{ ...('deviceId' in lens ? { deviceId: { exact: lens.deviceId } } : { facingMode: { ideal: lens.facingMode } }), width: { ideal: 1920 }, height: { ideal: 1440 } }}
          onUserMedia={onStream}
          onUserMediaError={() => { setReady(false); setFailed(true); }}
        />

        {!shot && (
          <>
            <div className="cam-guide" ref={guide}>
              <div className="cam-hint">{failed ? "Can't open the camera. Choose a photo instead." : 'Lay the drawing flat and fill the frame.'}</div>
              <span className="cam-corner cam-corner--tl" />
              <span className="cam-corner cam-corner--tr" />
              <span className="cam-corner cam-corner--bl" />
              <span className="cam-corner cam-corner--br" />
            </div>
            <div className="cam-row">
              <button type="button" className="cam-side" onClick={() => picker.current?.click()}>
                <span className="cam-side-dot"><Icon name="image" /></span>Photos
              </button>
              <button type="button" className="cam-shutter" aria-label="Take the photo" onClick={capture} disabled={!ready || disabled} />
              {cameras.length > 1 ? (
                <button type="button" className="cam-side" onClick={flip}>
                  <span className="cam-side-dot"><Icon name="flip" /></span>Flip
                </button>
              ) : <span className="cam-side" aria-hidden="true" />}
            </div>
          </>
        )}

        {shot && (
          <div className="cam-review">
            <img className="cam-review-back" src={shot.backdrop} alt="" />
            <h2 className="cam-review-title">Looks good?</h2>
            <div className="cam-review-photo">
              <img className="tb-pol" src={shot.url} alt="Your drawing" />
            </div>
            <div className="cam-review-actions">
              <button type="button" className="tb-btn tb-btn--secondary" onClick={() => setShot(null)}>Retake</button>
              <button type="button" className="tb-btn tb-btn--primary" disabled={disabled} onClick={() => onUpload(shot.file)}>Use this photo</button>
            </div>
          </div>
        )}

        {!shot && <button type="button" className="cam-close" aria-label="Close" onClick={close}><Icon name="close" /></button>}
        <input ref={picker} type="file" accept="image/*" hidden onChange={(e) => { chosen(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>,
    document.body,
  );
}
