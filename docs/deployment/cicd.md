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

## Why not a `staging` branch

A long-lived `staging` branch that merges into `main` was considered and
rejected:

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

### Known issue: the staging deploy cannot reach its environment

`deploy-staging` currently fails with `Environment "staging" not found`, and
did the same when given the environment ID. The deploy job prints a preflight
(`railway whoami` / `railway status`) so each run records what the token can
actually reach.

The likely cause is that `RAILWAY_TOKEN` is a Railway **project token**, which
Railway scopes to one environment. A project token issued for production
cannot see staging under any name, which fits the evidence: the old workflows
deployed fine for months *without* `--environment`, because the token already
implied production.

If that is it, the fix is a second token:

1. Railway → project → Settings → Tokens → create a token scoped to **staging**
2. GitHub → Settings → Secrets → add it as `RAILWAY_STAGING_TOKEN`
3. Point `deploy-staging` at that secret; `promote-production` keeps using
   `RAILWAY_TOKEN`

Production deploys are unaffected throughout — they use the existing token.

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
