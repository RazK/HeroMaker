import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/*
 * "Continue with Google", via Google Identity Services' ID-token flow.
 *
 * We use GIS's own rendered button (renderButton), not a Toy Box button that
 * calls google.accounts.id.prompt(). prompt() is One Tap: Google may decline
 * to show it at all (Safari's tracking prevention, FedCM, a cooldown after the
 * user dismissed it once), and when it declines the tap does nothing. The
 * rendered button is the only GIS entry point Google guarantees to open its
 * account chooser on every tap, on mobile Safari and Chrome alike. We style it
 * as close to Toy Box as GIS allows: pill, large, outline, full width.
 *
 * Nothing loads unless the backend reports a client id: no client id, no
 * script from accounts.google.com, and the component renders nothing.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client';
// GIS caps a rendered button's width at 400px.
const GSI_MAX_WIDTH = 400;

interface GsiCredentialResponse { credential?: string }
interface GsiId {
  initialize(config: { client_id: string; callback: (r: GsiCredentialResponse) => void; ux_mode?: 'popup' | 'redirect'; context?: string }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
}
declare global {
  interface Window { google?: { accounts: { id: GsiId } } }
}

let configPromise: Promise<string | null> | null = null;
function googleClientId(): Promise<string | null> {
  if (!configPromise) {
    configPromise = api.getAuthConfig()
      .then((c) => c.google_client_id || null)
      .catch(() => {
        configPromise = null; // try again next time the sheet opens
        return null;
      });
  }
  return configPromise;
}

let scriptPromise: Promise<GsiId> | null = null;
function loadGsi(): Promise<GsiId> {
  if (!scriptPromise) {
    scriptPromise = new Promise<GsiId>((resolve, reject) => {
      const done = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('GIS missing')));
      if (window.google?.accounts?.id) return done();
      const s = document.createElement('script');
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      s.onload = done;
      s.onerror = () => { scriptPromise = null; s.remove(); reject(new Error('GIS failed to load')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// GIS is initialized once per page; its callback forwards to whichever sheet
// is open now.
let initializedFor: string | null = null;
let currentHandler: ((credential: string) => void) | null = null;

export function GoogleSignIn({ onCredential }: { onCredential: (credential: string) => void }) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  currentHandler = onCredential;

  useEffect(() => {
    let cancelled = false;
    googleClientId().then((id) => { if (!cancelled) setClientId(id); });
    return () => { cancelled = true; };
  }, []);

  // Runs once the block below is on screen, so the button can be measured.
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGsi().then((gsi) => {
      if (cancelled || !holder.current) return;
      if (initializedFor !== clientId) {
        gsi.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: (r) => { if (r.credential) currentHandler?.(r.credential); },
        });
        initializedFor = clientId;
      }
      const width = Math.floor(holder.current.getBoundingClientRect().width) || GSI_MAX_WIDTH;
      gsi.renderButton(holder.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'center',
        width: Math.min(GSI_MAX_WIDTH, width),
      });
    }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (!clientId || failed) return null;

  return (
    <div className="auth-google">
      <div className="auth-google-button" ref={holder} />
      <div className="auth-or" role="separator"><span>or</span></div>
    </div>
  );
}
