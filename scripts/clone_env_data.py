#!/usr/bin/env python
"""
Clone data from one Railway environment into another.

Copies the Postgres rows and the S3 objects so a non-production environment can
be worked on against realistic data - real creations, real names, real edge
cases - without touching production.

Usage:
    RAILWAY_API_TOKEN=... .venv/bin/python scripts/clone_env_data.py --from production --to staging
    ... --dry-run          show what would happen, change nothing
    ... --limit 20         only the N most recent creations (and their files)
    ... --skip-files       database rows only

Safety
------
The destination can never be production. The check is on the resolved
environment id, not the name passed in, so it holds even if environments are
renamed. The source is only ever read.
"""
import argparse
import json
import os
import sys
from typing import Dict, List

import requests

API = "https://backboard.railway.app/graphql/v2"
PROJECT_ID = "95711b3f-db5c-4521-99a7-c5caeb8005fc"
PRODUCTION_ENV_ID = "4e1101f9-bd77-4292-bd74-f1c6b9ec5522"
POSTGRES_SERVICE_ID = "0697cae9-2052-48fb-95f6-d9d72a6ad018"
BACKEND_SERVICE_ID = "3970a673-db5b-4b2d-9456-93acf1da09bf"

# Order matters: parents before children, so foreign keys resolve.
TABLES = ["users", "creations", "creation_steps", "coupons", "coupon_redemptions"]


def graphql(session: requests.Session, query: str, variables: dict) -> dict:
    resp = session.post(API, json={"query": query, "variables": variables}, timeout=30)
    body = resp.json()
    if "errors" in body:
        raise SystemExit(f"Railway API error: {json.dumps(body['errors'])[:300]}")
    return body["data"]


def environments(session: requests.Session) -> Dict[str, str]:
    data = graphql(
        session,
        "query($id: String!) { project(id: $id) { environments { edges { node { id name } } } } }",
        {"id": PROJECT_ID},
    )
    return {e["node"]["name"]: e["node"]["id"] for e in data["project"]["environments"]["edges"]}


def service_vars(session: requests.Session, env_id: str, service_id: str) -> dict:
    data = graphql(
        session,
        "query($p:String!,$e:String!,$s:String!){ variables(projectId:$p,environmentId:$e,serviceId:$s) }",
        {"p": PROJECT_ID, "e": env_id, "s": service_id},
    )
    return data["variables"]


def copy_tables(src_url: str, dst_url: str, limit: int, dry_run: bool) -> Dict[str, int]:
    import psycopg2
    import psycopg2.extras

    counts: Dict[str, int] = {}
    with psycopg2.connect(src_url) as src, psycopg2.connect(dst_url) as dst:
        src_cur = src.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        dst_cur = dst.cursor()

        # Which creations are in scope? Everything else follows from this.
        if limit:
            src_cur.execute("SELECT id FROM creations ORDER BY created_at DESC LIMIT %s", (limit,))
            creation_ids = [r["id"] for r in src_cur.fetchall()]
        else:
            creation_ids = None

        for table in TABLES:
            src_cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
            if src_cur.fetchone()["to_regclass"] is None:
                continue

            if creation_ids is not None and table == "creations":
                src_cur.execute("SELECT * FROM creations WHERE id = ANY(%s)", (creation_ids,))
            elif creation_ids is not None and table == "creation_steps":
                src_cur.execute("SELECT * FROM creation_steps WHERE creation_id = ANY(%s)", (creation_ids,))
            else:
                src_cur.execute(f"SELECT * FROM {table}")
            rows = src_cur.fetchall()
            counts[table] = len(rows)
            if dry_run or not rows:
                continue

            columns = list(rows[0].keys())
            dst_cur.execute(f"TRUNCATE {table} CASCADE")
            template = "(" + ",".join(["%s"] * len(columns)) + ")"
            psycopg2.extras.execute_values(
                dst_cur,
                f"INSERT INTO {table} ({','.join(columns)}) VALUES %s ON CONFLICT DO NOTHING",
                [[r[c] for c in columns] for r in rows],
                template=template,
            )
        if not dry_run:
            dst.commit()
    return counts


def copy_objects(src_vars: dict, dst_vars: dict, creation_ids: List[str], dry_run: bool,
                 extensions: List[str] = None) -> Dict[str, int]:
    import boto3

    bucket = src_vars["S3_BUCKET"]
    if dst_vars["S3_BUCKET"] != bucket:
        raise SystemExit("Cross-bucket copy is not implemented; both environments must share a bucket.")

    src_prefix = (src_vars.get("S3_PREFIX") or "").strip("/")
    dst_prefix = (dst_vars.get("S3_PREFIX") or "").strip("/")
    if src_prefix == dst_prefix:
        raise SystemExit(
            "Source and destination share a bucket AND a prefix - copying would overwrite the source. "
            "Set S3_PREFIX on the destination environment first."
        )

    s3 = boto3.client(
        "s3",
        endpoint_url=src_vars.get("S3_ENDPOINT", "https://storage.railway.app"),
        aws_access_key_id=src_vars["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=src_vars["S3_SECRET_ACCESS_KEY"],
        region_name=src_vars.get("S3_REGION", "auto"),
    )

    copied = skipped = 0
    total_bytes = 0
    wanted = set(creation_ids) if creation_ids else None
    exts = {e.lower().lstrip(".") for e in extensions} if extensions else None
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"{src_prefix}/" if src_prefix else ""):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            rel = key[len(src_prefix) + 1:] if src_prefix else key
            # Never re-copy the destination's own objects.
            if dst_prefix and key.startswith(f"{dst_prefix}/"):
                continue
            parts = rel.split("/")
            if len(parts) < 3:
                continue
            if wanted is not None and parts[1] not in wanted:
                continue
            if exts is not None and rel.rsplit(".", 1)[-1].lower() not in exts:
                continue
            dest_key = f"{dst_prefix}/{rel}" if dst_prefix else rel
            if dry_run:
                copied += 1
                total_bytes += obj["Size"]
                continue
            try:
                s3.copy_object(Bucket=bucket, Key=dest_key, CopySource={"Bucket": bucket, "Key": key})
                copied += 1
                total_bytes += obj["Size"]
                if copied % 50 == 0:
                    print(f"    ... {copied} objects, {total_bytes/1024/1024:.0f} MB", flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"  ! failed {key}: {exc}", file=sys.stderr)
                skipped += 1
    return {"copied": copied, "failed": skipped, "mb": total_bytes / 1024 / 1024}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src", default="production")
    ap.add_argument("--to", dest="dst", default="staging")
    ap.add_argument("--limit", type=int, default=0, help="only the N most recent creations (0 = all)")
    ap.add_argument("--skip-files", action="store_true")
    ap.add_argument("--files-only", action="store_true", help="copy objects only, leave the database alone")
    ap.add_argument("--ext", default="", help="comma-separated extensions to copy, e.g. jpg,png (default: all)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    token = os.environ.get("RAILWAY_API_TOKEN")
    if not token:
        raise SystemExit("RAILWAY_API_TOKEN is required (a workspace or account token).")

    session = requests.Session()
    session.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})

    envs = environments(session)
    for name in (args.src, args.dst):
        if name not in envs:
            raise SystemExit(f"No such environment: {name}. Available: {', '.join(sorted(envs))}")
    src_id, dst_id = envs[args.src], envs[args.dst]

    if dst_id == PRODUCTION_ENV_ID:
        raise SystemExit("Refusing to write to production. This script only ever populates non-production environments.")
    if src_id == dst_id:
        raise SystemExit("Source and destination are the same environment.")

    src_db = service_vars(session, src_id, POSTGRES_SERVICE_ID)["DATABASE_PUBLIC_URL"]
    dst_db = service_vars(session, dst_id, POSTGRES_SERVICE_ID)["DATABASE_PUBLIC_URL"]
    src_backend = service_vars(session, src_id, BACKEND_SERVICE_ID)
    dst_backend = service_vars(session, dst_id, BACKEND_SERVICE_ID)

    label = "DRY RUN - " if args.dry_run else ""
    print(f"{label}cloning {args.src} -> {args.dst}" + (f" (latest {args.limit} creations)" if args.limit else " (all data)"))

    if args.files_only:
        print("  database             skipped (--files-only)")
    else:
        counts = copy_tables(src_db, dst_db, args.limit, args.dry_run)
        for table, n in counts.items():
            print(f"  {table:<20} {n:>6} rows")

    if args.skip_files:
        print("  files                 skipped (--skip-files)")
        return

    creation_ids: List[str] = []
    if args.limit and not args.files_only:
        import psycopg2
        with psycopg2.connect(src_db) as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM creations ORDER BY created_at DESC LIMIT %s", (args.limit,))
            creation_ids = [r[0] for r in cur.fetchall()]

    exts = [e for e in args.ext.split(",") if e] or None
    result = copy_objects(src_backend, dst_backend, creation_ids, args.dry_run, exts)
    print(f"  s3 objects           {result['copied']:>6} copied ({result['mb']:.0f} MB), {result['failed']} failed")


if __name__ == "__main__":
    main()
