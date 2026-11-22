import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import './Landing.css';

/**
 * What a signed-out visitor sees first, above the gallery (Raz, 2026-11-22):
 * the promise in three pictures. Violet Volt as Maya drew her, as we painted
 * her, and alive in 3D, with a wavy arrow between each. Then the two ways in,
 * Run a class and Make a hero, right above the gallery.
 *
 * Phone: the pictures in one row, each sentence under its own picture, then
 * the two buttons. Desktop: the headline (one sentence per line) and Make a
 * hero on the left, the pictures on the right.
 *
 * While these buttons are on screen the bar below is empty; scrolled past
 * them, they are in the bar (App, `onButtonsShown`).
 */
const LINES = ['You draw it.', 'We paint it.', 'It comes alive!'] as const;

interface LandingProps {
  onMakeHero: () => void;
  onRunClass: () => void;
  busy?: boolean;
  /** Whether the landing's own buttons are on screen, as the visitor scrolls. */
  onButtonsShown: (shown: boolean) => void;
}

export function Landing({ onMakeHero, onRunClass, busy, onButtonsShown }: LandingProps) {
  // Phone and desktop each show one set of these buttons (the other is
  // display: none, and never on screen), so "shown" is either of them.
  const sideRef = useRef<HTMLDivElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = [sideRef.current, belowRef.current].filter((e): e is HTMLDivElement => !!e);
    if (!els.length || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e.isIntersecting));
      onButtonsShown([...seen.values()].some(Boolean));
    }, { threshold: 0.6 });
    els.forEach((e) => io.observe(e));
    return () => { io.disconnect(); onButtonsShown(false); };
  }, [onButtonsShown]);

  return (
    <>
    <section className="tb-landing" aria-label="What HeroMaker does">
      <div className="tb-landing-text">
        <h1 className="tb-landing-title">{LINES.map((l) => <span key={l}>{l} </span>)}</h1>
        <div className="tb-landing-acts tb-landing-acts--side" ref={sideRef}>
          {/* A phone on its side has both, stacked, beside the pictures; a desktop only Make a hero. */}
          <button type="button" className="tb-btn tb-btn--secondary tb-landing-class tb-landing-class--side" onClick={onRunClass}>
            <Icon name="school" />Run a class
          </button>
          <button type="button" className="tb-btn tb-btn--primary tb-landing-make" disabled={busy} onClick={onMakeHero}>
            <Icon name="camera" />Make a hero
          </button>
        </div>
      </div>
      <div className="tb-landing-story">
        <figure className="tb-landing-pic tb-landing-pic--drawing">
          <span className="tb-landing-paper">
            <img src="/landing/violet-drawing.webp" alt="Maya's drawing of Violet Volt" width={520} height={520} />
            <span className="tb-landing-artist">Maya, 7</span>
          </span>
        </figure>
        <WavyArrow />
        <figure className="tb-landing-pic tb-landing-pic--painted">
          <img src="/landing/violet-painted.webp" alt="Violet Volt, painted" width={600} height={600} />
        </figure>
        <WavyArrow late />
        <figure className="tb-landing-pic tb-landing-pic--alive">
          <img src="/landing/violet-alive.webp" alt="Violet Volt dancing in 3D" width={192} height={400} />
        </figure>
        {/* Phone: each sentence under its own picture, in one row. */}
        {LINES.map((l, i) => <p key={l} className={`tb-landing-cap tb-landing-cap--${i + 1}`} aria-hidden="true">{l}</p>)}
      </div>
      <div className="tb-landing-acts tb-landing-acts--below tb-bar-row" ref={belowRef}>
        <button type="button" className="tb-btn tb-btn--secondary tb-landing-class" onClick={onRunClass}>
          <Icon name="school" />Run a class
        </button>
        <button type="button" className="tb-btn tb-btn--primary tb-landing-make" disabled={busy} onClick={onMakeHero}>
          <Icon name="camera" />Make a hero
        </button>
      </div>
    </section>
    <h2 className="tb-landing-gallery">Heroes kids made</h2>
    </>
  );
}

/* The arrow between two pictures: a straight line a sine wave travels along,
   tail to head, the ends still (Raz: "breathing... a sine that moves along
   the arrow"). Drawn on a 54 x 24 box; the head is still. */
const X0 = 6;
const X1 = 52;
const Y = 18;
const AMP = 3.6;
const WAVES = 2;
const FRAMES = 16;
const POINTS = 40;
const n = (v: number) => Math.round(v * 100) / 100;
const WAVE = Array.from({ length: FRAMES + 1 }, (_, f) => {
  const phase = (2 * Math.PI * f) / FRAMES;
  const pts = Array.from({ length: POINTS + 1 }, (_, k) => {
    const s = k / POINTS;
    const y = Y + AMP * Math.sin(Math.PI * s) ** 2 * Math.sin(2 * Math.PI * WAVES * s - phase);
    return `${n(X0 + (X1 - X0) * s)} ${n(y)}`;
  });
  return `M${pts.join(' L')}`;
});
const STILL = (() => {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return !!reduce;
})();

function WavyArrow({ late = false }: { late?: boolean }) {
  return (
    <svg className={`tb-landing-arrow${late ? ' tb-landing-arrow--2' : ''}`} viewBox="2 6 54 24" aria-hidden="true">
      <path d={WAVE[0]} fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round">
        {!STILL && <animate attributeName="d" values={WAVE.join(';')} dur="1.6s" begin={late ? '-0.8s' : '0s'} repeatCount="indefinite" />}
      </path>
      <path d={`M${X1 - 8} ${Y - 7} L${X1} ${Y} L${X1 - 8} ${Y + 7}`} fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
