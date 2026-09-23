# Railway environment variables

Every variable is declared **once**. Staging and production read the same
files; the few things that genuinely differ are resolved by Railway at deploy
time rather than written down twice.

## Where a variable goes

| If the value is… | Put it in | Written |
|---|---|---|
| the same for every service, in both environments | `common.env` | once |
| the same in both environments, one service | `<service>.env` | once |
| a secret | a Railway **shared variable**, referenced as `${{shared.KEY}}` from `<service>.env` | once per environment, in Railway |
| derived from another service (its URL, its database) | a Railway **reference** in `<service>.env` | once |
| structurally different and not expressible as a reference | `<service>.<environment>.env` | twice — last resort |

Layers, lowest precedence first. A later layer overrides an earlier one:

```
common.env                    every service, every environment
common.<environment>.env      every service, one environment
<service>.env                 one service, every environment
<service>.<environment>.env   one service, one environment
secrets.env                   gitignored, never committed
secrets.<environment>.env     gitignored, never committed
```

`KEY=` with an empty value stops a key inherited from a lower layer being
pushed (Railway rejects empty values anyway). It does **not** delete a variable
Railway already holds — `diff` reports those as `! KEY set on Railway but in no
layer file`, and they have to be unset in the dashboard.

## Railway references do the per-environment work

These are stored literally and resolved by Railway inside whichever
environment is deploying, which is what lets one committed line mean two
different things:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}                  # this environment's database
OPENAI_API_KEY=${{shared.OPENAI_API_KEY}}                # this environment's shared variable
ALLOWED_ORIGINS=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}  # this environment's frontend
VITE_API_BASE_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}} # this environment's backend
```

The names inside `${{...}}` are **Railway service names** as the dashboard
shows them (`backend`, `frontend`, `vrm-converter`, `Postgres`). Rename a
service in Railway and these must be updated to match.

## Secrets

No secret value is ever committed. Two supported homes:

1. **Railway shared variables** (preferred) — Project → Settings → Shared
   Variables, set per environment, referenced as `${{shared.KEY}}`. One place
   per environment, every service inherits it.
2. **`secrets.env` / `secrets.<environment>.env`** — gitignored, local only,
   for when you need to push a value from your machine.

`railway-env.sh check` fails if a tracked file ever holds a literal credential
— either a secret-looking key name, or any value carrying an embedded password
such as `postgresql://user:pass@host/db` — and runs in CI on every pull
request.

## Commands

```bash
./devops/scripts/railway-env.sh check                    # lint the layers
./devops/scripts/railway-env.sh resolve -e staging       # what a service would get
./devops/scripts/railway-env.sh diff    -e production    # layers vs. what Railway has
./devops/scripts/railway-env.sh sync    -e staging       # push (batched, one call/service)
./devops/scripts/railway-env.sh sync    -e production -s backend -n   # dry run, one service
./devops/scripts/railway-env.sh factor                   # import live vars, show the dedup
```

`sync` reads the current state first and pushes only when something actually
differs, in a single `railway variables` call per service so a sync costs one
redeploy rather than one per variable. Add `--skip-deploys` to stage without
redeploying.

## First-time migration

The committed files describe the *intended* layout. To reconcile them with
what the two Railway environments hold today:

```bash
./devops/scripts/railway-env.sh factor            # report only, writes nothing
./devops/scripts/railway-env.sh factor --write    # rewrite the layers from live values
git diff                                          # review before committing
```

`factor` reads staging and production, puts everything identical into the
shared layer, leaves only real differences in the per-environment files, and
turns every secret into a `${{shared.KEY}}` reference without ever writing its
value to a tracked file. A key a layer file already declares as a reference
keeps that reference, so `${{Postgres.DATABASE_URL}}` is not overwritten with
the connection string Railway resolved it to.

Run it for the **whole project**. With `-s` it has only seen one service, so it
leaves `common.env` untouched rather than rewriting it from partial
information.

Then check the result against reality before touching anything:

```bash
./devops/scripts/railway-env.sh diff -e staging
./devops/scripts/railway-env.sh diff -e production
```

## Service and environment IDs

`devops/railway/project.json` holds the services and environments.

The tooling passes the **service ID** to `--service`, so renaming a service in
the dashboard cannot silently retarget a sync. It passes the **environment
name** to `--environment`, because the Railway CLI resolves environments by
name only and rejects an ID (`Environment "<id>" not found`). Rename an
environment in Railway and you must update its `name` in `project.json`.
