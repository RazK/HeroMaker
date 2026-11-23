import { ReactNode, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Header, NavButton } from './parts';
import { SafeImg } from './Picture';
import { usePinchZoom } from './usePinchZoom';

/**
 * The drawing or the painting, full screen: a page of the app (cream, the
 * header's round close button), as big as the screen allows, never cropped;
 * two fingers zoom it. Back closes it, back to the same slide. The drawing
 * keeps its white card and its artist's name; a framed painting its card.
 */
export function FullPicture({ title, thumb, src, card, caption, onClose }: { title: string; thumb: string; src: string; card: boolean; caption: ReactNode; onClose: () => void }) {
  const pinch = usePinchZoom();
  const close = useFullBack(onClose);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return createPortal(
    <div className="tb-drawing-full" role="dialog" aria-modal="true" aria-label={title}>
      <Header left={<NavButton icon="close" label="Close" onClick={close} />} title={title} />
      <div className="tb-drawing-full-body" {...pinch.handlers}>
        <div className="tb-drawing-full-fit">
          <div className={`tb-live-zoom${pinch.settling ? ' tb-live-zoom--settle' : ''}`} style={{ transform: pinch.transform }}>
            {caption ? (
              <div className="tb-live-polaroid">
                <SafeImg className="tb-pol tb-live-polaroid-img" src={thumb} full={src} alt={title} draggable={false} />
                {caption}
              </div>
            ) : (
              <div className={card ? 'tb-live-card tb-live-card--bare' : 'tb-live-plain'}>
                <SafeImg className="tb-live-card-img" src={thumb} full={src} alt={title} draggable={false} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The full-screen picture owns a history entry of its own: Back closes it and
 * leaves the hero's page as it was. Returns the close action, which goes
 * through that entry when it is there.
 */
const FULL_KEY = 'tbDrawingFull';
const onFullEntry = () => !!(window.history.state as Record<string, unknown> | null)?.[FULL_KEY];
function useFullBack(onClose: () => void): () => void {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), [FULL_KEY]: true }, '');
    const onPop = () => { if (!onFullEntry()) cb.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed any other way: drop the entry, so the next Back is not a dead press.
      window.setTimeout(() => { if (onFullEntry()) window.history.back(); }, 0);
    };
  }, []);
  return useCallback(() => { if (onFullEntry()) window.history.back(); else cb.current(); }, []);
}
