"""
Collection rules for the backend, applied however pytest is invoked.

`backend/pytest.ini` sets `testpaths`, but pytest only honours that when it
finds the ini file - which it does when run from `backend/`, and does NOT when
run from the repository root (there is no ini file there, so pytest falls back
to scanning everything). This conftest makes the important exclusion hold in
both cases.

`backend/scripts/` contains operational scripts, one of which is named
`test_auth.py`. It matches pytest's `test_*.py` pattern but is not a pytest
suite: it drives a LIVE API on localhost:8000 and fails with connection errors
when no server is running. It has always been there; excluding it here simply
stops it breaking `python -m pytest` from the repository root.
"""
collect_ignore = ["scripts"]
