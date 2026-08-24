/**
 * Pin the app's box to the height you can actually see.
 *
 * `100vh` on a phone is the *large* viewport: the height the page would have if
 * the browser's URL bar were hidden. It is taller than the visible area, so
 * `#root { min-height: 100vh }` forced the document to be taller than the
 * screen. The app itself is `overflow: hidden` and stops at its own height, so
 * everything below it was a band of empty background you could scroll into -
 * dead space with nothing in it.
 *
 * `100dvh` fixes that on browsers that have it. This measures the visual
 * viewport directly so the box is exact everywhere, including the browsers old
 * enough to be missing dvh, and stays exact as the URL bar shows and hides.
 */
const VAR = '--app-height';

function apply() {
  const h = window.visualViewport?.height ?? window.innerHeight;
  if (h > 0) {
    document.documentElement.style.setProperty(VAR, `${Math.round(h)}px`);
  }
}

export function trackViewportHeight(): void {
  if (typeof window === 'undefined') return;
  apply();
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('resize', apply);
  // iOS reports a stale height mid-rotation, so take a second reading after it.
  window.addEventListener('orientationchange', () => setTimeout(apply, 250));
}
