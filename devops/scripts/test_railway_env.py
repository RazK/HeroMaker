#!/usr/bin/env python3
"""Tests for railway_env.py.

Run:  .venv/bin/python devops/scripts/test_railway_env.py
      (or python3 — the tool and these tests are stdlib-only)

The Railway CLI is replaced by a stub on PATH, so nothing here touches a real
Railway project.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import railway_env as tool  # noqa: E402


STUB = r'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
state = os.environ["RAILWAY_STUB_DIR"]
if args and args[0] == "status":
    sys.exit(0)
if args and args[0] == "variables":
    service = args[args.index("--service") + 1]
    environment = args[args.index("--environment") + 1]
    if "--json" in args:
        path = os.path.join(state, f"{service}.{environment}.json")
        print(json.dumps(json.load(open(path)) if os.path.exists(path) else {}))
        sys.exit(0)
    sets = [args[i + 1] for i, a in enumerate(args) if a == "--set"]
    with open(os.path.join(state, "applied.log"), "a") as fh:
        fh.write(json.dumps({
            "service": service,
            "environment": environment,
            "sets": sets,
            "skip_deploys": "--skip-deploys" in args,
        }) + "\n")
    sys.exit(0)
sys.exit(2)
'''


class StubbedRailway:
    """Put a fake `railway` on PATH and feed it canned variable payloads."""

    def __init__(self, payloads=None):
        self.payloads = payloads or {}

    def __enter__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        bin_dir = self.dir / "bin"
        bin_dir.mkdir()
        stub = bin_dir / "railway"
        stub.write_text(STUB)
        stub.chmod(0o755)
        for (service, environment), values in self.payloads.items():
            (self.dir / f"{service}.{environment}.json").write_text(json.dumps(values))
        self._old_path = os.environ["PATH"]
        os.environ["PATH"] = f"{bin_dir}{os.pathsep}{self._old_path}"
        os.environ["RAILWAY_STUB_DIR"] = str(self.dir)
        return self

    def __exit__(self, *exc):
        os.environ["PATH"] = self._old_path
        os.environ.pop("RAILWAY_STUB_DIR", None)
        self.tmp.cleanup()
        return False

    def applied(self):
        log = self.dir / "applied.log"
        if not log.exists():
            return []
        return [json.loads(line) for line in log.read_text().splitlines()]


def run(argv):
    """Run the tool's main() and capture stdout."""
    import io
    import contextlib

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        code = tool.main(argv)
    return code, buf.getvalue()


class ParsingTests(unittest.TestCase):
    def parse(self, text):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as fh:
            fh.write(text)
            path = Path(fh.name)
        try:
            return tool.parse_env_file(path)
        finally:
            path.unlink()

    def test_comments_and_blanks_ignored(self):
        self.assertEqual(self.parse("# note\n\nA=1\n"), [("A", "1")])

    def test_export_prefix_and_quotes(self):
        self.assertEqual(self.parse('export A="x y"\nB=\'z\'\n'), [("A", "x y"), ("B", "z")])

    def test_value_keeps_equals_and_hash(self):
        # A '#' inside a value is part of the value: secrets and URLs have them.
        self.assertEqual(self.parse("A=a=b#c\n"), [("A", "a=b#c")])

    def test_reference_value_survives_intact(self):
        self.assertEqual(
            self.parse("A=${{shared.X}}\n"), [("A", "${{shared.X}}")]
        )

    def test_duplicate_key_in_one_file_is_an_error(self):
        with self.assertRaises(tool.ToolError):
            self.parse("A=1\nA=2\n")

    def test_invalid_name_is_an_error(self):
        with self.assertRaises(tool.ToolError):
            self.parse("not-a-key=1\n")

    def test_missing_equals_is_an_error(self):
        with self.assertRaises(tool.ToolError):
            self.parse("JUST_A_WORD\n")


class LayeringTests(unittest.TestCase):
    def test_staging_and_production_resolve_identically(self):
        # The point of the layout: no per-environment copies to drift apart.
        for service in tool.service_names(tool.load_project()):
            staging, _ = tool.resolve(service, "staging", include_secrets=False)
            production, _ = tool.resolve(service, "production", include_secrets=False)
            self.assertEqual(staging, production, f"{service} differs between environments")

    def test_backend_gets_common_and_service_layers(self):
        variables, origin = tool.resolve("backend", "production", include_secrets=False)
        self.assertEqual(origin["DEBUG"], "common.env")
        self.assertEqual(origin["OPENAI_API_KEY"], "backend.env")

    def test_later_layer_overrides_earlier(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                (tool.ENV_DIR / "common.env").write_text("A=base\nB=keep\n")
                (tool.ENV_DIR / "backend.env").write_text("A=service\n")
                (tool.ENV_DIR / "backend.staging.env").write_text("A=staging\n")
                variables, origin = tool.resolve("backend", "staging")
                self.assertEqual(variables["A"], "staging")
                self.assertEqual(origin["A"], "backend.staging.env")
                self.assertEqual(variables["B"], "keep")
            finally:
                tool.ENV_DIR = old_dir

    def test_empty_value_removes_an_inherited_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                (tool.ENV_DIR / "common.env").write_text("A=base\n")
                (tool.ENV_DIR / "backend.staging.env").write_text("A=\n")
                variables, _ = tool.resolve("backend", "staging")
                self.assertNotIn("A", variables)
            finally:
                tool.ENV_DIR = old_dir


class SecrecyTests(unittest.TestCase):
    def test_secret_keys_are_recognised(self):
        for key in (
            "OPENAI_API_KEY", "MESHY_API_KEY", "JWT_SECRET_KEY",
            "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "RAILWAY_TOKEN",
        ):
            self.assertTrue(tool.is_secret(key), key)
        for key in ("DEBUG", "S3_REGION", "JWT_ALGORITHM", "BLENDER_PATH"):
            self.assertFalse(tool.is_secret(key), key)

    def test_literal_secret_is_redacted_but_reference_is_not(self):
        self.assertNotIn("sk-live", tool.display("OPENAI_API_KEY", "sk-live-123"))
        self.assertEqual(
            tool.display("OPENAI_API_KEY", "${{shared.OPENAI_API_KEY}}"),
            "${{shared.OPENAI_API_KEY}}",
        )

    def test_no_tracked_layer_file_holds_a_literal_secret(self):
        for path in tool.ENV_DIR.glob("*.env"):
            if path.name.startswith("secrets"):
                continue
            for key, value in tool.parse_env_file(path):
                if value and tool.is_secret(key):
                    self.assertTrue(
                        tool.is_reference(value),
                        f"{path.name} holds a literal value for {key}",
                    )


class CheckTests(unittest.TestCase):
    def test_check_passes_on_the_committed_layers(self):
        code, output = run(["check"])
        self.assertEqual(code, 0, output)

    def test_check_flags_a_value_duplicated_across_environments(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                (tool.ENV_DIR / "common.env").write_text("A=1\n")
                for environment in ("staging", "production"):
                    (tool.ENV_DIR / f"backend.{environment}.env").write_text(
                        "SAME_IN_BOTH=yes\n"
                    )
                code, output = run(["check"])
                self.assertEqual(code, 1)
                self.assertIn("SAME_IN_BOTH", output)
                self.assertIn("move it to backend.env", output)
            finally:
                tool.ENV_DIR = old_dir

    def test_check_flags_a_committed_literal_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                (tool.ENV_DIR / "backend.env").write_text("OPENAI_API_KEY=sk-live-abc\n")
                code, output = run(["check"])
                self.assertEqual(code, 1)
                self.assertIn("looks like a secret", output)
                self.assertNotIn("sk-live-abc", output)
            finally:
                tool.ENV_DIR = old_dir


class SyncTests(unittest.TestCase):
    def test_sync_batches_one_call_per_service(self):
        with StubbedRailway() as stub:
            code, output = run(["sync", "-e", "staging", "-y", "--skip-deploys"])
            self.assertEqual(code, 0, output)
            applied = stub.applied()
            self.assertEqual(len(applied), 3, "expected one call per service")
            backend = next(a for a in applied if a["service"].startswith("3970a673"))
            self.assertTrue(backend["skip_deploys"])
            self.assertIn("DEBUG=false", backend["sets"])
            self.assertIn(
                "OPENAI_API_KEY=${{shared.OPENAI_API_KEY}}", backend["sets"],
                "references must be sent literally, not expanded",
            )

    def test_sync_targets_the_environment_id_from_the_registry(self):
        project = tool.load_project()
        with StubbedRailway() as stub:
            run(["sync", "-e", "staging", "-s", "backend", "-y"])
            applied = stub.applied()
            self.assertEqual(
                applied[0]["environment"], project["environments"]["staging"]["id"]
            )

    def test_sync_skips_a_service_that_is_already_up_to_date(self):
        variables, _ = tool.resolve("vrm-converter", "production")
        with StubbedRailway({("e7afe8a4-ce76-4093-9122-72c498b4874f", "fb40d65e-7fb9-4a8b-8ecb-e6f457b17ce1"): variables}) as stub:
            code, output = run(["sync", "-e", "production", "-s", "vrm-converter", "-y"])
            self.assertEqual(code, 0, output)
            self.assertIn("already up to date", output)
            self.assertEqual(stub.applied(), [])

    def test_dry_run_changes_nothing_and_hides_secrets(self):
        with StubbedRailway() as stub:
            code, output = run(["sync", "-e", "production", "-n"])
            self.assertEqual(code, 0, output)
            self.assertEqual(stub.applied(), [])
            self.assertIn("would run", output)


class DiffTests(unittest.TestCase):
    BACKEND = "3970a673-db5b-4b2d-9456-93acf1da09bf"
    PROD = "fb40d65e-7fb9-4a8b-8ecb-e6f457b17ce1"

    def test_diff_reports_missing_and_changed_keys(self):
        payload = {(self.BACKEND, self.PROD): {"DEBUG": "true", "PORT": "8080"}}
        with StubbedRailway(payload):
            code, output = run(["diff", "-e", "production", "-s", "backend", "--exit-code"])
            self.assertEqual(code, 1)
            self.assertIn("~ DEBUG: true -> false", output)
            self.assertIn("+ OPENAI_API_KEY", output)
            self.assertNotIn("PORT", output, "Railway's own variables must be ignored")

    def test_diff_treats_a_resolved_reference_as_matching(self):
        variables, _ = tool.resolve("backend", "production")
        remote = dict(variables)
        remote["OPENAI_API_KEY"] = "sk-resolved-by-railway"
        with StubbedRailway({(self.BACKEND, self.PROD): remote}):
            code, output = run(["diff", "-e", "production", "-s", "backend", "--exit-code"])
            self.assertEqual(code, 0, output)
            self.assertIn("Railway matches", output)


class FactorTests(unittest.TestCase):
    def test_factor_collapses_identical_values_and_shields_secrets(self):
        ids = {
            ("3970a673-db5b-4b2d-9456-93acf1da09bf", "e0d14c8f-54d8-4eb9-a510-b43bf81f57d1"): {
                "DEBUG": "false",
                "S3_REGION": "auto",
                "ALLOWED_ORIGINS": "https://staging.example.app",
                "OPENAI_API_KEY": "sk-staging",
                "RAILWAY_PROJECT_ID": "ignored",
            },
            ("3970a673-db5b-4b2d-9456-93acf1da09bf", "fb40d65e-7fb9-4a8b-8ecb-e6f457b17ce1"): {
                "DEBUG": "false",
                "S3_REGION": "auto",
                "ALLOWED_ORIGINS": "https://prod.example.app",
                "OPENAI_API_KEY": "sk-production",
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                with StubbedRailway(ids):
                    code, output = run(["factor", "-s", "backend", "--write"])
                self.assertEqual(code, 0, output)
                shared = dict(tool.parse_env_file(tool.ENV_DIR / "backend.env"))
                staging = dict(tool.parse_env_file(tool.ENV_DIR / "backend.staging.env"))
                production = dict(tool.parse_env_file(tool.ENV_DIR / "backend.production.env"))

                # identical in both -> written once
                self.assertEqual(shared["DEBUG"], "false")
                self.assertEqual(shared["S3_REGION"], "auto")
                self.assertNotIn("DEBUG", staging)
                self.assertNotIn("DEBUG", production)

                # genuinely different -> stays per environment
                self.assertEqual(staging["ALLOWED_ORIGINS"], "https://staging.example.app")
                self.assertEqual(production["ALLOWED_ORIGINS"], "https://prod.example.app")

                # secrets never land in a tracked file, even when they differ
                self.assertEqual(shared["OPENAI_API_KEY"], "${{shared.OPENAI_API_KEY}}")
                for path in tool.ENV_DIR.glob("*.env"):
                    self.assertNotIn("sk-staging", path.read_text())
                    self.assertNotIn("sk-production", path.read_text())

                # Railway's own variables are not ours to manage
                self.assertNotIn("RAILWAY_PROJECT_ID", shared)
            finally:
                tool.ENV_DIR = old_dir

    def test_factor_without_write_touches_nothing(self):
        before = {p: p.read_text() for p in tool.ENV_DIR.glob("*.env")}
        with StubbedRailway():
            code, output = run(["factor", "-s", "backend"])
        self.assertEqual(code, 0, output)
        self.assertIn("Nothing written", output)
        for path, text in before.items():
            self.assertEqual(path.read_text(), text)


class WrapperTests(unittest.TestCase):
    def test_legacy_positional_service_still_works(self):
        script = tool.REPO_ROOT / "devops" / "scripts" / "sync-railway-env.sh"
        with StubbedRailway() as stub:
            result = subprocess.run(
                [str(script), "-e", "staging", "backend", "-y"],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            applied = stub.applied()
            self.assertEqual(len(applied), 1)
            self.assertTrue(applied[0]["service"].startswith("3970a673"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
