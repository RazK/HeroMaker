#!/usr/bin/env python3
"""Tests for product_docs_check.py. Standard library only:

    python3 devops/scripts/test_product_docs_check.py
"""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import product_docs_check as tool  # noqa: E402

REPO = HERE.parents[1]


class ProductDocsCheck(unittest.TestCase):
    def setUp(self):
        # A copy of this checkout's docs/product, and an empty app to put code in.
        self.root = Path(tempfile.mkdtemp())
        shutil.copytree(REPO / tool.PRODUCT, self.root / tool.PRODUCT)
        (self.root / "frontend/src").mkdir(parents=True)
        self.experiment = next((self.root / tool.PRODUCT / "experiments").glob("E-001-*.md"))

    def tearDown(self):
        shutil.rmtree(self.root)

    def code(self, text, name="App.tsx"):
        (self.root / "frontend/src" / name).write_text(text)

    def replace(self, path, old, new):
        text = path.read_text()
        self.assertIn(old, text)
        path.write_text(text.replace(old, new, 1))

    def test_the_repository_passes(self):
        self.assertEqual(tool.check(REPO), [])

    def test_no_flags_in_the_code_passes(self):
        self.code("export const variants: Record<string, string> = {};\n")
        self.assertEqual(tool.check(self.root), [])

    def test_a_flag_with_its_experiment_passes(self):
        self.code("variants['gallery-order'] = arm;\nposthog.getFeatureFlag(\"gallery-order\");\n")
        self.assertEqual(tool.check(self.root), [])

    def test_every_form_of_an_unknown_flag_fails(self):
        for line in (
            "variants['mystery'] = 'a';",
            "variants.mystery = 'a';",
            "experiment('mystery')",
            "posthog.isFeatureEnabled(`mystery`)",
            "useFeatureFlagVariantKey('mystery')",
        ):
            with self.subTest(line=line):
                self.code(line + "\n")
                problems = tool.check(self.root)
                self.assertEqual(len(problems), 1, problems)
                self.assertIn("'mystery' has no experiment file", problems[0])

    def test_a_flag_in_a_game_is_checked_too(self):
        game = self.root / "games/some-game/src"
        game.mkdir(parents=True)
        (game / "main.ts").write_text("variants['mystery'] = 'a'\n")
        self.assertTrue(any("mystery" in p for p in tool.check(self.root)))

    def test_test_files_and_reads_are_not_flags(self):
        self.code("variants['made-up'] = 'a';\n", name="analytics.test.ts")
        self.code("if (Object.keys(variants).length > 0 && variants.x === 'b') {}\n")
        self.assertEqual(tool.check(self.root), [])

    def test_an_experiment_naming_a_missing_hypothesis_fails(self):
        self.replace(self.experiment, "hypotheses: [H-006, H-007]", "hypotheses: [H-006, H-007, H-999]")
        problems = tool.check(self.root)
        self.assertTrue(any("H-999, which does not exist" in p for p in problems), problems)

    def test_links_must_go_both_ways(self):
        self.replace(self.experiment, "hypotheses: [H-006, H-007]", "hypotheses: [H-006, H-007, H-001]")
        problems = tool.check(self.root)
        self.assertTrue(any("must list E-001" in p for p in problems), problems)

    def test_a_wrong_priority_fails(self):
        h = next((self.root / tool.PRODUCT / "hypotheses").glob("H-002-*.md"))
        self.replace(h, "priority: 25", "priority: 24")
        problems = tool.check(self.root)
        self.assertTrue(any("not impact x uncertainty" in p for p in problems), problems)

    def test_an_unknown_status_fails(self):
        h = next((self.root / tool.PRODUCT / "hypotheses").glob("H-002-*.md"))
        self.replace(h, "status: untested", "status: probably")
        self.assertTrue(any("status 'probably'" in p for p in tool.check(self.root)))

    def test_a_hypothesis_missing_from_the_index_fails(self):
        index = self.root / tool.PRODUCT / "HYPOTHESES.md"
        index.write_text(index.read_text().replace("H-037", "H-0xx"))
        self.assertTrue(any("H-037 is not in the index" in p for p in tool.check(self.root)))

    def test_two_experiments_cannot_share_a_flag_key(self):
        other = next((self.root / tool.PRODUCT / "experiments").glob("E-003-*.md"))
        self.replace(other, "flag_key: first-pack", "flag_key: gallery-order")
        self.assertTrue(any("is also E-001's" in p for p in tool.check(self.root)))


if __name__ == "__main__":
    unittest.main(verbosity=1)
