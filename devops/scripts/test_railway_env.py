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

    def test_a_credential_in_the_value_counts_even_with_an_innocent_key(self):
        url = "postgresql://postgres:hunter2@host:5432/db"
        self.assertTrue(tool.is_secret("DATABASE_URL"))
        self.assertTrue(tool.is_secret("SOMETHING_BLAND", url))
        self.assertNotIn("hunter2", tool.display("SOMETHING_BLAND", url))
        # A URL without userinfo is ordinary config, not a credential.
        self.assertFalse(
            tool.is_secret("SERVICE_URL", "http://vrm-converter.railway.internal:8000")
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

    def test_check_flags_a_workflow_that_hard_codes_an_id(self):
        project = tool.load_project()
        backend_id = project["services"]["backend"]["id"]
        with tempfile.TemporaryDirectory() as tmp:
            old_root, old_dir = tool.REPO_ROOT, tool.ENV_DIR
            tool.REPO_ROOT = Path(tmp)
            tool.ENV_DIR = Path(tmp) / "env"
            tool.ENV_DIR.mkdir()
            try:
                (tool.ENV_DIR / "common.env").write_text("A=1\n")
                workflows = tool.REPO_ROOT / ".github" / "workflows"
                workflows.mkdir(parents=True)
                (workflows / "deploy.yml").write_text(
                    f"run: railway up --service={backend_id}\n"
                )
                code, output = run(["check"])
                self.assertEqual(code, 1, output)
                self.assertIn("hard-codes the ID of service backend", output)
                self.assertIn("project.json", output)
            finally:
                tool.REPO_ROOT, tool.ENV_DIR = old_root, old_dir

    def test_check_passes_when_workflows_reference_the_registry(self):
        # The real workflows must stay clean.
        code, output = run(["check"])
        self.assertEqual(code, 0, output)

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


class ProjectRegistryTests(unittest.TestCase):
    def test_a_malformed_entry_reports_an_error_not_a_traceback(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_file = tool.PROJECT_FILE
            tool.PROJECT_FILE = Path(tmp) / "project.json"
            try:
                tool.PROJECT_FILE.write_text(
                    json.dumps({
                        "services": {"backend": None},
                        "environments": {"production": {"id": "x"}},
                    })
                )
                with self.assertRaises(tool.ToolError):
                    tool.load_project()
            finally:
                tool.PROJECT_FILE = old_file


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

    def test_sync_targets_the_service_by_id_and_environment_by_name(self):
        # Asymmetric on purpose: the Railway CLI resolves --service by ID but
        # --environment by name only, and rejects an environment ID with
        # 'Environment "<id>" not found'.
        project = tool.load_project()
        with StubbedRailway() as stub:
            run(["sync", "-e", "staging", "-s", "backend", "-y"])
            applied = stub.applied()
            self.assertEqual(
                applied[0]["service"], project["services"]["backend"]["id"]
            )
            self.assertEqual(applied[0]["environment"], "staging")
            self.assertNotEqual(
                applied[0]["environment"], project["environments"]["staging"]["id"]
            )

    def test_no_environment_is_ever_addressed_by_id(self):
        project = tool.load_project()
        ids = {e["id"] for e in project["environments"].values() if e.get("id")}
        for name in project["environments"]:
            self.assertNotIn(tool.environment_ref(project, name), ids)

    def test_sync_skips_a_service_that_is_already_up_to_date(self):
        variables, _ = tool.resolve("vrm-converter", "production")
        with StubbedRailway({("e7afe8a4-ce76-4093-9122-72c498b4874f", "production"): variables}) as stub:
            code, output = run(["sync", "-e", "production", "-s", "vrm-converter", "-y"])
            self.assertEqual(code, 0, output)
            self.assertIn("already up to date", output)
            self.assertEqual(stub.applied(), [])

    def test_dry_run_changes_nothing_and_prints_the_real_command(self):
        with StubbedRailway() as stub:
            code, output = run(["sync", "-e", "production", "-n"])
            self.assertEqual(code, 0, output)
            self.assertEqual(stub.applied(), [])
            self.assertIn("would run", output)
            # The printed command must be the one that actually runs.
            project = tool.load_project()
            self.assertIn(project["services"]["backend"]["id"], output)
            self.assertIn("--environment production", output)
            self.assertIn("--set DEBUG=false", output)

    def test_sync_without_a_tty_refuses_to_push_unconfirmed(self):
        # stdin is not a terminal here, which is how CI and cron would call it.
        with StubbedRailway() as stub:
            code, output = run(["sync", "-e", "production"])
            self.assertEqual(code, 1, output)
            self.assertIn("not a terminal", output)
            self.assertEqual(stub.applied(), [], "nothing may reach production")

    def test_legacy_entrypoint_also_refuses_without_confirmation(self):
        script = tool.REPO_ROOT / "devops" / "scripts" / "sync-railway-env.sh"
        with StubbedRailway() as stub:
            result = subprocess.run(
                [str(script)], stdin=subprocess.DEVNULL,
                capture_output=True, text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(stub.applied(), [])

    def test_sync_pushes_a_reference_railway_reports_resolved(self):
        # Railway hands back ${{shared.X}} already resolved, so an edited
        # reference must never be mistaken for "already up to date".
        variables, _ = tool.resolve("backend", "production")
        remote = dict(variables)
        remote["JWT_SECRET_KEY"] = "some-resolved-secret"
        key = ("3970a673-db5b-4b2d-9456-93acf1da09bf", "production")
        with StubbedRailway({key: remote}) as stub:
            code, output = run(["sync", "-e", "production", "-s", "backend", "-y"])
            self.assertEqual(code, 0, output)
            self.assertNotIn("already up to date", output)
            self.assertEqual(len(stub.applied()), 1)
            self.assertIn(
                "JWT_SECRET_KEY=${{shared.JWT_SECRET_KEY}}",
                stub.applied()[0]["sets"],
            )


class DiffTests(unittest.TestCase):
    BACKEND = "3970a673-db5b-4b2d-9456-93acf1da09bf"
    PROD = "production"

    def test_diff_reports_missing_and_changed_keys(self):
        payload = {(self.BACKEND, self.PROD): {"DEBUG": "true", "PORT": "8080"}}
        with StubbedRailway(payload):
            code, output = run(["diff", "-e", "production", "-s", "backend", "--exit-code"])
            self.assertEqual(code, 1)
            self.assertIn("~ DEBUG: true -> false", output)
            self.assertIn("+ OPENAI_API_KEY", output)
            self.assertNotIn("PORT", output, "Railway's own variables must be ignored")

    def test_diff_flags_a_reference_it_cannot_verify(self):
        # Railway reports references resolved, so a mismatch is genuinely
        # ambiguous. Reporting it as "already correct" would hide an edited
        # reference that never shipped.
        variables, _ = tool.resolve("backend", "production")
        remote = dict(variables)
        remote["OPENAI_API_KEY"] = "sk-resolved-by-railway"
        with StubbedRailway({(self.BACKEND, self.PROD): remote}):
            code, output = run(["diff", "-e", "production", "-s", "backend", "--exit-code"])
            self.assertEqual(code, 1, output)
            self.assertIn("could not be verified", output)
            self.assertNotIn("Railway matches", output)

    def test_diff_verifies_a_reference_railway_echoes_back_verbatim(self):
        # If Railway does store the reference raw, nothing is ambiguous and no
        # push is needed.
        variables, _ = tool.resolve("backend", "production")
        with StubbedRailway({(self.BACKEND, self.PROD): dict(variables)}):
            code, output = run(["diff", "-e", "production", "-s", "backend", "--exit-code"])
            self.assertEqual(code, 0, output)
            self.assertIn("Railway matches", output)

    def test_diff_says_how_to_remove_a_variable_only_railway_has(self):
        variables, _ = tool.resolve("backend", "production")
        remote = dict(variables)
        remote["LEFTOVER"] = "stale"
        with StubbedRailway({(self.BACKEND, self.PROD): remote}):
            _code, output = run(["diff", "-e", "production", "-s", "backend"])
            self.assertIn("LEFTOVER", output)
            self.assertIn("sync never removes it", output)


class FactorTests(unittest.TestCase):
    BACKEND = "3970a673-db5b-4b2d-9456-93acf1da09bf"
    FRONTEND = "a71bc2c6-c912-475c-ab16-a5dbf0ba074e"
    VRM = "e7afe8a4-ce76-4093-9122-72c498b4874f"
    STAGING = "staging"
    PROD = "production"

    def test_factor_collapses_identical_values_and_shields_secrets(self):
        ids = {
            ("3970a673-db5b-4b2d-9456-93acf1da09bf", "staging"): {
                "DEBUG": "false",
                "S3_REGION": "auto",
                "ALLOWED_ORIGINS": "https://staging.example.app",
                "OPENAI_API_KEY": "sk-staging",
                "RAILWAY_PROJECT_ID": "ignored",
            },
            ("3970a673-db5b-4b2d-9456-93acf1da09bf", "production"): {
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

    def test_factor_never_writes_a_connection_string_and_check_catches_one(self):
        # A Postgres URL carries its password in the value, not the key name.
        url = "postgresql://postgres:hunter2@pg.railway.internal:5432/railway"
        ids = {
            (self.BACKEND, self.STAGING): {"DATABASE_URL": url, "DEBUG": "false"},
            (self.BACKEND, self.PROD): {"DATABASE_URL": url, "DEBUG": "false"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                with StubbedRailway(ids):
                    code, output = run(["factor", "-s", "backend", "--write"])
                self.assertEqual(code, 0, output)
                for path in tool.ENV_DIR.glob("*.env"):
                    self.assertNotIn("hunter2", path.read_text(), path.name)
                self.assertNotIn("hunter2", output)

                # And if one is ever pasted in by hand, check must fail on it.
                (tool.ENV_DIR / "backend.env").write_text(f"DATABASE_URL={url}\n")
                code, output = run(["check"])
                self.assertEqual(code, 1, output)
                self.assertIn("connection string", output)
                self.assertNotIn("hunter2", output)
            finally:
                tool.ENV_DIR = old_dir

    def test_factor_keeps_a_reference_the_layer_file_already_declares(self):
        # Railway reports ${{Postgres.DATABASE_URL}} resolved; writing that
        # back would both leak it and undo the design.
        url = "postgresql://postgres:hunter2@pg.railway.internal:5432/railway"
        ids = {
            (self.BACKEND, self.STAGING): {"DATABASE_URL": url},
            (self.BACKEND, self.PROD): {"DATABASE_URL": url},
        }
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                (tool.ENV_DIR / "backend.env").write_text(
                    "DATABASE_URL=${{Postgres.DATABASE_URL}}\n"
                )
                with StubbedRailway(ids):
                    code, output = run(["factor", "-s", "backend", "--write"])
                self.assertEqual(code, 0, output)
                after = dict(tool.parse_env_file(tool.ENV_DIR / "backend.env"))
                self.assertEqual(after["DATABASE_URL"], "${{Postgres.DATABASE_URL}}")
            finally:
                tool.ENV_DIR = old_dir

    def test_factor_limited_to_one_service_leaves_common_env_alone(self):
        # A -s run has not seen the other services, so it cannot know what
        # belongs in common.env — and must not truncate it to find out.
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                common = tool.ENV_DIR / "common.env"
                common.write_text("# shared\nDEBUG=false\n")
                before = common.read_text()
                ids = {
                    (self.BACKEND, self.STAGING): {"DEBUG": "false", "X": "1"},
                    (self.BACKEND, self.PROD): {"DEBUG": "false", "X": "1"},
                }
                with StubbedRailway(ids):
                    code, output = run(["factor", "-s", "backend", "--write"])
                self.assertEqual(code, 0, output)
                self.assertEqual(common.read_text(), before, "common.env was rewritten")
                self.assertIn("untouched", output)
                # ...and the service file must not restate what common provides.
                backend = dict(tool.parse_env_file(tool.ENV_DIR / "backend.env"))
                self.assertNotIn("DEBUG", backend)
                self.assertEqual(backend["X"], "1")
            finally:
                tool.ENV_DIR = old_dir

    def test_factor_across_every_service_still_writes_common_env(self):
        shared = {"DEBUG": "false"}
        ids = {}
        for service_id in (self.BACKEND, self.FRONTEND, self.VRM):
            for environment in (self.STAGING, self.PROD):
                ids[(service_id, environment)] = dict(shared)
        with tempfile.TemporaryDirectory() as tmp:
            old_dir = tool.ENV_DIR
            tool.ENV_DIR = Path(tmp)
            try:
                with StubbedRailway(ids):
                    code, output = run(["factor", "--write"])
                self.assertEqual(code, 0, output)
                common = dict(tool.parse_env_file(tool.ENV_DIR / "common.env"))
                self.assertEqual(common["DEBUG"], "false")
                for service in ("backend", "frontend", "vrm-converter"):
                    single = dict(tool.parse_env_file(tool.ENV_DIR / f"{service}.env"))
                    self.assertNotIn("DEBUG", single, "should live in common.env only")
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
