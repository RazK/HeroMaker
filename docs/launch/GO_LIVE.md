# Go live: Grow takes real money on production

One pass, in this order. **Every step that writes to production needs Raz's
explicit "yes" in chat, given for that step.** Nothing here is run in a
rehearsal except the steps marked *read-only*. Owner: Gidi.

IDs (project, services, environments) come from `devops/railway/project.json`
and nowhere else. `<prod-env>`, `<backend>` below mean the ids in that file.

## 0. Before the day: every line must be green

| Check | Where |
|---|---|
| Grow account active; Grow issued **live** `userId`, `pageCode` (and API key if any) | Raz |
| Grow answered: how a notify is authenticated; POSTs to `notifyUrl` exactly as given; content type (READINESS G1) | Raz → Gidi |
| One payment through **Grow's own sandbox** green on staging (READINESS G3) | Gidi, robot |
| The old `?t=` notify route removed (READINESS G5) | Gidi, PR |
| Staging robot green on the SHA to promote | `staging-e2e.yml` |
| Meshy and OpenAI topped up (a paid hero must finish) | Raz, Admin → Money |
| Raz said **yes** to: promote, production variables, one real ₪10 | chat |

## 1. Read where production is (*read-only*)

```bash
devops/scripts/golive-check.sh https://heromaker.up.railway.app production
```

Today it fails on purpose: production runs v2.0.85 and lists no packs. Write
down the running version and its **deployment id** (Railway MCP
`list-deployments`, production, backend). That id is the rollback target.

## 2. Production variables, with `skipDeploys` (Raz's yes)

A variable change on Railway **redeploys the service from the latest commit
on its branch**, which is unreleased `main`. That is how production once got
half-promoted (READINESS, "the Railway trap"). So the variables go in first,
**without a deploy**, and the promote in step 3 picks them up.

1. Raz (or Gidi with his yes) sets the secrets as production **shared**
   variables in the Railway dashboard: `GROW_USER_ID`, `GROW_PAGE_CODE`,
   `GROW_API_KEY` (if Grow issued one), `GROW_NOTIFY_SECRET` (a new random
   64-hex, never the staging one). No value is ever pasted in chat.
2. A PR adds to `devops/railway/env/backend.production.env`:
   ```
   PAYMENTS_PROVIDER=grow
   GROW_API_BASE=https://secure.meshulam.co.il
   GROW_USER_ID=${{shared.GROW_USER_ID}}
   GROW_PAGE_CODE=${{shared.GROW_PAGE_CODE}}
   GROW_API_KEY=${{shared.GROW_API_KEY}}
   GROW_NOTIFY_SECRET=${{shared.GROW_NOTIFY_SECRET}}
   ```
   and moves those keys out of `STAGING_ONLY` in
   `devops/scripts/test_railway_env.py`. `GROW_STANDIN_ENABLED` is never
   set on production (the stand-in refuses production anyway).
3. Push them without deploying:
   ```bash
   ./devops/scripts/railway-env.sh diff -e production          # read: shows exactly the lines above
   ./devops/scripts/railway-env.sh sync -e production --skip-deploys
   ```
4. Confirm nothing deployed: `list-deployments` for production backend shows
   the same deployment id as step 1. Production keeps running v2.0.85, which
   predates the provider switch, ignores every `PAYMENTS_PROVIDER`/`GROW_*`
   variable and still sells nothing (its Lemon Squeezy keys are emptied).
   Safe to sit like this.

If anything did redeploy: redeploy the step-1 deployment **by id** (Railway
MCP `redeploy` with `deploymentId`), then re-run step 1.

## 3. Promote staging to production (Raz's yes)

```bash
gh api -X POST repos/RazK/HeroMaker/actions/workflows/promote-production.yml/dispatches \
  -f ref=main -f 'inputs[ref]=<staging sha>' -f 'inputs[reason]=Grow go-live'
```

Approve in the `production` environment, wait for green. The new deployment
starts with the step-2 variables already in place.

## 4. Verify production (*read-only*)

```bash
devops/scripts/golive-check.sh https://heromaker.up.railway.app production <staging short sha>
```

All must PASS: right version; One hero ₪10 and Family ₪39 on sale; the Grow
notify answers 401 to an unproven call; sandbox, stand-in 404; Lemon Squeezy
401; no STAGING look. Then by hand: sign in, gallery, packs, no STAGING tag
(CLAUDE.md, "Releasing").

## 5. The first real ₪10 (Raz's card, Raz's yes)

1. Raz signs in on production, Buy credits → One hero ₪10. The page must be
   Grow's (`secure.meshulam.co.il`), not a TEST page.
2. Pays with his own card.
3. Back on the site within seconds: balance +1 hero, one receipt "₪10".
4. Gidi checks the order: `checkout_orders` row `paid`, `grow_approved` true,
   `grow_asmachta` set; backend log "Credited ... transaction ...".
5. Raz makes one hero with it to the end (proves Meshy and OpenAI keys).
6. Refund in Grow's dashboard (Raz). We do **not** take the credits back
   automatically: Grow sends no refund event we know of. Gidi removes them by
   hand (Admin → user → Credits) and notes both in the books.

## 6. If anything is wrong: rollback

Pick the smallest that fixes it.

| Problem | Do |
|---|---|
| Payments misbehave, the site is fine | **Stop selling:** set `PAYMENTS_PROVIDER=off` (any unknown value sells nothing) with `--skip-deploys`, then redeploy the **running** deployment by id. Packs disappear, checkouts answer 503, notifies 404. Orders already paid stay paid. |
| The promoted release is broken | Promote the previous production SHA the same way (step 3 with the step-1 SHA), or redeploy the step-1 deployment by id. |
| Credits granted wrongly | Admin → user → Credits; the ledger keeps both rows. |

After any rollback: `golive-check.sh` again, and tell Raz the version that is
live now.

## Rehearsal

Run on staging, read-only, every time this runbook changes:

1. `golive-check.sh <staging> staging`: all PASS.
2. `golive-check.sh <production> production`: fails exactly on "packs" and
   "Grow notify", the two things go-live turns on.
3. The staging robot: buy and class steps on the real Grow code path.
4. `railway-env.sh diff -e staging`: clean (needs the Railway CLI token).

Last rehearsal: 2026-11-26, staging v2.0.263 · 7672837 (all PASS);
production v2.0.85 · b0fc00f (2 expected FAILs); robot landing, signup, buy green
on the real Grow code path (Grow stand-in).
