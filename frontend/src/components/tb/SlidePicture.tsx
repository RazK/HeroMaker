import { CSSProperties, SyntheticEvent, useEffect, useState } from 'react';
import { usePictureSrc } from './Picture';

/**
 * The sun behind the painting and the live hero, behind the upper body only
 * (head and torso), so the hero is drawn as big as without it (HeroLive.css).
 * It was off for a while (Raz, 2026-11: "do we need the disc at all?") and is
 * back (Raz, 2026-11-15: "maybe resume the yellow circle we had earlier? it
 * was nice..."). False puts the figure on a soft contact shadow instead.
 */
export const SUN = true;

/**
 * A slide's picture, as big as the slide allows and never cropped: the small
 * thumbnail at once (cached from the gallery), the full picture when it lands.
 * Once its shape is known it is sized to it (so a thumbnail is drawn as big as
 * the full picture, and the drawing's rounded corners are its own).
 */
export function SlidePicture({ thumb, full, framed = false, polaroid = false, trim = false }: { thumb: string; full: string; framed?: boolean; polaroid?: boolean; trim?: boolean }) {
  // The thumbnail at once (cached from the gallery), the full picture once
  // it has loaded; retried, and never a broken image (Picture.tsx).
  const pic = usePictureSrc(thumb, full);
  const src = pic.src;
  const [ar, setAr] = useState(0);
  const shown = (e: SyntheticEvent<HTMLImageElement>) => {
    pic.onLoad();
    const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
    if (r > 0 && Math.abs(r - ar) > 0.005) setAr(r);
  };
  const hide = (style: CSSProperties | undefined): CSSProperties | undefined => (pic.hidden ? { ...style, visibility: 'hidden' } : style);
  const box = useOpaqueBox(trim ? thumb : null, full);
  if (trim && ar && box) {
    // A cut-out painting is sized by the figure, not by the transparent
    // margin round it: the figure fills the slide (nothing in the margin is
    // cut, it is empty), and stands on its contact shadow.
    const bw = box.right - box.left;
    const bh = box.bottom - box.top;
    const arFig = (ar * bw) / bh;
    // Positions in the picture's own pixels, so left/top whatever the
    // writing direction (media are never mirrored).
    const place: CSSProperties = { position: 'absolute', maxWidth: 'none', maxHeight: 'none', width: `${100 / bw}%`, height: `${100 / bh}%`, left: `${(-box.left / bw) * 100}%`, top: `${(-box.top / bh) * 100}%` };
    return (
      <div className="tb-slide-fit">
        <div className="tb-slide-figure" style={{ width: `min(100cqw, calc(100cqh * ${arFig}))`, aspectRatio: `${arFig}` }}>
          {!SUN && <span className="tb-contact" aria-hidden="true" />}
          <img className="tb-slide-pic" src={src} alt="" style={hide(place)} draggable={false} onLoad={shown} onError={pic.onError} />
        </div>
      </div>
    );
  }
  // The frame is outside the picture (content-box). A polaroid's frame is the
  // gallery's (--tb-pol-pad), and its tilt needs a little room of its own.
  const pad = polaroid ? 'var(--tb-pol-pad)' : `${framed ? 8 : 0}px`;
  const tilt = polaroid ? 0.92 : 1;
  const style: CSSProperties | undefined = ar
    ? { width: `min(calc((100cqw - 2 * ${pad}) * ${tilt}), calc((100cqh - 2 * ${pad}) * ${tilt} * ${ar}))`, aspectRatio: `${ar}` }
    : undefined;
  return (
    <div className={`tb-slide-fit${framed ? ' tb-slide-fit--framed' : ''}`}>
      <img className={`tb-slide-pic${ar ? '' : ' tb-slide-pic--contain'}${framed ? ' tb-slide-pic--framed' : ''}${polaroid ? ' tb-pol' : ''}`} src={src} alt="" style={hide(style)} draggable={false} onLoad={shown} onError={pic.onError} />
    </div>
  );
}

/** Where a cut-out's figure is: its opaque pixels' box, as fractions of the picture. */
interface OpaqueBox { left: number; top: number; right: number; bottom: number }

/**
 * Read a cut-out's alpha (its thumbnail, else the picture) for the box its
 * figure fills. Null until known, or when it cannot be read (no CORS, no
 * alpha): the picture is then shown whole, as before.
 */
function useOpaqueBox(url: string | null, fallback: string): OpaqueBox | null {
  const [box, setBox] = useState<OpaqueBox | null>(null);
  useEffect(() => {
    setBox(null);
    if (!url) return;
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      try {
        const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return;
        g.drawImage(img, 0, 0, w, h);
        const d = g.getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 16) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        if (x1 < 0) return;
        // A pixel's slack each side, so nothing faint at the edge is lost.
        const b = { left: Math.max(0, x0 - 1) / w, top: Math.max(0, y0 - 1) / h, right: Math.min(w, x1 + 2) / w, bottom: Math.min(h, y1 + 2) / h };
        // Nothing to gain from a picture that is all figure.
        if (b.right - b.left > 0.97 && b.bottom - b.top > 0.97) return;
        setBox(b);
      } catch { /* not readable here: shown whole */ }
    };
    // No thumbnail (not every cut-out has one): the picture itself.
    img.onerror = () => { if (alive && img.src !== new URL(fallback, location.href).href) img.src = fallback; };
    img.src = url;
    return () => { alive = false; img.onload = img.onerror = null; };
  }, [url, fallback]);
  return box;
}
