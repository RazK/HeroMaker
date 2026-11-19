#!/usr/bin/env python3
"""
Guard for the product knowledge base (docs/product/README.md).

Fails when:
- a feature-flag / experiment key used in the app's code has no experiment
  file with that `flag_key` (docs/product/experiments/E-NNN-*.md);
- an experiment names a hypothesis that does not exist, or a hypothesis names
  an experiment that does not exist, or the two do not name each other;
- a hypothesis or experiment header is malformed (missing field, unknown
  status/area/door, id not matching the file name, priority not equal to
  impact x uncertainty);
- a hypothesis is missing from the index, docs/product/HYPOTHESES.md.

With no flags in the code (today) the flag part passes trivially.

Standard library only:  python3 devops/scripts/product_docs_check.py [--root DIR]
Tests:                  python3 devops/scripts/test_product_docs_check.py
"""
import argparse
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

PRODUCT = Path("docs/product")
# Where the app's code lives: the frontend and the games it serves.
CODE_GLOBS = ("frontend/src/**/*", "games/*/src/**/*")
CODE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs"}

HYPOTHESIS_FIELDS = (
    "id", "title", "status", "area", "segment", "statement", "metric", "threshold",
    "test", "sample", "duration", "impact", "uncertainty", "priority", "experiments",
)
HYPOTHESIS_STATUS = {"untested", "testing", "supported", "rejected", "inconclusive"}
AREAS = {"value", "acquisition", "activation", "payment", "retention", "referral", "toy", "class", "events"}
DOORS = {"family", "gift/birthday", "class", "fair/museum", "ad", "any"}

EXPERIMENT_FIELDS = (
    "id", "title", "status", "hypotheses", "flag_key", "variants", "audience", "share",
    "primary_metric", "guardrails", "sample", "stop_date", "result", "decision", "closed",
)
EXPERIMENT_STATUS = {"draft", "approved", "running", "closed", "abandoned"}

H_ID = re.compile(r"^H-\d{3}$")
E_ID = re.compile(r"^E-\d{3}$")
# The analytics allow-list's slug (backend/app/services/analytics.py SLUG_RE):
# a key rides in the `variants` map, so it has to be one.
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")

# How a flag key appears in code (docs/product/experiments/README.md).
_Q = r"""['"`]([^'"`\s]+)['"`]"""
FLAG_PATTERNS = (
    re.compile(
        r"\b(?:isFeatureEnabled|getFeatureFlag|getFeatureFlagPayload|useFeatureFlagEnabled"
        r"|useFeatureFlagVariantKey|useFeatureFlagPayload|experiment)\(\s*" + _Q
    ),
    re.compile(r"\bvariants\[\s*" + _Q + r"\s*\]"),
    re.compile(r"\bvariants\.([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)"),
)


def front_matter(path: Path) -> Dict[str, object]:
    """The YAML header: `key: value`, `key: [a, b]`, and one level of `key:` + indented `sub: value`."""
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("no YAML header (the file must start with ---)")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        raise ValueError("YAML header is not closed with ---")
    data: Dict[str, object] = {}
    parent = None
    for raw in lines[1:end]:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        nested = raw.startswith((" ", "\t"))
        key, sep, value = raw.strip().partition(":")
        if not sep:
            raise ValueError(f"cannot read header line: {raw!r}")
        key, value = key.strip(), value.strip()
        if nested:
            if parent is None:
                raise ValueError(f"indented line with no parent: {raw!r}")
            data[parent][key] = _value(value)  # type: ignore[index]
        elif value == "":
            data[key], parent = {}, key
        else:
            data[key], parent = _value(value), None
    return data


def _value(text: str):
    if text.startswith("[") and text.endswith("]"):
        return [_unquote(x.strip()) for x in text[1:-1].split(",") if x.strip()]
    return _unquote(text)


def _unquote(text: str) -> str:
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text


def flag_keys_in_code(root: Path) -> Dict[str, List[str]]:
    """Every flag key the code uses -> where (file:line). Test files are left out."""
    found: Dict[str, List[str]] = {}
    for pattern in CODE_GLOBS:
        for path in sorted(root.glob(pattern)):
            if path.suffix not in CODE_SUFFIXES or not path.is_file():
                continue
            rel = path.relative_to(root)
            if "node_modules" in rel.parts or "dist" in rel.parts or ".test." in path.name:
                continue
            for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                for rx in FLAG_PATTERNS:
                    for key in rx.findall(line):
                        found.setdefault(key, []).append(f"{rel}:{n}")
    return found


def _as_int(value, field: str, where: str, problems: List[str]):
    try:
        return int(str(value))
    except ValueError:
        problems.append(f"{where}: {field} must be a whole number, not {value!r}")
        return None


def check(root: Path) -> List[str]:
    problems: List[str] = []
    product = root / PRODUCT

    hypotheses: Dict[str, Tuple[Path, Dict]] = {}
    for path in sorted((product / "hypotheses").glob("*.md")):
        where = str(path.relative_to(root))
        try:
            h = front_matter(path)
        except ValueError as e:
            problems.append(f"{where}: {e}")
            continue
        missing = [f for f in HYPOTHESIS_FIELDS if f not in h]
        if missing:
            problems.append(f"{where}: missing {', '.join(missing)}")
            continue
        hid = str(h["id"])
        if not H_ID.match(hid) or not path.name.startswith(hid + "-"):
            problems.append(f"{where}: id {hid!r} must be H-NNN and start the file name")
        if hid in hypotheses:
            problems.append(f"{where}: id {hid} is also used by {hypotheses[hid][0].name}")
        hypotheses[hid] = (path, h)
        if h["status"] not in HYPOTHESIS_STATUS:
            problems.append(f"{where}: status {h['status']!r} is not one of {sorted(HYPOTHESIS_STATUS)}")
        if h["area"] not in AREAS:
            problems.append(f"{where}: area {h['area']!r} is not one of {sorted(AREAS)}")
        seg = h["segment"] if isinstance(h["segment"], dict) else {}
        for part in ("drawer", "payer", "door"):
            if not seg.get(part):
                problems.append(f"{where}: segment needs {part}")
        if seg.get("door") and seg["door"] not in DOORS:
            problems.append(f"{where}: segment door {seg['door']!r} is not one of {sorted(DOORS)}")
        th = h["threshold"] if isinstance(h["threshold"], dict) else {}
        if not th.get("supported") or not th.get("rejected"):
            problems.append(f"{where}: threshold needs supported and rejected")
        if not str(h["statement"]).startswith("We believe "):
            problems.append(f"{where}: statement must read 'We believe <segment> will <behaviour> ...'")
        if not isinstance(h["experiments"], list):
            problems.append(f"{where}: experiments must be a list, e.g. [] or [E-001]")
        impact = _as_int(h["impact"], "impact", where, problems)
        unc = _as_int(h["uncertainty"], "uncertainty", where, problems)
        pri = _as_int(h["priority"], "priority", where, problems)
        for name, v in (("impact", impact), ("uncertainty", unc)):
            if v is not None and not 1 <= v <= 5:
                problems.append(f"{where}: {name} must be 1 to 5")
        if None not in (impact, unc, pri) and pri != impact * unc:
            problems.append(f"{where}: priority {pri} is not impact x uncertainty = {impact * unc}")

    experiments: Dict[str, Tuple[Path, Dict]] = {}
    flag_owner: Dict[str, str] = {}
    for path in sorted((product / "experiments").glob("E-*.md")):
        where = str(path.relative_to(root))
        try:
            e = front_matter(path)
        except ValueError as err:
            problems.append(f"{where}: {err}")
            continue
        missing = [f for f in EXPERIMENT_FIELDS if f not in e]
        if missing:
            problems.append(f"{where}: missing {', '.join(missing)}")
            continue
        eid = str(e["id"])
        if not E_ID.match(eid) or not path.name.startswith(eid + "-"):
            problems.append(f"{where}: id {eid!r} must be E-NNN and start the file name")
        if eid in experiments:
            problems.append(f"{where}: id {eid} is also used by {experiments[eid][0].name}")
        experiments[eid] = (path, e)
        if e["status"] not in EXPERIMENT_STATUS:
            problems.append(f"{where}: status {e['status']!r} is not one of {sorted(EXPERIMENT_STATUS)}")
        named = e["hypotheses"] if isinstance(e["hypotheses"], list) else []
        if not named:
            problems.append(f"{where}: hypotheses must name at least one, e.g. [H-001]")
        key = str(e["flag_key"])
        if key != "none":
            if not SLUG.match(key):
                problems.append(f"{where}: flag_key {key!r} must be a slug (a-z, 0-9, - and _, 40 at most) or none")
            if key in flag_owner:
                problems.append(f"{where}: flag_key {key!r} is also {flag_owner[key]}'s")
            flag_owner.setdefault(key, eid)

    # Links, both ways.
    for eid, (path, e) in experiments.items():
        where = str(path.relative_to(root))
        for hid in e["hypotheses"] if isinstance(e["hypotheses"], list) else []:
            if hid not in hypotheses:
                problems.append(f"{where}: names hypothesis {hid}, which does not exist")
            elif eid not in hypotheses[hid][1]["experiments"]:
                problems.append(f"{hypotheses[hid][0].relative_to(root)}: tested by {eid}, so its experiments must list {eid}")
    for hid, (path, h) in hypotheses.items():
        where = str(path.relative_to(root))
        for eid in h["experiments"] if isinstance(h["experiments"], list) else []:
            if eid not in experiments:
                problems.append(f"{where}: names experiment {eid}, which does not exist")
            elif hid not in experiments[eid][1]["hypotheses"]:
                problems.append(f"{experiments[eid][0].relative_to(root)}: {hid} lists it, so its hypotheses must list {hid}")

    index = product / "HYPOTHESES.md"
    if hypotheses:
        listed = set(re.findall(r"H-\d{3}", index.read_text(encoding="utf-8"))) if index.exists() else set()
        for hid in sorted(set(hypotheses) - listed):
            problems.append(f"{PRODUCT / 'HYPOTHESES.md'}: {hid} is not in the index")

    # Every flag key in the code has its experiment.
    for key, places in sorted(flag_keys_in_code(root).items()):
        if key not in flag_owner:
            problems.append(
                f"{places[0]}: flag key {key!r} has no experiment file with flag_key: {key}"
                f" (docs/product/experiments/README.md)" + (f", also used at {len(places) - 1} more place(s)" if len(places) > 1 else "")
            )
    return problems


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", default=Path(__file__).resolve().parents[2], type=Path,
                        help="the repository root (default: this checkout)")
    args = parser.parse_args(argv)
    problems = check(args.root)
    for p in problems:
        print(f"::error title=product docs::{p}" if "GITHUB_ACTIONS" in os.environ else p)
    if problems:
        print(f"{len(problems)} problem(s) in the product docs.", file=sys.stderr)
        return 1
    n_h = len(list((args.root / PRODUCT / "hypotheses").glob("*.md")))
    n_e = len(list((args.root / PRODUCT / "experiments").glob("E-*.md")))
    n_f = len(flag_keys_in_code(args.root))
    print(f"product docs OK: {n_h} hypotheses, {n_e} experiments, {n_f} flag key(s) in the code.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
