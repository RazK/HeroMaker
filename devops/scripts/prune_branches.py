#!/usr/bin/env python3
"""Keep the branch list short: delete what is done, archive what is dead.

Run by .github/workflows/prune-branches.yml (weekly, or by hand). Rules:

- A branch whose PR was MERGED, and whose tip is still the commit that
  merged, is deleted. The merged PR keeps the code.
- A branch with no open PR and no commit for STALE_DAYS is archived: tagged
  `archived/<name>` at its tip, then deleted. Nothing is lost; restore with
  `git push origin archived/<name>:refs/heads/<name>`.
- Never touched: main, staging, archive/*, a branch with an open PR, and
  anything with a commit in the last STALE_DAYS that has not merged at its tip
  (a branch that kept moving after its merge is someone's work).

Dry run by default; `--apply` acts. Uses the `gh` CLI with GITHUB_TOKEN.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

STALE_DAYS = 14
KEEP_EXACT = {"main", "staging"}
KEEP_PREFIXES = ("archive/",)


@dataclass
class Branch:
    name: str
    sha: str
    committed: datetime


@dataclass
class PR:
    head: str
    head_sha: str
    state: str  # open | closed
    merged: bool


def decide(branch: Branch, prs: list[PR], now: datetime, stale_days: int = STALE_DAYS) -> str:
    """'keep', 'delete' (merged at its tip) or 'archive' (dead: tag, then delete)."""
    if branch.name in KEEP_EXACT or branch.name.startswith(KEEP_PREFIXES):
        return "keep"
    mine = [p for p in prs if p.head == branch.name]
    if any(p.state == "open" for p in mine):
        return "keep"
    if any(p.merged and p.head_sha == branch.sha for p in mine):
        return "delete"
    if now - branch.committed >= timedelta(days=stale_days):
        return "archive"
    return "keep"


def gh(*args: str) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def load(repo: str) -> tuple[list[Branch], list[PR]]:
    raw = gh("api", "--paginate", f"repos/{repo}/branches?per_page=100", "--jq", ".[] | [.name, .commit.sha] | @tsv")
    branches = []
    for line in raw.splitlines():
        name, sha = line.split("\t")
        date = gh("api", f"repos/{repo}/commits/{sha}", "--jq", ".commit.committer.date").strip()
        branches.append(Branch(name, sha, datetime.fromisoformat(date.replace("Z", "+00:00"))))
    raw = gh("api", "--paginate", f"repos/{repo}/pulls?state=all&per_page=100",
             "--jq", ".[] | {head: .head.ref, head_sha: .head.sha, state: .state, merged: (.merged_at != null)}")
    prs = [PR(**json.loads(line)) for line in raw.splitlines()]
    return branches, prs


def archive_tag(repo: str, name: str, sha: str) -> None:
    """Tag the tip as archived/<name>; if that tag exists (a reused name), add the short sha."""
    for tag in (f"archived/{name}", f"archived/{name}-{sha[:7]}"):
        try:
            gh("api", "-X", "POST", f"repos/{repo}/git/refs", "-f", f"ref=refs/tags/{tag}", "-f", f"sha={sha}")
            return
        except subprocess.CalledProcessError:
            continue
    raise RuntimeError(f"could not archive {name}; branch left in place")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    branches, prs = load(a.repo)
    now = datetime.now(timezone.utc)
    plan = {b.name: (decide(b, prs, now), b) for b in branches}
    for action in ("delete", "archive"):
        names = sorted(n for n, (d, _) in plan.items() if d == action)
        print(f"{action}: {len(names)}")
        for n in names:
            print(f"  {n}")
    print(f"keep: {sum(1 for d, _ in plan.values() if d == 'keep')}")
    if not a.apply:
        print("dry run: nothing changed (run with apply ticked)")
        return 0
    for name, (action, b) in sorted(plan.items()):
        if action == "archive":
            archive_tag(a.repo, name, b.sha)
        if action in ("archive", "delete"):
            gh("api", "-X", "DELETE", f"repos/{a.repo}/git/refs/heads/{name}")
    print("applied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
