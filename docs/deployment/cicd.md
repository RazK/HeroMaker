# CI/CD protocol

One branch. Two environments. Production is never reached by accident.

```
  PR  ──CI──▶  main  ──auto──▶  STAGING  ──approval──▶  PRODUCTION
                 │                                          ▲
                 └──────── any SHA on main ─────────────────┘
                            (promote, or roll back)
```

| Event | What happens |
|---|---|
| PR opened | builds + lints run; **nothing deploys** |
| merged to `main` | all three services deploy to **staging**, automatically |
| you're happy with staging | run **Promote to production**, approve it, production deploys |
| production is broken | promote the previous good SHA — rollback is the same button |

`main` is always exactly what staging runs. Production is whatever was last
promoted, and GitHub records each promotion as a deployment on that commit, so
"what is in production?" is answerable without asking anyone.

## Two unrelated things are called "staging"

| "staging" | What it is | Governed by |
|---|---|---|
| the Railway **environment** | where `main` deploys before production | this document |
| the `staging` **git branch** | a publishing branch for the Hero Moves game on GitHub Pages | `.github/workflows/pages.yml` |

They are unrelated. The branch does not feed the Railway environment, and
nothing in this document deploys from it. The section below is about the
*branching model for the product deploy* — it is not an argument against the
branch that exists for Pages.

## Why the product deploy does not use a release branch

A long-lived `staging` branch that merges into `main` was considered and
rejected **for the Railway deploy**:

- **No selective promotion.** If feature A is in staging and you're unsure
  about it, feature B merged after it cannot reach production without dragging
  A along.
- **Hotfixes break the model.** An urgent production fix either crawls through
  staging or goes straight to main — and then the two branches have diverged
  and need back-merging forever.
- **Every change merges twice**, and before long nobody can say which branch is
  ahead.

Staging the *deployment* instead of the *branch* gives the same control with
none of that.

(The Pages branch is a different shape of problem — it publishes one static
game to one origin, with no environment to promote between — so none of the
above applies to it.)

## One-time setup

The approval gate lives in a GitHub Environment, which has to be created once
in the repository settings. Until it exists, the promote workflow runs
**without** asking anyone.

1. **Settings → Environments → New environment** → name it `production`
2. Tick **Required reviewers** and add yourself
3. Optionally set **Deployment branches and tags** to `main` only

Create a second environment named `staging` the same way, with no reviewers —
it exists so staging deploys are recorded too.

> The `RAILWAY_TOKEN` secret stays at the repository level; both environments
> use the same Railway project and the token is scoped to it.

## Promoting

**Actions → Promote to production → Run workflow.**

- `ref` — the commit to promote. Defaults to `main`, which is almost always
  what you want. Any SHA works, which is how rollback happens.
- `reason` — optional, recorded in the run summary so the deployment history
  says *why* and not only *what*.

The workflow refuses to promote a commit that is not an ancestor of `main`, so
an unmerged branch cannot be shipped to production even by hand.

## Rolling back

Promote the previous known-good SHA. There is no separate rollback path to get
wrong:

```bash
git log --oneline main      # find the commit that was fine
# Actions → Promote to production → Run workflow → paste that SHA
```

## Where the IDs live

`devops/railway/project.json` holds the three services and the two
environments. `.github/workflows/railway-config.yml` is a reusable workflow
that reads them and hands them to whatever needs them — they are not pasted
into individual workflows any more.

**Services are addressed by ID, environments by name.** That asymmetry is not a
style choice: the Railway CLI resolves `--service` by ID, but resolves
`--environment` by name only and rejects an ID outright —

```
Environment "e0d14c8f-54d8-4eb9-a510-b43bf81f57d1" not found.
Run `railway environment` to connect to an environment.
```

So a service can be renamed in the dashboard without breaking CI, but an
environment cannot: rename one and you must update its `name` in
`project.json`. The environment IDs are kept there for reference only. Confirm
the exact names with:

```bash
railway environment
```

### One token per environment

`RAILWAY_TOKEN` is a Railway **project token scoped to production**. CI proved
it: in the same run, `railway whoami` returns

```
Unauthorized. Please check that your RAILWAY_TOKEN is valid…
```

(project tokens have no user, so `whoami` fails while project calls succeed)
while `railway status` reports

```
Project:         hero-maker
Environment:     production
Environment ID:  <production's ID, as recorded in project.json>
```

A token scoped to one environment cannot deploy to another **under any name**,
which is why two attempts at `--environment` — first the ID, then the name —
both failed with "not found". The value was never the problem. It also explains
why the old workflows deployed happily for months without `--environment` at
all: the token already implied production.

So each environment needs its own token:

| Environment | Secret | Used by |
|---|---|---|
| production | `RAILWAY_TOKEN` | `promote-production.yml`, `backup.yml` |
| staging | `RAILWAY_STAGING_TOKEN` | `deploy-staging` in `build-images.yml` |

**Staging deploys stay red until `RAILWAY_STAGING_TOKEN` exists.** To create it:

1. Railway → `hero-maker` → Settings → Tokens → new token scoped to the
   **staging** environment
2. GitHub → repo Settings → Secrets and variables → Actions → add
   `RAILWAY_STAGING_TOKEN`

The job fails with that instruction rather than Railway's "Environment not
found", so nobody has to rediscover this.

Production is unaffected throughout: it uses the token it always used.

### The environment IDs in `project.json` were wrong

Neither ID originally recorded for the two environments appears anywhere in
the `hero-maker` project — the preflight above read production's real one
straight out of `railway status`, and it was not the recorded value. Both have
since been re-derived from the dashboard.

They are not repeated here, or anywhere else in the tree: `railway-env.sh
check` fails on a second copy of any Railway ID, because a copy cannot
disagree with the original and so can never catch an error — which is exactly
how both IDs stayed wrong for weeks with every copy agreeing with them.
`devops/railway/project.json` is the one place to read and the one place to
fix.

Environment variables are separate and documented in
[`devops/railway/env/README.md`](../../devops/railway/env/README.md). They are
**not** synced by CI: pushing variables stays a deliberate, manual act.

```bash
./devops/scripts/railway-env.sh diff -e staging
./devops/scripts/railway-env.sh sync -e staging
```

## Workflows

| File | Trigger | Does |
|---|---|---|
| `build-images.yml` | PR, push to main, tags | builds/pushes images; on main, deploys to staging |
| `promote-production.yml` | manual | the gated path to production |
| `railway-config.yml` | called by the others | resolves service/environment IDs |
| `backup.yml` | daily 02:00 UTC | backs up the **production** database |
| `env-lint.yml` | changes under `devops/railway/` | lints the env layers |
