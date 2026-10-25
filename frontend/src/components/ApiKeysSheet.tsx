import { useEffect, useState } from 'react';
import { api, ApiError, ApiKeyInfo } from '../api/client';
import { openLegal } from './tb/Legal';
import { Icon } from './tb/Icon';
import { Dialog, NavButton, Sheet } from './tb/parts';
import './ApiKeysSheet.css';

type Made = ApiKeyInfo & { key: string; webhook_secret: string };

const ago = (iso: string | null) => {
  if (!iso) return 'Never used';
  const s = (Date.now() - new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime()) / 1000;
  if (s < 3600) return 'Used just now';
  if (s < 86400) return `Used ${Math.round(s / 3600)} h ago`;
  return `Used ${Math.round(s / 86400)} d ago`;
};

/** A value to copy exactly: Nunito 800 (never Barriecito), and a Copy button. */
function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch { window.prompt(label, value); }
  };
  return (
    <div className="tb-field">
      <label>{label}</label>
      <div className="apikeys-copy">
        <code className="apikeys-value">{value}</code>
        <button type="button" className="tb-btn tb-btn--secondary apikeys-copy-btn" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={18} />{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/**
 * API keys, from the account sheet: the keys other apps and agents use to make
 * heroes with this account's credits (app/api/v1.py). A key is shown once, when
 * it is made; after that only its first characters.
 */
export function ApiKeysSheet({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [mode, setMode] = useState<'list' | 'new' | 'made'>('list');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'secret' | 'publishable'>('secret');
  const [origins, setOrigins] = useState('');
  const [perDay, setPerDay] = useState('20');
  const [made, setMade] = useState<Made | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listApiKeys().then((r) => setKeys(r.data), () => setKeys([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const sites = origins.split(/[\s,]+/).map((o) => o.trim()).filter(Boolean);
      const result = await api.createApiKey({
        name: name.trim() || (kind === 'secret' ? 'Server key' : 'Website key'),
        kind,
        ...(kind === 'publishable' ? { allowed_origins: sites, daily_limit: Number(perDay) || 20 } : {}),
      });
      setMade(result);
      setMode('made');
      setName(''); setOrigins('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not make the key. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKeyInfo) => {
    setBusy(true);
    try { await api.revokeApiKey(k.id); setRevoking(null); load(); } finally { setBusy(false); }
  };

  if (mode === 'made' && made) {
    return (
      <Sheet title="Your new key" onClose={onClose} className="apikeys-sheet">
        <div className="apikeys-body">
          <div className="tb-notice apikeys-once">Copy it now. It won't be shown again.</div>
          <CopyBox label={made.kind === 'secret' ? 'Secret key' : 'Website key'} value={made.key} />
          <CopyBox label="Webhook secret" value={made.webhook_secret} />
        </div>
        <div className="tb-stack apikeys-bar">
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => { setMade(null); setMode('list'); }}>Done</button>
        </div>
      </Sheet>
    );
  }

  if (mode === 'new') {
    const ready = kind === 'secret' || origins.trim().length > 0;
    return (
      <Sheet title="New key" onClose={onClose} className="apikeys-sheet">
        <div className="apikeys-body">
          <div className="tb-field">
            <label htmlFor="apikey-name">Name</label>
            <input id="apikey-name" className="tb-input" value={name} maxLength={80} placeholder="My game" dir="auto"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="tb-chip-row" role="radiogroup" aria-label="Where it is used">
            <button type="button" role="radio" aria-checked={kind === 'secret'}
              className={`tb-chip${kind === 'secret' ? ' tb-chip--on' : ''}`} onClick={() => setKind('secret')}>Server or agent</button>
            <button type="button" role="radio" aria-checked={kind === 'publishable'}
              className={`tb-chip${kind === 'publishable' ? ' tb-chip--on' : ''}`} onClick={() => setKind('publishable')}>Website</button>
          </div>
          {kind === 'publishable' && (
            <>
              <div className="tb-field">
                <label htmlFor="apikey-origins">Websites it works on</label>
                <textarea id="apikey-origins" className="tb-input apikeys-origins" value={origins} rows={2}
                  placeholder="https://yourgame.example" onChange={(e) => setOrigins(e.target.value)} />
              </div>
              <div className="tb-field">
                <label htmlFor="apikey-perday">Heroes per day, at most</label>
                <input id="apikey-perday" className="tb-input" inputMode="numeric" value={perDay}
                  onChange={(e) => setPerDay(e.target.value.replace(/\D/g, '').slice(0, 5))} />
              </div>
            </>
          )}
          {error && <div className="tb-notice tb-notice--error" role="alert">{error}</div>}
        </div>
        <div className="tb-stack apikeys-bar">
          <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => { setError(null); setMode('list'); }}>Cancel</button>
          <button type="button" className="tb-btn tb-btn--primary tb-btn--full" disabled={!ready || busy} onClick={create}>
            {busy ? 'Making…' : 'Make key'}
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="API keys" onClose={onClose} className="apikeys-sheet">
      <div className="apikeys-body">
        <div className="tb-muted apikeys-why">Apps and agents make heroes with your credits.</div>
        <div className="tb-chip-row">
          <button type="button" className="tb-chip" onClick={() => { onClose(); openLegal('developers'); }}>
            <Icon name="code" size={18} />Developer docs
          </button>
        </div>
        {keys === null && <div className="apikeys-key apikeys-key--skeleton" />}
        {keys?.map((k) => (
          <div key={k.id} className="apikeys-key">
            <div className="apikeys-key-text">
              <div className="apikeys-key-name" dir="auto">{k.name}</div>
              <div className="apikeys-key-meta">
                <code className="apikeys-prefix">{k.prefix}…</code>
                <span>{k.kind === 'secret' ? 'Server' : 'Website'} · {ago(k.last_used_at)}</span>
              </div>
            </div>
            <NavButton icon="trash" label={`Revoke ${k.name}`} onClick={() => setRevoking(k)} />
          </div>
        ))}
      </div>
      <div className="tb-stack apikeys-bar">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--full" onClick={() => setMode('new')}>
          <Icon name="plus" />New key
        </button>
      </div>
      {revoking && (
        <Dialog label="Revoke key" onClose={() => setRevoking(null)}>
          <div className="tb-h2" dir="auto">Revoke {revoking.name}?</div>
          <div className="tb-muted">Apps using it stop working. This can't be undone.</div>
          <div className="tb-stack">
            <button type="button" className="tb-btn tb-btn--secondary tb-btn--full" onClick={() => setRevoking(null)}>Keep it</button>
            <button type="button" className="tb-btn tb-btn--danger tb-btn--full" disabled={busy} onClick={() => revoke(revoking)}><Icon name="trash" />{busy ? 'Revoking…' : 'Revoke'}</button>
          </div>
        </Dialog>
      )}
    </Sheet>
  );
}
