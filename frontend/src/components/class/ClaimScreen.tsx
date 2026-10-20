import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, getAuthToken } from '../../api/client';
import { ClaimView, claimApi, heroFile } from '../../api/classes';
import { HeroLive, LiveHero } from '../tb/HeroLive';
import { Icon } from '../tb/Icon';
import { Header, useClearOfPolaroid, useFitScreen } from '../tb/parts';
import './class.css';

export const CLAIM_PATH = '/claim/';

/** The moves a parent can try before keeping the hero: a taste, not the game. */
const CLAIM_MOVES = ['dance', 'bodyroll', 'backflip'];

/** The signed-in account a kept hero goes to; null when signed out. */
interface Account { email: string }

/**
 * A parent keeps their child's class hero: it moves into their account with
 * the child's first name and age. Parent voice: calm, plain, precise.
 *
 * The account step is always visible. Signed out, "Keep" opens the sign-up
 * sheet (Google first), which says the hero will be saved there, and claims
 * once it closes signed in. Signed in, the bar names the account before the
 * tap, with "Switch account" for a phone someone else is signed in on. Kept,
 * it says where the hero is and how to find it on another device.
 */
export function ClaimScreen({ token, onHome, onSeeHeroes, onOpenHero }: {
  token: string;
  /** The logo: the gallery, as from every screen that shows it. */
  onHome: () => void;
  onSeeHeroes: () => void;
  /** Open the kept hero on its own page, in the parent's account. */
  onOpenHero: (creationId: string) => void;
}) {
  useFitScreen();
  const [view, setView] = useState<ClaimView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState(false);
  // undefined while it is being read: Keep waits, so it never claims blind.
  const [account, setAccount] = useState<Account | null | undefined>(() => (getAuthToken() ? undefined : null));
  // The hero as first shown live. Keeping it moves its files to the parent's
  // account; the stage keeps what it already loaded rather than reloading.
  const [live, setLive] = useState<LiveHero | null>(null);
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

  // Who is signed in on this device, read again whenever that changes.
  const readAccount = useCallback(() => {
    if (!getAuthToken()) { setAccount(null); return; }
    api.getMe().then((u) => setAccount({ email: u.email }), () => setAccount(null));
  }, []);
  useEffect(() => {
    readAccount();
    window.addEventListener('auth:login', readAccount);
    window.addEventListener('auth:logout', readAccount);
    return () => {
      window.removeEventListener('auth:login', readAccount);
      window.removeEventListener('auth:logout', readAccount);
    };
  }, [readAccount]);

  const hero = view?.hero;
  useEffect(() => {
    if (!view || !hero || hero.state !== 'ready' || live) return;
    setLive({ id: hero.creation_id, user_id: hero.user_id, name: view.first_name, age: view.age, character_name: hero.character_name, file_versions: hero.file_versions, painting: hero.painting });
  }, [view, hero, live]);

  const keep = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setView(await claimApi.keep(token));
      setMine(true);
      window.dispatchEvent(new CustomEvent('credits:changed'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not keep the hero. Try again.');
      load();
    } finally {
      setBusy(false);
    }
  }, [token, load]);

  // Back from the sign-in sheet, signed in: finish what "Keep" started, or
  // (a kept hero's link) look again: the parent who kept it sees it as theirs.
  useEffect(() => {
    const onLogin = () => {
      if (wantsClaim.current) { wantsClaim.current = false; keep(); return; }
      load();
    };
    window.addEventListener('auth:login', onLogin);
    return () => window.removeEventListener('auth:login', onLogin);
  }, [keep, load]);

  const first = view?.first_name ?? '';
  const askAccount = (mode: 'signup' | 'login') => {
    wantsClaim.current = true;
    window.dispatchEvent(new CustomEvent('auth:open', { detail: { mode, note: `${first}’s hero will be saved to this account.` } }));
  };
  const start = () => {
    if (account) { keep(); return; }
    askAccount('signup');
  };
  // Someone else is signed in here (a teacher, a sibling): sign them out, then
  // sign in to the right account, and the hero goes there.
  const switchAccount = async () => {
    await api.logout();
    askAccount('login');
  };

  const ready = hero?.state === 'ready';
  const done = mine || !!view?.kept_by_you;
  // Kept by someone else: the link is spent and the server sends nothing of
  // the child, so a link forwarded to a class group exposes no one.
  const spent = !!view?.claimed && !done;
  const heroName = hero?.character_name || `${first}’s hero`;
  const art = hero && !ready ? heroFile(hero, 'original.jpg') : null;
  useClearOfPolaroid(stageRef, art);

  return (
    <div className="tb-screen tb-screen--fit tb-hero-screen cls-claim" data-state={ready && live ? 'ready' : 'making'}>
      <Header
        left={(
          <button type="button" className="tb-logo cls-claim-logo" onClick={onHome} aria-label="HeroMaker home">
            <img src="/app-icon.png" alt="" width={40} height={40} />
          </button>
        )}
        title={view && !spent ? heroName : 'HeroMaker'}
      />
      {spent ? (
        <div className="tb-screen-body">
          <div className="tb-stage cls-claim-stage cls-claim-home">
            <div className="tb-stage-sun" />
            <span className="cls-claim-home-badge" aria-hidden="true"><Icon name="star" size={56} /></span>
          </div>
          <div className="cls-claim-who">
            <div className="tb-h2">This hero has a home</div>
            <div className="tb-muted">The parent who kept it finds it in their heroes.</div>
          </div>
        </div>
      ) : ready && live ? (
        <HeroLive
          key={live.id}
          creation={live}
          introRequest={0}
          moves={done ? [] : CLAIM_MOVES}
          notice={error && <div className="tb-notice tb-notice--error" role="alert">{error}</div>}
        />
      ) : (
        <div className="tb-screen-body">
          {error && <div className="tb-notice tb-notice--error" role="alert">{error}</div>}
          {view && hero && art && (
            <>
              <div ref={stageRef} className="tb-stage cls-claim-stage">
                <div className="tb-stage-sun" />
                <img className="tb-stage-img tb-hero-faded" src={art} alt={heroName} />
              </div>
              <div className="cls-claim-who">
                <div className="tb-h2">{heroName}</div>
                <div className="tb-muted">By {first}{view.age ? `, ${view.age}` : ''} · {view.class_title}</div>
              </div>
            </>
          )}
        </div>
      )}
      <div className="tb-bar">
        {done ? (
          <>
            <div className="cls-ready-line cls-claim-kept">{heroName} is in your heroes</div>
            {account && <div className="tb-bar-note cls-claim-account">Sign in as <strong>{account.email}</strong> on any device to find it.</div>}
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => window.dispatchEvent(new CustomEvent('credits:buy'))}><Icon name="coin" />Make more</button>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-open-hero" onClick={() => hero && onOpenHero(hero.creation_id)}><Icon name="star" />Open the hero</button>
          </>
        ) : spent ? (
          <>
            {account === null && (
              <button type="button" className="tb-btn tb-btn--secondary tb-btn--full cls-claim-signin"
                onClick={() => window.dispatchEvent(new CustomEvent('auth:open', { detail: { mode: 'login' } }))}>
                <Icon name="user" />Sign in
              </button>
            )}
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={onSeeHeroes}>Open HeroMaker</button>
          </>
        ) : (
          <>
            {!ready ? (
              <div className="tb-bar-note">Still being made. This page will update.</div>
            ) : account ? (
              <>
                <div className="tb-bar-note cls-claim-account">Saved to <strong>{account.email}</strong></div>
                <button type="button" className="tb-btn tb-btn--secondary tb-btn--full cls-switch" onClick={switchAccount}><Icon name="user" />Switch account</button>
              </>
            ) : (
              <div className="tb-bar-note">Free. Saved to the account you sign in with.</div>
            )}
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full cls-keep" disabled={!ready || busy || account === undefined} onClick={start}>
              <Icon name="star" />{busy ? 'Keeping…' : `Keep ${first || 'the'}’s hero`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
