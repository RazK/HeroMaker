import { useEffect, useState } from 'react';
import { api, ApiEstimates, getAuthToken } from '../../api/client';
import { Icon } from './Icon';
import { LegalScreen } from './Legal';
import './Developers.css';

/** Something to copy as it is: code in a box with a Copy button. */
function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* selectable */ }
  };
  return (
    <div className="dev-code">
      <pre><code>{children}</code></pre>
      <button type="button" className="tb-chip dev-code-copy" onClick={copy} aria-label="Copy">
        <Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const minutes = (s?: number) => (s ? (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`) : '…');

const STAGES: Array<[string, string, string]> = [
  ['cleanup', 'processed.jpg', 'The drawing, straightened and cleaned'],
  ['painting', 'rendered.png', 'Painted as a character'],
  ['model', 'model.glb', 'Sculpted in 3D'],
  ['rig', 'rigged.glb', 'With a skeleton (and walking.glb)'],
  ['avatar', 'avatar.vrm', 'The VRM humanoid: use avatar_optimized'],
];

/**
 * /developers: the public API for people (agents read /llms.txt). A docs
 * page, so like the legal pages it may be running text; every action is a
 * chip or a button, code is in boxes with Copy.
 */
export function Developers({ onBack }: { onBack: () => void }) {
  const base = window.location.origin;
  const [est, setEst] = useState<ApiEstimates | null>(null);
  useEffect(() => { api.getApiEstimates().then(setEst, () => {}); }, []);
  const stage = (k: string) => est?.stages.find((s) => s.stage === k);
  const signedIn = !!getAuthToken();

  const curl = `curl -X POST ${base}/api/v1/heroes \\
  -H "Authorization: Bearer $HEROMAKER_KEY" \\
  -F drawing=@drawing.jpg -F name="Captain Crayon"`;
  const poll = `curl ${base}/api/v1/heroes/<id> \\
  -H "Authorization: Bearer $HEROMAKER_KEY"`;
  const browser = `// In a web page: a Website key, which works only on your site.
const KEY = 'hm_pk_...';
const API = '${base}/api/v1';

async function makeHero(file, onProgress) {
  const form = new FormData();
  form.append('drawing', file);
  let hero = await fetch(API + '/heroes', {
    method: 'POST', headers: { Authorization: 'Bearer ' + KEY }, body: form,
  }).then((r) => r.json());
  while (hero.status === 'queued' || hero.status === 'processing') {
    onProgress?.(hero);  // hero.stage, hero.progress, hero.eta.seconds_left, hero.files
    await new Promise((r) => setTimeout(r, 4000));
    hero = await fetch(API + '/heroes/' + hero.id, {
      headers: { Authorization: 'Bearer ' + KEY },
    }).then((r) => r.json());
  }
  if (hero.status !== 'completed') throw new Error(hero.error?.message);
  return hero.files.avatar_optimized;  // a VRM URL for @pixiv/three-vrm
}`;
  const verify = `// Node: check a webhook really came from HeroMaker.
import crypto from 'node:crypto';
const ts = req.headers['x-heromaker-timestamp'];
const mac = crypto.createHmac('sha256', process.env.HEROMAKER_WEBHOOK_SECRET)
  .update(ts + '.' + rawBody).digest('hex');
const ok = req.headers['x-heromaker-signature'] === 'sha256=' + mac;`;
  const mcp = `{
  "mcpServers": {
    "heromaker": {
      "type": "http",
      "url": "${base}/api/mcp",
      "headers": { "Authorization": "Bearer hm_sk_..." }
    }
  }
}`;

  return (
    <LegalScreen title="Developers" heading="HeroMaker API" onBack={onBack}>
      <p>Send a drawing. Get back a rigged 3D avatar (VRM), with every stage on the way.</p>

      <div className="dev-facts">
        <div className="dev-fact"><span className="dev-fact-num">{minutes(est?.total.typical_seconds)}</span><span>typical</span></div>
        <div className="dev-fact"><span className="dev-fact-num">{minutes(est?.total.p90_seconds)}</span><span>9 in 10 under</span></div>
        <div className="dev-fact"><span className="dev-fact-num">{est?.cost_credits ?? 10}</span><span>credits a hero</span></div>
      </div>

      <h2>1. Get a key</h2>
      <p>Account menu, then API keys. A <b>Server</b> key is for your server or an AI agent: keep it secret. A <b>Website</b> key is safe in a web page: it works only on the sites you list, up to a number of heroes a day. Heroes are paid from your credits; a stage that fails is refunded.</p>
      {!signedIn && <p className="dev-note">Sign in to make a key.</p>}

      <h2>2. Make a hero</h2>
      <Code>{curl}</Code>
      <p>Or send JSON with <code>image_url</code> or <code>image_base64</code>. The answer comes at once: the hero's <code>id</code>, its cost and when it should be ready. Add <code>webhook_url</code> to be called as each stage finishes, and <code>client_ref</code> for your own id.</p>

      <h2>3. Follow it</h2>
      <Code>{poll}</Code>
      <p>Every 3 to 5 seconds, until <code>status</code> is <code>completed</code> or <code>failed</code>. Each answer has the <code>stage</code> being made, <code>progress</code> (%), <code>eta.seconds_left</code>, and the file of every stage already done:</p>
      <div className="dev-table" role="table" aria-label="Stages">
        {STAGES.map(([key, file, what]) => (
          <div className="dev-row" role="row" key={key}>
            <span className="dev-stage" role="cell">{key}</span>
            <span className="dev-what" role="cell">{what}<br /><code>{file}</code></span>
            <span className="dev-time" role="cell">{minutes(stage(key)?.typical_seconds)}</span>
          </div>
        ))}
      </div>
      <p className="dev-note">Times are medians of the latest real heroes, updated as they finish.</p>

      <h2>In a web page</h2>
      <Code>{browser}</Code>
      <p>Avatars are VRM 0.x humanoids, 22 bones, no fingers or blendshapes: they load in three.js with @pixiv/three-vrm and play any humanoid animation.</p>

      <h2>Webhooks</h2>
      <p>With <code>webhook_url</code> we POST <code>{'{type, stage, hero}'}</code> as each stage finishes and at the end, signed with your key's webhook secret:</p>
      <Code>{verify}</Code>

      <h2>For AI agents</h2>
      <p>HeroMaker is an MCP server. Add it to Claude, Cursor or any MCP client with a Server key:</p>
      <Code>{mcp}</Code>
      <div className="tb-chip-row dev-links">
        <a className="tb-chip" href="/llms.txt"><Icon name="code" size={16} />llms.txt</a>
        <a className="tb-chip" href="/api/v1/openapi.json"><Icon name="code" size={16} />OpenAPI</a>
      </div>

      <h2>When something goes wrong</h2>
      <ul>
        <li><b>400</b>: not a picture, or a URL we won't fetch (https and public only, 15 MB).</li>
        <li><b>401</b>: no key, or a revoked one. <b>403</b>: a Website key used on another site.</li>
        <li><b>402</b>: not enough credits for a whole hero. Nothing was made or charged.</li>
        <li><b>429</b>: a Website key's heroes for the day are used up. See Retry-After.</li>
        <li>A failed stage: <code>error.message</code> says why; its credits come back.</li>
      </ul>
    </LegalScreen>
  );
}
