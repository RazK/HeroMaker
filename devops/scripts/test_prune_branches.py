#!/usr/bin/env python3
"""Tests for prune_branches.decide: what is kept, deleted and archived."""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from prune_branches import PR, Branch, decide  # noqa: E402

NOW = datetime(2026, 11, 24, tzinfo=timezone.utc)


def br(name, sha="a1", age_days=30):
    return Branch(name, sha, NOW - timedelta(days=age_days))


class Decide(unittest.TestCase):
    def test_main_staging_and_archive_are_never_touched(self):
        for n in ("main", "staging", "archive/hero-dash"):
            self.assertEqual(decide(br(n, age_days=400), [], NOW), "keep")

    def test_a_branch_with_an_open_pr_is_kept_however_old(self):
        self.assertEqual(decide(br("feat/x", age_days=90), [PR("feat/x", "a1", "open", False)], NOW), "keep")

    def test_merged_at_its_tip_is_deleted_even_when_fresh(self):
        self.assertEqual(decide(br("feat/x", age_days=0), [PR("feat/x", "a1", "closed", True)], NOW), "delete")

    def test_commits_after_the_merge_are_kept_while_fresh(self):
        b = br("nir/toy", sha="b2", age_days=1)
        self.assertEqual(decide(b, [PR("nir/toy", "a1", "closed", True)], NOW), "keep")

    def test_commits_after_the_merge_are_archived_once_stale(self):
        b = br("nir/toy", sha="b2", age_days=20)
        self.assertEqual(decide(b, [PR("nir/toy", "a1", "closed", True)], NOW), "archive")

    def test_a_closed_unmerged_pr_is_archived_once_stale_not_before(self):
        prs = [PR("try/y", "a1", "closed", False)]
        self.assertEqual(decide(br("try/y", age_days=3), prs, NOW), "keep")
        self.assertEqual(decide(br("try/y", age_days=14), prs, NOW), "archive")

    def test_no_pr_and_stale_is_archived_no_pr_and_fresh_is_kept(self):
        self.assertEqual(decide(br("design/camera", age_days=2), [], NOW), "keep")
        self.assertEqual(decide(br("render-check-results/1", age_days=37), [], NOW), "archive")


if __name__ == "__main__":
    unittest.main()
