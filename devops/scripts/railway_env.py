#!/usr/bin/env python3
"""Single source of truth for HeroMaker's Railway environment variables.

Every variable is declared in exactly one file under devops/railway/env/ and
is layered onto the services, instead of being pasted into the staging and
production environments separately.

Layers, lowest precedence first:

    common.env                  every service, every environment
    common.<environment>.env    every service, one environment
    <service>.env               one service, every environment
    <service>.<environment>.env one service, one environment
    secrets.env                 gitignored, never committed
    secrets.<environment>.env   gitignored, never committed

A later layer overrides an earlier one. An empty value (``KEY=``) drops a key
inherited from a lower layer, so it is no longer pushed. It does **not** remove
a variable Railway already holds — ``diff`` reports those, and they have to be
unset in the dashboard.

Values may be Railway references (``${{shared.X}}``, ``${{Postgres.X}}``,
``${{frontend.RAILWAY_PUBLIC_DOMAIN}}``). Railway resolves them inside whichever
environment is deploying, which is how one committed line can mean two
different things in staging and production without being written twice.

Commands:

    resolve   print the variables a service would get in an environment
    diff      compare the resolved set against what Railway actually has
    sync      push the resolved set to Railway (one batched call per service)
    check     lint the tracked layers: leaked secrets, cross-env duplication
    factor    read the live staging/production variables and rewrite the
              layers so everything identical collapses into a shared file
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RAILWAY_DIR = REPO_ROOT / "devops" / "railway"
ENV_DIR = RAILWAY_DIR / "env"
PROJECT_FILE = RAILWAY_DIR / "project.json"

KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
REFERENCE_RE = re.compile(r"\$\{\{[^}]*\}\}")
SECRET_RE = re.compile(
    r"SECRET|PASSWORD|PASSWD|TOKEN|CREDENTIAL|API_KEY|ACCESS_KEY|PRIVATE"
    r"|DATABASE_URL|CONNECTION_STRING|_DSN$|_KEY$"
)

# A connection string carries its password in the value, not the key name:
# postgresql://postgres:hunter2@host:5432/db. Key-name heuristics never catch
# those, so every value is checked for userinfo credentials as well.
CREDENTIAL_URL_RE = re.compile(r"://[^/\s:@]+:[^/\s@]+@")

# Variables Railway injects itself. They are never ours to declare or diff.
PLATFORM_PREFIXES = ("RAILWAY_", "NIXPACKS_")
PLATFORM_KEYS = {"PORT"}


class ToolError(Exception):
    """Something the user needs to fix, reported without a traceback."""


# --------------------------------------------------------------------------
# project registry
# --------------------------------------------------------------------------

def load_project() -> dict:
    try:
        data = json.loads(PROJECT_FILE.read_text())
    except FileNotFoundError:
        raise ToolError(f"{_rel(PROJECT_FILE)} not found")
    except json.JSONDecodeError as exc:
        raise ToolError(f"{_rel(PROJECT_FILE)} is not valid JSON: {exc}")
    for section in ("services", "environments"):
        if not isinstance(data.get(section), dict) or not data[section]:
            raise ToolError(f"{_rel(PROJECT_FILE)} has no '{section}'")
        for name, spec in data[section].items():
            if not isinstance(spec, dict):
                raise ToolError(
                    f"{_rel(PROJECT_FILE)}: {section}.{name} must be an object, "
                    f"got {type(spec).__name__}"
                )
    return data


def service_names(project: dict) -> list[str]:
    return list(project["services"])


def environment_names(project: dict) -> list[str]:
    return list(project["environments"])


def default_environment(project: dict) -> str:
    for name, spec in project["environments"].items():
        if spec.get("default"):
            return name
    return environment_names(project)[0]


def service_ref(project: dict, service: str) -> str:
    """What to pass to `railway --service`: the ID if we know it, else the name.

    Services accept an ID, which survives a rename in the dashboard.
    Environments do not — see environment_ref.
    """
    return project["services"][service].get("id") or service


def environment_ref(project: dict, environment: str) -> str:
    """What to pass to `railway --environment`.

    The NAME, not the ID. Unlike --service, the Railway CLI resolves
    --environment by name only; handing it an ID fails with
    'Environment "<id>" not found'.
    """
    return project["environments"][environment].get("name") or environment


def service_dir(project: dict, service: str) -> Path:
    return REPO_ROOT / project["services"][service].get("dir", service)


# --------------------------------------------------------------------------
# env file parsing / layering
# --------------------------------------------------------------------------

def parse_env_file(path: Path) -> list[tuple[str, str]]:
    """Parse one layer. Returns (key, value) pairs in file order.

    Comments must be on their own line: a '#' inside a value is part of the
    value, because secrets and URLs legitimately contain one.
    """
    pairs: list[tuple[str, str]] = []
    seen: dict[str, int] = {}
    text = path.read_text(encoding="utf-8-sig")
    for lineno, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            raise ToolError(f"{_rel(path)}:{lineno}: expected KEY=value, got {raw!r}")
        key, value = line.split("=", 1)
        key = key.strip()
        if not KEY_RE.match(key):
            raise ToolError(f"{_rel(path)}:{lineno}: invalid variable name {key!r}")
        if key in seen:
            raise ToolError(
                f"{_rel(path)}:{lineno}: {key} is already set on line {seen[key]} "
                f"of the same file"
            )
        seen[key] = lineno
        pairs.append((key, _unquote(value.strip())))
    return pairs


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def layer_paths(service: str, environment: str, include_secrets: bool = True) -> list[Path]:
    """The layer files for a service/environment, lowest precedence first."""
    names = [
        "common.env",
        f"common.{environment}.env",
        f"{service}.env",
        f"{service}.{environment}.env",
    ]
    if include_secrets:
        names += ["secrets.env", f"secrets.{environment}.env"]
    return [ENV_DIR / name for name in names]


def resolve(service: str, environment: str, include_secrets: bool = True):
    """Merge the layers. Returns (variables, origin) keyed by variable name."""
    variables: dict[str, str] = {}
    origin: dict[str, str] = {}
    for path in layer_paths(service, environment, include_secrets):
        if not path.exists():
            continue
        for key, value in parse_env_file(path):
            if value == "":
                # An empty value in an override means "stop pushing what the
                # lower layer set" (Railway rejects empty values anyway). A
                # variable already live on Railway is not removed by this;
                # `diff` flags it as present remotely but in no layer file.
                variables.pop(key, None)
                origin.pop(key, None)
                continue
            variables[key] = value
            origin[key] = path.name
    return variables, origin


def is_secret(key: str, value: str | None = None) -> bool:
    """True if the key name, or the value itself, carries a credential."""
    if SECRET_RE.search(key):
        return True
    return value is not None and bool(CREDENTIAL_URL_RE.search(value))


def is_reference(value: str) -> bool:
    return bool(REFERENCE_RE.search(value))


def display(key: str, value: str) -> str:
    """Never print a literal secret; references are safe and worth seeing."""
    if is_reference(value) or not is_secret(key, value):
        return value
    return f"<redacted, {len(value)} chars>"


def is_platform_key(key: str) -> bool:
    return key in PLATFORM_KEYS or key.startswith(PLATFORM_PREFIXES)


def _rel(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


# --------------------------------------------------------------------------
# Railway CLI
# --------------------------------------------------------------------------

def require_cli() -> None:
    from shutil import which

    if which("railway") is None:
        raise ToolError(
            "Railway CLI not found. Install and log in:\n"
            "  npm i -g @railway/cli\n"
            "  railway login"
        )


_LINKED_DIRS: dict[str, Path] = {}


def linked_dir(project: dict, service: str) -> Path:
    """Where to run the CLI.

    The repo root is preferred, but services were historically linked one
    directory at a time, so fall back to the service's own directory. Probing
    shells out, so the answer is cached for the rest of the run.
    """
    if service in _LINKED_DIRS:
        return _LINKED_DIRS[service]
    for candidate in (REPO_ROOT, service_dir(project, service)):
        if not candidate.is_dir():
            continue
        result = subprocess.run(
            ["railway", "status"],
            cwd=candidate,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            _LINKED_DIRS[service] = candidate
            return candidate
    raise ToolError(
        f"No Railway project is linked for '{service}'. Run:\n"
        f"  railway link            # from {_rel(REPO_ROOT)}\n"
        f"or set RAILWAY_TOKEN for a project-scoped token."
    )


def fetch_remote(project: dict, service: str, environment: str) -> dict[str, str]:
    require_cli()
    cmd = [
        "railway", "variables",
        "--service", service_ref(project, service),
        "--environment", environment_ref(project, environment),
        "--json",
    ]
    result = subprocess.run(
        cmd, cwd=linked_dir(project, service), capture_output=True, text=True
    )
    if result.returncode != 0:
        raise ToolError(
            f"`{' '.join(cmd)}` failed:\n{result.stderr.strip() or result.stdout.strip()}"
        )
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ToolError(
            f"Could not parse `railway variables --json` output for "
            f"{service}/{environment}:\n{result.stdout[:500]}"
        )
    if not isinstance(data, dict):
        raise ToolError(f"Unexpected JSON shape from Railway for {service}/{environment}")
    return {str(k): "" if v is None else str(v) for k, v in data.items()}


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def cmd_resolve(args, project) -> int:
    for service in args.services:
        variables, origin = resolve(service, args.environment, not args.no_secrets)
        if args.format == "json":
            print(json.dumps(variables, indent=2, sort_keys=True))
            continue
        print(f"\n# {service} @ {args.environment} ({len(variables)} variables)")
        width = max((len(k) for k in variables), default=0)
        for key in sorted(variables):
            value = display(key, variables[key])
            if args.format == "env":
                print(f"{key}={value}")
            else:
                print(f"  {key:<{width}}  {value}   [{origin[key]}]")
    return 0


class Comparison:
    """How the resolved layers line up against what Railway reports.

    `unverifiable` is the honest bucket: when a local value is a reference and
    Railway reports something different, we cannot tell whether the reference
    was edited or whether Railway simply resolved it before handing it back.
    Folding those into `same` would mean an edited ${{shared.X}} silently never
    ships, so they are pushed instead. A reference Railway echoes back verbatim
    lands in `same` as normal, and nothing is pushed needlessly.
    """

    def __init__(self, add, change, unverifiable, same, extra):
        self.add = add
        self.change = change
        self.unverifiable = unverifiable
        self.same = same
        self.extra = extra

    @property
    def needs_push(self) -> bool:
        return bool(self.add or self.change or self.unverifiable)


def _classify(local: dict[str, str], remote: dict[str, str]) -> Comparison:
    add, change, unverifiable, same = {}, {}, {}, {}
    for key, value in local.items():
        if key not in remote:
            add[key] = value
        elif remote[key] == value:
            same[key] = value
        elif is_reference(value):
            unverifiable[key] = value
        else:
            change[key] = value
    extra = {
        k: v for k, v in remote.items()
        if k not in local and not is_platform_key(k)
    }
    return Comparison(add, change, unverifiable, same, extra)


def cmd_diff(args, project) -> int:
    drift = 0
    unverifiable = 0
    for service in args.services:
        local, _ = resolve(service, args.environment)
        remote = fetch_remote(project, service, args.environment)
        plan = _classify(local, remote)
        print(f"\n📦 {service} @ {args.environment}")
        for key in sorted(plan.add):
            print(f"  + {key} = {display(key, plan.add[key])}")
        for key in sorted(plan.change):
            print(f"  ~ {key}: {display(key, remote[key])} -> "
                  f"{display(key, plan.change[key])}")
        for key in sorted(plan.unverifiable):
            print(f"  ? {key} = {plan.unverifiable[key]} — a reference, and "
                  f"Railway reports a different value; sync will push it")
        for key in sorted(plan.extra):
            print(f"  ! {key} set on Railway but in no layer file — sync never "
                  f"removes it; unset it in the dashboard")
        print(f"  = {len(plan.same)} already correct")
        drift += len(plan.add) + len(plan.change)
        unverifiable += len(plan.unverifiable)
    if drift or unverifiable:
        parts = []
        if drift:
            parts.append(f"{drift} variable(s) differ")
        if unverifiable:
            parts.append(f"{unverifiable} reference(s) could not be verified")
        print(f"\n{', '.join(parts)}. Apply with: railway-env.sh sync")
    else:
        print("\n✅ Railway matches the layer files.")
    return 1 if ((drift or unverifiable) and args.exit_code) else 0


def _redact_set(assignment: str) -> str:
    """Render a `KEY=value` argument with a secret value hidden."""
    key, _, value = assignment.partition("=")
    return f"{key}={display(key, value)}"


def cmd_sync(args, project) -> int:
    for service in args.services:
        variables, _ = resolve(service, args.environment)
        if not variables:
            print(f"⏭️  {service}: no variables resolved, skipping")
            continue

        plan = None
        if not args.force:
            try:
                remote = fetch_remote(project, service, args.environment)
                plan = _classify(variables, remote)
            except ToolError as exc:
                if args.dry_run:
                    print(f"⚠️  could not read current {service} variables: {exc}")
                else:
                    raise

        cmd = [
            "railway", "variables",
            "--service", service_ref(project, service),
            "--environment", environment_ref(project, args.environment),
        ]
        for key in sorted(variables):
            cmd += ["--set", f"{key}={variables[key]}"]
        if args.skip_deploys:
            cmd.append("--skip-deploys")

        print(f"\n📦 {service} @ {args.environment}: {len(variables)} variables")
        if plan is not None:
            if not plan.needs_push:
                print("  ✅ already up to date, nothing to push")
                continue
            for key in sorted(plan.add):
                print(f"  + {key} = {display(key, plan.add[key])}")
            for key in sorted(plan.change):
                print(f"  ~ {key} -> {display(key, plan.change[key])}")
            if plan.unverifiable:
                print(f"  ? {len(plan.unverifiable)} reference(s) Railway reports "
                      f"resolved — pushed so an edited reference cannot be missed")

        if args.dry_run:
            # Print what actually runs, IDs and all, with secret values hidden.
            printable = " ".join(
                _redact_set(arg) if previous == "--set" else arg
                for previous, arg in zip([""] + cmd[:-1], cmd)
            )
            print(f"  would run: {printable}")
            continue

        if not args.yes:
            if not sys.stdin.isatty():
                raise ToolError(
                    f"refusing to push to {args.environment} without confirmation: "
                    f"stdin is not a terminal. Pass -y to confirm, or -n for a "
                    f"dry run."
                )
            answer = input(f"  Push to {args.environment}? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                print("  skipped")
                continue

        require_cli()
        result = subprocess.run(cmd, cwd=linked_dir(project, service))
        if result.returncode != 0:
            raise ToolError(f"railway variables failed for {service}")
        print(f"  ✅ {service} synced")
    return 0


def cmd_check(args, project) -> int:
    problems: list[str] = []
    warnings: list[str] = []
    environments = environment_names(project)

    tracked = sorted(
        p for p in ENV_DIR.glob("*.env") if not p.name.startswith("secrets")
    )
    if not tracked:
        problems.append(f"no layer files found in {_rel(ENV_DIR)}")

    parsed: dict[str, list[tuple[str, str]]] = {}
    for path in tracked:
        try:
            parsed[path.name] = parse_env_file(path)
        except ToolError as exc:
            problems.append(str(exc))

    # 1. A committed file must never hold a literal secret.
    for name, pairs in parsed.items():
        for key, value in pairs:
            if not value or is_reference(value):
                continue
            if CREDENTIAL_URL_RE.search(value):
                problems.append(
                    f"{name}: {key} holds a connection string with an embedded "
                    f"password. Put it in a Railway shared variable and "
                    f"reference it as ${{{{shared.{key}}}}}, or move it to a "
                    f"gitignored secrets.env."
                )
            elif is_secret(key):
                problems.append(
                    f"{name}: {key} looks like a secret but holds a literal value. "
                    f"Put it in a Railway shared variable and reference it as "
                    f"${{{{shared.{key}}}}}, or move it to a gitignored "
                    f"secrets.env."
                )

    # 2. The thing this layout exists to prevent: the same key with the same
    #    value written into every environment's override file.
    for service in service_names(project) + ["common"]:
        per_env = {}
        for environment in environments:
            pairs = parsed.get(f"{service}.{environment}.env")
            if pairs is not None:
                per_env[environment] = dict(pairs)
        if len(per_env) < 2:
            continue
        shared_keys = set.intersection(*(set(d) for d in per_env.values()))
        for key in sorted(shared_keys):
            values = {d[key] for d in per_env.values()}
            if len(values) == 1:
                problems.append(
                    f"{key} is duplicated with the same value in "
                    + ", ".join(f"{service}.{e}.env" for e in per_env)
                    + f" — move it to {service}.env"
                )

    # 3. An override that restates what it already inherits is dead weight.
    for service in service_names(project):
        for environment in environments:
            path = ENV_DIR / f"{service}.{environment}.env"
            if path.name not in parsed:
                continue
            base: dict[str, str] = {}
            for lower_path in layer_paths(service, environment, include_secrets=False):
                if lower_path == path or not lower_path.exists():
                    continue
                base.update(dict(parse_env_file(lower_path)))
            for key, value in parsed[path.name]:
                if value and base.get(key) == value:
                    warnings.append(
                        f"{path.name}: {key} repeats the value it already "
                        f"inherits — the line can go."
                    )

    # 4. project.json is the only place an ID belongs, ANYWHERE in the tree.
    #
    #    This started as a check on the three workflows that used to paste the
    #    service IDs in. It covers the whole repository now, because the same
    #    IDs had also been copied into docs/DEVOPS.md, CLAUDE.md and the
    #    fixtures in test_railway_env.py - and both environment IDs in
    #    project.json were WRONG for weeks while every one of those copies
    #    agreed with them. A copy cannot disagree with the original, so it can
    #    never catch an error; it can only make the error harder to correct.
    #    One place to read, one place to fix.
    known_ids = {}
    for section in ("services", "environments"):
        for name, spec in project[section].items():
            if spec.get("id"):
                known_ids[spec["id"]] = f"{section[:-1]} {name}"
    if isinstance(project.get("project"), dict) and project["project"].get("id"):
        known_ids[project["project"]["id"]] = "the project"

    SKIP_DIRS = {".git", "node_modules", ".venv", "dist", "build", "__pycache__",
                 ".pytest_cache", "data", "uploads"}
    TEXT_SUFFIXES = {".py", ".sh", ".yml", ".yaml", ".json", ".md", ".ts", ".tsx",
                     ".js", ".mjs", ".env", ".example", ".toml", ".cfg", ".txt"}

    for path in sorted(REPO_ROOT.rglob("*")):
        if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(REPO_ROOT).parts):
            continue
        if path == PROJECT_FILE:
            continue  # the one file that is allowed to say them
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        for value, label in known_ids.items():
            if value in text:
                problems.append(
                    f"{_rel(path)}: hard-codes the ID of {label}. "
                    f"devops/railway/project.json is the only place an ID is "
                    f"written; read it from there (the workflows go through "
                    f"railway-config.yml, Python through load_project())."
                )

    # 5. Every service must resolve to something in every environment.
    for service in service_names(project):
        for environment in environments:
            variables, _ = resolve(service, environment, include_secrets=False)
            if not variables:
                warnings.append(f"{service} @ {environment} resolves to no variables")

    for warning in warnings:
        print(f"⚠️  {warning}")
    for problem in problems:
        print(f"❌ {problem}")
    if problems:
        print(f"\n{len(problems)} problem(s) found.")
        return 1
    print(f"✅ {len(tracked)} layer file(s) OK"
          + (f", {len(warnings)} warning(s)" if warnings else ""))
    return 0


def cmd_factor(args, project) -> int:
    """Read the live variables and work out what is genuinely per-environment."""
    environments = args.environments or environment_names(project)
    if len(environments) < 2:
        raise ToolError("factor needs at least two environments to compare")

    # A run limited with -s has only seen part of the project, so it must not
    # rewrite files whose content depends on the services it skipped.
    whole_project = set(args.services) == set(service_names(project))

    # What the layer files already declare. A key that is deliberately a
    # Railway reference stays one: the live value is that reference resolved,
    # and writing it back would both leak it and undo the design.
    declared: dict[str, dict[str, str]] = {}
    for service in args.services:
        current, _ = resolve(service, environments[0], include_secrets=False)
        declared[service] = current
    existing_common = (
        dict(parse_env_file(ENV_DIR / "common.env"))
        if (ENV_DIR / "common.env").exists() else {}
    )

    live: dict[str, dict[str, dict[str, str]]] = {}
    for service in args.services:
        live[service] = {}
        for environment in environments:
            remote = fetch_remote(project, service, environment)
            live[service][environment] = {
                k: v for k, v in remote.items() if not is_platform_key(k)
            }

    shared_per_service: dict[str, dict[str, str]] = {}
    per_env: dict[tuple[str, str], dict[str, str]] = {}
    secrets_found: dict[str, dict[str, str]] = {}

    for service, by_env in live.items():
        keys = set().union(*(set(d) for d in by_env.values()))
        shared_per_service[service] = {}
        for environment in environments:
            per_env[(service, environment)] = {}
        for key in sorted(keys):
            values = {env: by_env[env].get(key) for env in environments}
            everywhere = all(v is not None for v in values.values())
            identical = everywhere and len(set(values.values())) == 1
            declared_value = declared.get(service, {}).get(key)
            secret = is_secret(key) or any(
                v is not None and is_secret(key, v) for v in values.values()
            )
            if declared_value is not None and is_reference(declared_value):
                # Already a reference — keep it exactly as written.
                shared_per_service[service][key] = declared_value
                if secret:
                    secrets_found.setdefault(key, {})
                    for environment in environments:
                        if values[environment] is not None:
                            secrets_found[key][environment] = values[environment]
            elif secret:
                # Never land a secret in a tracked file, whatever its value.
                shared_per_service[service][key] = f"${{{{shared.{key}}}}}"
                secrets_found.setdefault(key, {})
                for environment in environments:
                    if values[environment] is not None:
                        secrets_found[key][environment] = values[environment]
            elif identical:
                shared_per_service[service][key] = values[environments[0]]
            else:
                for environment in environments:
                    if values[environment] is not None:
                        per_env[(service, environment)][key] = values[environment]

    # Anything identical across every service too belongs in common.env — but
    # only a run that looked at every service can say what "every service" has.
    common: dict[str, str] = {}
    if whole_project and len(shared_per_service) > 1:
        common_keys = set.intersection(*(set(d) for d in shared_per_service.values()))
        for key in sorted(common_keys):
            values = {d[key] for d in shared_per_service.values()}
            if len(values) == 1:
                common[key] = next(iter(values))
        for key in common:
            for service_map in shared_per_service.values():
                service_map.pop(key, None)
    else:
        # Partial run: leave common.env alone, and do not restate what it
        # already provides in the service files being rewritten.
        for service_map in shared_per_service.values():
            for key, value in existing_common.items():
                if service_map.get(key) == value:
                    service_map.pop(key)

    duplicated = sum(
        len(shared_per_service[s]) * (len(environments) - 1) for s in shared_per_service
    ) + len(common) * (len(environments) * len(args.services) - 1)
    # `common` is empty unless this was a whole-project run, so the second term
    # contributes nothing to a partial run's tally.

    print("\n=== what the live environments look like ===")
    for service in args.services:
        for environment in environments:
            print(f"  {service:<14} {environment:<11} "
                  f"{len(live[service][environment])} variables")

    rows = [("common.env", len(common), False)] if whole_project else []
    for service in args.services:
        rows.append((f"{service}.env", len(shared_per_service[service]), False))
        for environment in environments:
            rows.append((
                f"{service}.{environment}.env",
                len(per_env[(service, environment)]),
                True,
            ))
    width = max(len(name) for name, _, _ in rows)

    print("\n=== factored ===")
    for name, count, per_environment in rows:
        note = "   (nothing environment-specific)" if per_environment and not count else ""
        print(f"  {name:<{width}}  {count} key(s){note}")
    print(f"\n  ~{duplicated} duplicated definition(s) collapse into a single line each")
    if not whole_project:
        print("  common.env is left untouched: this run only looked at "
              f"{', '.join(args.services)}")

    if secrets_found:
        print("\n=== secrets: create these as Railway shared variables ===")
        print("  Project → Settings → Shared Variables, per environment.")
        for key in sorted(secrets_found):
            present = secrets_found[key]
            if len(present) < len(environments):
                note = "set in " + ", ".join(sorted(present))
            elif len(set(present.values())) == 1:
                note = "same value in every environment"
            else:
                note = "a different value per environment"
            print(f"  {key:<24} ({note})")
        print("  Values are NOT written to any tracked file.")

    if not args.write:
        print("\nNothing written. Re-run with --write to update the layer files.")
        return 0

    if whole_project:
        _write_layer(ENV_DIR / "common.env", common, "every service, every environment")
    else:
        print(f"  kept {_rel(ENV_DIR / 'common.env')} untouched "
              f"(this run only looked at {', '.join(args.services)})")
    for service in args.services:
        _write_layer(
            ENV_DIR / f"{service}.env",
            shared_per_service[service],
            f"{service}, every environment",
        )
        for environment in environments:
            _write_layer(
                ENV_DIR / f"{service}.{environment}.env",
                per_env[(service, environment)],
                f"{service}, {environment} only",
            )
    if args.write_secrets and secrets_found:
        for environment in environments:
            values = {
                k: v[environment] for k, v in secrets_found.items() if environment in v
            }
            if values:
                _write_layer(
                    ENV_DIR / f"secrets.{environment}.env",
                    values,
                    f"LOCAL ONLY — gitignored — {environment} secrets",
                )
    print("\n✅ layer files rewritten. Review with `git diff` before committing.")
    return 0


def _write_layer(path: Path, variables: dict[str, str], description: str) -> None:
    lines = [
        f"# {description}.",
        "# Generated by devops/scripts/railway_env.py factor --write.",
        "",
    ]
    for key in sorted(variables):
        lines.append(f"{key}={variables[key]}")
    path.write_text("\n".join(lines) + "\n")
    print(f"  wrote {_rel(path)} ({len(variables)} key(s))")


# --------------------------------------------------------------------------
# entry point
# --------------------------------------------------------------------------

def build_parser(project: dict) -> argparse.ArgumentParser:
    services = service_names(project)
    environments = environment_names(project)

    parser = argparse.ArgumentParser(
        prog="railway-env.sh",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p, with_environment=True):
        p.add_argument(
            "-s", "--service", dest="services", action="append", choices=services,
            help="limit to one service (repeatable, default: all)",
        )
        if with_environment:
            p.add_argument(
                "-e", "--environment", choices=environments,
                default=default_environment(project),
                help=f"Railway environment (default: {default_environment(project)})",
            )

    p_resolve = sub.add_parser("resolve", help="print the merged variables")
    add_common(p_resolve)
    p_resolve.add_argument("--format", choices=("table", "env", "json"), default="table")
    p_resolve.add_argument(
        "--no-secrets", action="store_true",
        help="ignore the gitignored secrets.* layers",
    )
    p_resolve.set_defaults(func=cmd_resolve)

    p_diff = sub.add_parser("diff", help="compare the layers against Railway")
    add_common(p_diff)
    p_diff.add_argument(
        "--exit-code", action="store_true",
        help="exit 1 when Railway differs (for CI)",
    )
    p_diff.set_defaults(func=cmd_diff)

    p_sync = sub.add_parser("sync", help="push the layers to Railway")
    add_common(p_sync)
    p_sync.add_argument("-n", "--dry-run", action="store_true")
    p_sync.add_argument("-y", "--yes", action="store_true", help="skip the prompt")
    p_sync.add_argument(
        "--skip-deploys", action="store_true",
        help="stage the change without triggering a redeploy",
    )
    p_sync.add_argument(
        "--force", action="store_true",
        help="push every variable without reading the current state first",
    )
    p_sync.set_defaults(func=cmd_sync)

    p_check = sub.add_parser("check", help="lint the tracked layer files")
    p_check.set_defaults(func=cmd_check, services=None, environment=None)

    p_factor = sub.add_parser(
        "factor", help="import live variables and collapse the duplicates"
    )
    add_common(p_factor, with_environment=False)
    p_factor.add_argument(
        "--environments", nargs="+", choices=environments,
        help=f"environments to compare (default: {' '.join(environments)})",
    )
    p_factor.add_argument("--write", action="store_true", help="rewrite the layer files")
    p_factor.add_argument(
        "--write-secrets", action="store_true",
        help="also write secrets.<env>.env locally (gitignored)",
    )
    p_factor.set_defaults(func=cmd_factor, environment=None)

    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        project = load_project()
        parser = build_parser(project)
        args = parser.parse_args(argv)
        if getattr(args, "services", None) is None and args.command != "check":
            args.services = service_names(project)
        return args.func(args, project)
    except ToolError as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
