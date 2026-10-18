import { useEffect, useRef, useState } from 'react';
import { CreationResponse } from '../../api/client';
import { Icon } from './Icon';
import { Sheet } from './parts';
import type { StatueStage } from './statue3d';
import './StatueSheet.css';

/**
 * "Make {hero} real": the Hero Statue offer (a fake door — PROTOTYPE).
 *
 * The statue turns on its engraved base; size and engraving update it live.
 * Order does not take money: Lemon Squeezy forbids physical goods, so a
 * statue needs its own checkout before this can sell. Until then Order opens
 * a "coming soon, join the list" step that keeps the email on this device
 * only and logs the intent to the console (statue_* events).
 */
export const STATUE_SIZES = [
  { cm: 6, price: 49 },
  { cm: 9, price: 69 },
  { cm: 12, price: 99 },
] as const;

function firstName(name?: string | null) {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function creditLine(child: string, age: string) {
  const c = child.trim();
  if (!c) return '';
  return `drawn by ${c}${age.trim() ? `, age ${age.trim()}` : ''}`;
}

function track(event: string, data: Record<string, unknown>) {
  // No analytics pipeline yet: the prototype only records intent locally.
  console.info('[statue]', event, data);
}

export function StatueSheet({ creation, heroName, onClose }: { creation: CreationResponse; heroName: string; onClose: () => void }) {
  const [size, setSize] = useState(9);
  const [name, setName] = useState(heroName);
  const [child, setChild] = useState(firstName(creation.name));
  const [age, setAge] = useState(creation.age ? String(creation.age) : '');
  const [step, setStep] = useState<'design' | 'soon' | 'listed'>('design');
  const [email, setEmail] = useState('');
  const [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<StatueStage | null>(null);
  const price = STATUE_SIZES.find((s) => s.cm === size)!.price;

  useEffect(() => { track('statue_card_view', { creation: creation.id }); }, [creation.id]);

  // three.js arrives with the sheet, not with the app.
  useEffect(() => {
    let alive = true;
    import('./statue3d').then(({ StatueStage }) => {
      if (!alive || !host.current) return;
      stage.current = new StatueStage(host.current, {
        modelUrl: `/api/files/${creation.user_id}/${creation.id}/opt_model.glb`,
        name,
        credit: creditLine(child, age),
        onReady: () => alive && setReady(true),
      });
      (window as unknown as { __statue?: StatueStage }).__statue = stage.current;
    });
    return () => { alive = false; stage.current?.dispose(); stage.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creation.id]);

  useEffect(() => { stage.current?.setText(name, creditLine(child, age)); }, [name, child, age, ready]);
  useEffect(() => { stage.current?.setSize(size); }, [size, ready]);

  const order = () => {
    track('statue_order_click', { creation: creation.id, size, price, name, credit: creditLine(child, age) });
    setStep('soon');
  };
  const join = () => {
    try { localStorage.setItem(`heromaker.statue.waitlist.${creation.id}`, JSON.stringify({ email, size, name, credit: creditLine(child, age) })); } catch { /* fine */ }
    track('statue_waitlist_join', { creation: creation.id, size });
    setStep('listed');
  };

  return (
    <Sheet title={`Make ${heroName} real`} onClose={onClose} className="tb-statue-sheet">
      <div className="tb-statue-line">Full-colour statue, name on the base</div>
      <div className="tb-statue-stage" data-ready={ready ? '1' : '0'}>
        <div ref={host} className="tb-statue-canvas" />
        {!ready && <div className="tb-statue-loading" role="status">Sculpting the statue…</div>}
        <div className="tb-statue-size-tag">{size} cm tall</div>
      </div>

      {step === 'design' && (
        <>
          <div className="tb-statue-sizes" role="radiogroup" aria-label="Size">
            {STATUE_SIZES.map((s) => (
              <button
                key={s.cm}
                type="button"
                role="radio"
                aria-checked={size === s.cm}
                className={`tb-statue-size${size === s.cm ? ' tb-statue-size--on' : ''}`}
                onClick={() => { setSize(s.cm); track('statue_size_select', { size: s.cm }); }}
              >
                <span className="tb-statue-size-cm">{s.cm} cm</span>
                <span className="tb-statue-size-price">${s.price}</span>
              </button>
            ))}
          </div>
          <div className="tb-statue-fields">
            <div className="tb-field tb-statue-field-name">
              <label htmlFor="tb-statue-name">Name on the base</label>
              <input id="tb-statue-name" className="tb-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="tb-statue-row">
              <div className="tb-field">
                <label htmlFor="tb-statue-child">Drawn by</label>
                <input id="tb-statue-child" className="tb-input" value={child} maxLength={16} placeholder="First name" onChange={(e) => setChild(e.target.value)} />
              </div>
              <div className="tb-field tb-statue-age">
                <label htmlFor="tb-statue-age">Age</label>
                <input id="tb-statue-age" className="tb-input" value={age} inputMode="numeric" maxLength={2} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} />
              </div>
            </div>
          </div>
          <div className="tb-bar-note">Arrives in 2–3 weeks. A keepsake, not a toy (14+).</div>
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-statue-order" onClick={order}>
            <Icon name="statue" />Order · ${price}
          </button>
        </>
      )}

      {step === 'soon' && (
        <div className="tb-statue-soon">
          <div className="tb-h2">Coming soon</div>
          <div className="tb-muted">We are printing the first statues now. Get yours first.</div>
          <div className="tb-field">
            <label htmlFor="tb-statue-email">Email</label>
            <input id="tb-statue-email" className="tb-input" type="email" autoComplete="email" value={email} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setStep('design')}>Back</button>
            <button type="button" className="tb-btn tb-btn--primary tb-btn--full tb-statue-join" disabled={!/.+@.+\..+/.test(email)} onClick={join}>Join the list</button>
          </div>
        </div>
      )}

      {step === 'listed' && (
        <div className="tb-statue-soon">
          <div className="tb-h2">You’re on the list</div>
          <div className="tb-muted">We’ll email you when {name || heroName} can be ordered. No charge today.</div>
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={onClose}>Done</button>
        </div>
      )}
    </Sheet>
  );
}
