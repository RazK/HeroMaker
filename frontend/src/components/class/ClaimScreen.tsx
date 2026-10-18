import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getAuthToken } from '../../api/client';
import { ClaimView, claimApi, heroFile } from '../../api/classes';
import { Icon } from '../tb/Icon';
import { Header, Polaroid, useClearOfPolaroid, useFitScreen } from '../tb/parts';
import './class.css';

export const CLAIM_PATH = '/claim/';

/**
 * A parent keeps their child's class hero: it moves into their account with
 * the child's first name and age. Parent voice: calm, plain, precise.
 * Signed out, "Keep" opens the app's sign-up sheet and claims once it closes
 * signed in.
 */
export function ClaimScreen({ token, onSeeHeroes }: { token: string; onSeeHeroes: () => void }) {
  useFitScreen();
  const [view, setView] = useState<ClaimView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(false);
  const wantsClaim = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => claimApi.see(token).then(setView)
    .catch((e) => setError(e instanceof ApiError ? e.message : 'This link does not work right now.')), [token]);
  useEffect(() => { load(); }, [load]);
  // Still being made: look again until it is ready.
  useEffect(() => {
    if (!view?.hero || view.hero.state === 'ready') return;
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [view?.hero?.state, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const keep = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await claimApi.keep(token));
      setMine(true);
      window.dispatchEvent(new CustomEvent('auth:credits-updated'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not keep the hero. Try again.');
    } finally {
      setBusy(false);
    }
  }, [token]);

  // Back from the sign-up sheet, signed in: finish what "Keep" started.
  useEffect(() => {
    const onLogin = () => { if (wantsClaim.current) { wantsClaim.current = false; keep(); } };
    window.addEventListener('auth:login', onLogin);
    return () => window.removeEventListener('auth:login', onLogin);
  }, [keep]);

  const start = () => {
    if (getAuthToken()) { keep(); return; }
    wantsClaim.current = true;
    window.dispatchEvent(new CustomEvent('auth:open', { detail: { mode: 'signup' } }));
  };

  const hero = view?.hero;
  const kid = view ? `${view.first_name}${view.age ? `, ${view.age}` : ''}` : '';
  const art = hero ? heroFile(hero, hero.state === 'ready' ? 'rendered.png' : 'original.jpg') : null;
  useClearOfPolaroid(stageRef, art);
  const ready = hero?.state === 'ready';
  const done = mine;

  return (
    <div className="tb-screen tb-screen--fit cls-claim">
      <Header left={<img src="/logo-head-transparent.png" alt="HeroMaker" width={40} height={40} />} title={view ? `${view.first_name}’s hero` : 'HeroMaker'} />
      <div className="tb-screen-body">
        {error && <div className="tb-notice tb-notice--error" role="alert">{error}</div>}
        {view && hero && art && (
          <>
            <div ref={stageRef} className="tb-stage cls-claim-stage">
              <div className="tb-stage-sun" />
              <img className={`tb-stage-img${ready ? ' cls-pop' : ' tb-hero-faded'}`} src={art} alt={`${view.first_name}’s hero`} />
              {ready && <Polaroid src={heroFile(hero, 'thumb_original.jpg')} artist={view.first_name} age={view.age} />}
            </div>
            <div className="cls-claim-who">
              <div className="tb-h2">{done ? 'It’s yours' : hero.character_name || `${view.first_name}’s hero`}</div>
              <div className="tb-muted">{done ? `${view.first_name}’s hero is in My heroes.` : `By ${kid} · ${view.class_title}`}</div>
            </div>
          </>
        )}
      </div>
      <div className="tb-bar">
        {done ? (
          <>
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}><Icon name="coin" />Make more at home</button>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-see-heroes" onClick={onSeeHeroes}><Icon name="star" />See my heroes</button>
          </>
        ) : view?.claimed ? (
          <>
            <div className="tb-bar-note">This hero already has a home.</div>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={onSeeHeroes}>Open HeroMaker</button>
          </>
        ) : (
          <>
            <div className="tb-bar-note">{ready ? 'Free with an account. Yours to keep.' : 'Still being made. This page will update.'}</div>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-keep" disabled={!ready || busy} onClick={start}>
              <Icon name="star" />{busy ? 'Keeping…' : `Keep ${view?.first_name ?? 'the'}’s hero`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
