import { forwardRef, ImgHTMLAttributes, useEffect, useRef, useState } from 'react';
import { retryDelay, retryUrl } from './pictureRetry';

/**
 * A hero's picture is never the browser's broken-image icon (Raz: "very ugly.
 * We cannot allow it").
 *
 * - The small thumbnail shows first; the sharp picture, when there is one,
 *   is fetched beside it and takes its place only once it is decoded, so the
 *   swap never shows a blank frame.
 * - A picture that fails is asked for again (pictureRetry.ts). If the sharp
 *   one still fails, the thumbnail stays.
 * - While the element has nothing to draw (failed, or retrying), it is
 *   hidden but keeps its place, so what shows is the card's own colour,
 *   never an icon in a grey box.
 */
export interface PictureSrc {
  src: string;
  /** Nothing to draw right now: hide the element (visibility, so it keeps its size). */
  hidden: boolean;
  onLoad: () => void;
  onError: () => void;
}

export function usePictureSrc(thumb: string, full?: string | null, onFail?: () => void): PictureSrc {
  const [inputs, setInputs] = useState({ thumb, full });
  const [sharp, setSharp] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [broken, setBroken] = useState(false);
  const failedRef = useRef(false);
  const failCb = useRef(onFail);
  failCb.current = onFail;
  const timer = useRef(0);

  // Another picture: start again, in this very render.
  if (inputs.thumb !== thumb || inputs.full !== full) {
    setInputs({ thumb, full });
    setSharp(null);
    setAttempt(0);
    setBroken(false);
    failedRef.current = false;
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The sharp picture, fetched beside the thumbnail and shown once decoded.
  useEffect(() => {
    if (!full || full === thumb) return;
    let alive = true;
    let tries = 0;
    let wait = 0;
    const img = new Image();
    img.onload = () => {
      const show = () => { if (alive) setSharp(img.src); };
      if (typeof img.decode === 'function') img.decode().then(show, show);
      else show();
    };
    img.onerror = () => {
      const delay = retryDelay(tries + 1);
      if (!alive || delay === null) return; // the thumbnail stays
      wait = window.setTimeout(() => { tries += 1; img.src = retryUrl(full, tries); }, delay);
    };
    img.src = full;
    return () => { alive = false; window.clearTimeout(wait); img.onload = img.onerror = null; };
  }, [thumb, full]);

  const onError = () => {
    // The sharp copy failed in place (dropped from the cache): the thumbnail.
    if (sharp) { setSharp(null); return; }
    setBroken(true);
    const delay = retryDelay(attempt + 1);
    if (delay === null) {
      if (!failedRef.current) { failedRef.current = true; failCb.current?.(); }
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAttempt((a) => a + 1), delay);
  };

  return {
    src: sharp ?? retryUrl(thumb, attempt),
    hidden: broken,
    onLoad: () => setBroken(false),
    onError,
  };
}

type SafeImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  /** What shows first: the thumbnail, or the only picture there is. */
  src: string;
  /** The sharp picture to show once it has loaded. */
  full?: string | null;
  /** Every try failed: the element stays, hidden. */
  onFail?: () => void;
};

/** An <img> for a hero's picture: see usePictureSrc. */
export const SafeImg = forwardRef<HTMLImageElement, SafeImgProps>(function SafeImg({ src, full, onFail, onLoad, style, ...rest }, ref) {
  const pic = usePictureSrc(src, full, onFail);
  return (
    <img
      ref={ref}
      {...rest}
      src={pic.src}
      style={pic.hidden ? { ...style, visibility: 'hidden' } : style}
      onLoad={(e) => { pic.onLoad(); onLoad?.(e); }}
      onError={pic.onError}
    />
  );
});
