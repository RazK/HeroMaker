# Cleanup report (2026-11-23)

Liran · Dev. **Report only: nothing here is deleted yet.** Each item becomes
its own small PR after the PM agrees, one topic per PR, with no behaviour
change inside a cleanup PR.

How it was measured: grep for every name and path (no import, no caller, no
route, no workflow or doc reference), `knip` on the frontend, `vulture` on
the backend, `pytest --durations=30`, the frontend unit tests, `npm run
build`, and the GitHub API for workflow runs and job times. The local clone is
shallow, so "last changed" dates come from the GitHub API.

**Cost units.** The repo is public, so Actions minutes are free: CI cost is
*waiting time* per PR, not money. Image size is pull and deploy time. Lines
are time to understand.

## Never touched

These guard money or children's privacy. They are not deleted, weakened or
merged by any cleanup, even where they overlap.

- **Money, backend:** test_payments, test_class_seat_purchase, test_ledger,
  test_ledger_concurrency, test_step_refunds, test_restart_refund,
  test_clean_shutdown, test_pipeline_fail_fast, test_pipeline_wiring,
  test_meshy_queue, test_free_painting, test_result_cache, test_usage,
  test_pricing, test_reporting, test_finance_api, test_admin_step_billing,
  test_admin_users, test_admin_console, test_lemonsqueezy_check,
  test_delete_creation, test_migration_backfill, test_migration_locks.
- **Privacy, backend:** test_creation_privacy, test_delete_account,
  test_backup_expiry, test_analytics, test_adult_confirmed, test_share_card,
  test_classes, test_school_details, test_no_ghost_heroes, test_step_errors,
  test_google_auth, test_password_reset, test_cleanup_test_accounts, and the
  PII guards in test_scripts (`inspect_db_never_prints_personal_data`).
- **Frontend and robot:** `posthogCore.test.ts` (all), `i18n.test.ts` (no
  child gender), and the robot steps `buy`, `class` and `analytics`.

## Top 10 by cost

| # | Item | Cost today | Proposal |
|---|---|---|---|
| 1 | **Plaintext password in a public repo.** `backend/scripts/migrate_debug_user.py:44` and `MILESTONE_1_IMPLEMENTATION.md` hold the password of `debug@heromaker.local` | Security: anyone can read it | Check whether that account exists on staging or production. If it does, disable it or change its password (needs Raz's yes for production). Then delete both files. Deleting does not remove it from history, so the account check is the real fix. |
| 2 | **The PWA precaches 2.3 MB of images that no screen shows.** `frontend/public/logo.png` (1.86 MB) and `logo-head.png` (436 KB) and `vite.svg` match `globPatterns` in `vite.config.ts:63` | Every installed app downloads them: the precache is 4.25 MB, and these three are 54% of it | Delete `logo-head.png` and `vite.svg`. Move `logo.png` to a fixtures folder and repoint the 2 workflows that use it as a test drawing. |
| 3 | **`test_painting_cut.py` is 36% of the backend suite.** It runs the real U²-Net cut on 512 px images: 9 of the 10 slowest tests, ~45 s of 126 s | ~35 s on every backend PR (the CI job is ~2.5 min) | Smaller fixtures (128-256 px); stub the cut in the tests that only check caching or order. No assertion removed. |
| 4 | **Scripts for a deploy and sync path we no longer use.** `scripts/deploy-to-railway.sh`, `validate-railway-env.sh`, `test-railway.sh`, `sync-to-railway.sh`; `backend/scripts/sync_local_to_railway.py`, `sync_railway_to_local.py`, `sync_storage.py`; `devops/scripts/build-and-push-images.sh`, `verify-railway-services.sh` | ~1,600 lines. Several write to production, or copy data between the databases, against Raz's rules | Delete. No caller outside stale docs. |
| 5 | **One-off migration and admin scripts that are done.** `migrate_to_postgres.py`, `migrate_chatgpt_to_openai.py`, `migrate_files_to_s3.py`, `check_step_status.py`, `list_coupons.py`, `create_coupon.py`, `backend/scripts/test_auth.py` (+ its conftest ignore) | ~900 lines; also copied into the backend image | Delete. The admin API replaces the coupon scripts. |
| 6 | **Stale deploy docs that describe the old GHCR path.** `docs/deployment/railway.md` (752 lines), `docs/RAILWAY_*.md` ×4, `docs/testing/railway_testing.md`, `docs/deployment/sync_local_to_railway.md`, the deploy section of `docs/DEVOPS.md` | ~1,600 lines that contradict CLAUDE.md and cicd.md; a new agent can follow them | Delete; keep railway.md as a short pointer to cicd.md; fix the README link. |
| 7 | **hero-dash is parked and nothing uses it.** No workflow builds it, no image includes it, nothing imports it. What was worth reusing is already copied into hero-moves | 7.4 MB, 58 files, 47k lines | Tag it (`archive/hero-dash`), then delete the folder. Update games/README.md and CLAUDE.md to point at the tag. |
| 8 | **Big binaries nothing loads.** `marketing/concepts/concept-*.png` (~95 files, made again by `audit.mjs`), `games/hero-moves/public/model/` shards (the game loads `pose-model.json`; both builds `rm -rf dist/model`) | ~22.5 MB in the tree, in every clone | Delete and gitignore. Re-encode the README GIFs (`gallery_demo.gif` 24.8 MB, `kalidoface_demo.gif` 10.3 MB, `pipeline_demo.gif` 5.5 MB) to MP4/WebP. |
| 9 | **Dead code in the app.** Frontend: `RetryModal`, `DownloadButton`, two unused polling hooks, five unused `steps.ts` getters, the never-shown non-webcam half of `FileUpload` (~610 lines). Backend: Meshy remesh/retexture/animation methods and wrappers, `app/tests/` (collects nothing), unused `file_utils`, `steps.py`, `auth`, `api_keys` helpers (~550 lines) | ~1,160 lines; old-look CSS keeps the second style system alive | Delete in two PRs (frontend, backend). |
| 10 | **Backend image ships what it does not run.** `pytest` and `alembic` (no use; we have our own migration runner) in `requirements.txt`, `COPY scripts/` (workflows run scripts from the checkout), and probably `gcc`. The VRM converter ignores its own `requirements.txt` and installs unpinned packages | Image size and build time; unpinned installs can break a build without any change from us | Move pytest to a dev file, drop alembic and the scripts COPY, try without gcc in a CI image build; install the converter from its pinned requirements. |

## Everything else found

### Backend
- `test_scripts.py` (22 tests) exists for `migrate_sqlite_to_postgres.py`
  and `inspect_db.py`. The migration is done. Archive the migration script
  with its tests; keep `inspect_db` and its PII-guard tests.
- Uncalled finance routes: `GET /admin/finance/{margin, prices, packs,
  payments-config, margin.html}`. Only `/finance/ledger/{id}` has a caller.
  **Money domain: ask Gidi before touching.** Keep `ledger-consistency`.
- ~85 `datetime.utcnow()` calls make most of the 12,019 test warnings.
  Optional, separate PR.
- Overlapping tests (keep all; share fixtures only): the timeout-refund
  path is tested in 4 files, each waiting ~2 s on a real timeout. One
  short-timeout fixture saves ~5 s. `test_api_classes_admin_v1.py` (31
  lines) can fold into `test_classes.py`.
- Suite: 1,039 passed, 6 skipped (Postgres-only, run in CI), 126 s.

### Frontend and e2e
- Old-look components still reachable: `CouponRedeem`, `ProfileModal`
  (from the header menu), admin `ModelPreview`. **Migrate to Toy Box, do not
  delete.** That is design work: Maya first. After that, `styles/main.css`
  shrinks to the reset.
- Dependencies: none unused (knip and grep agree).
- Frontend unit tests: 24 tests, 1.35 s. No cost.
- The robot step called `game` actually checks the hero page and takes
  610 s of a 16-37 min run. Rename it and find the time. The robot runs only
  on manual dispatch; the flow says it should run after every staging
  deploy. That is a process fix, not cleanup: proposed separately.
- `i18n/` is imported only by its test, but it landed today and is meant
  for the share video. Keep.

### Workflows
- Done one-offs: `backfill-hero-names.yml`, `backfill-hero-names-production.yml`,
  `copy-staging-files.yml` (last ran Oct, succeeded). Delete.
- `build-images.yml` pushes every image to GHCR, but both deploys use
  `railway up` from source. The push is unused. Drop it, or drop the image
  builds that only gate the deploy.
- hero-moves is built three times on a merge that touches games. Let
  `build-frontend` reuse the `hero-moves-bundle` artifact.
- Keep: ci, env-lint, backup, promote-production, railway-config,
  staging-e2e, set-admin-staging, cleanup-test-accounts-staging,
  render-check-staging, make-style-samples-staging, pages.

### Docs
- Root `MILESTONE_1_IMPLEMENTATION.md`, `TESTING_SUMMARY.md`,
  `docs/ISSUE_6_MULTI_USER_AUTH_PLAN.md`: each marked historical, no
  inbound links. Delete (git keeps them).
- `AGENTS.md`: points at CLAUDE.md. Harmless, keep.

### Remote branches
- `railway-deployment` is still on GitHub; only the dead
  `deploy-to-railway.sh` uses it. Delete with Raz's ok.

## Totals if all of the top 10 is done

About **5,900 lines** of code, scripts and docs plus hero-dash's 47k, and
**~30 MB** out of the tree (more with the GIFs),
**~35-40 s** off every backend PR, **2.3 MB** less in every installed app,
and two deploy paths fewer for a new agent to misread.
