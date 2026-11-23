"""
Collection rules for the backend, applied however pytest is invoked.

`backend/pytest.ini` sets `testpaths`, but pytest only honours that when it
finds the ini file - which it does when run from `backend/`, and does NOT when
run from the repository root (there is no ini file there, so pytest falls back
to scanning everything). This conftest makes the important exclusion hold in
both cases.

`backend/scripts/` holds operational scripts, not tests. A script there named
`test_*.py` would match pytest's pattern (one, a live-API check, did until
2026-11-23), so the folder is never collected.
"""
collect_ignore = ["scripts"]
