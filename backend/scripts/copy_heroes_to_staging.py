"""Copy chosen production heroes into staging: their database rows and their files.

Use only with Raz's yes for those heroes (CLAUDE.md: "the two databases stay separate";
copying creations between them needs his permission, each time).

    copy_heroes_to_staging.py --prod-db URL --staging-db URL \
        --hero <creation id> [--hero ...] --owner <staging user id> [--dry-run]

For each hero:
- the `creations` row and its `creation_steps` rows are read from PRODUCTION's database
  and inserted into STAGING's, under the given staging owner. Same ids, so a second run
  skips heroes already there.
- `class_id` is dropped: production's classes do not exist on staging. The hero is made
  public and starred (Editors' choice) so it shows in staging's gallery.
- every object under `<prod owner>/<creation id>/` in production's bucket is copied to
  `<staging owner>/<creation id>/` in staging's bucket.

Production is only read: this script never writes to its database or bucket.
Only columns that exist in both databases are copied, so a schema that is ahead on
staging still works.

Credentials come from the environment (the workflow reads them from Railway, masked):
SRC_* is production's bucket, DST_* staging's.
"""
import argparse
import json
import os
import sys

import boto3
import psycopg2
import psycopg2.extras
from botocore.config import Config


def client(prefix):
    return boto3.client(
        "s3",
        endpoint_url=os.environ[f"{prefix}_ENDPOINT"],
        region_name=os.environ.get(f"{prefix}_REGION") or "auto",
        aws_access_key_id=os.environ[f"{prefix}_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ[f"{prefix}_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", retries={"max_attempts": 5}),
    )


def columns(cur, table):
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name = %s", (table,))
    return {r[0] for r in cur.fetchall()}


def insert(cur, table, row, cols):
    keep = [c for c in row if c in cols]
    vals = [psycopg2.extras.Json(row[c]) if isinstance(row[c], (dict, list)) else row[c] for c in keep]
    cur.execute(
        f"INSERT INTO {table} ({', '.join(keep)}) VALUES ({', '.join(['%s'] * len(keep))}) ON CONFLICT (id) DO NOTHING",
        vals,
    )
    return cur.rowcount


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prod-db", required=True)
    ap.add_argument("--staging-db", required=True)
    ap.add_argument("--hero", action="append", required=True, help="production creation id (repeat)")
    ap.add_argument("--owner", required=True, help="staging user id that will own the copies")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    heroes = [h.strip() for arg in a.hero for h in arg.split(",") if h.strip()]

    src_bucket, dst_bucket = os.environ["SRC_BUCKET"], os.environ["DST_BUCKET"]
    src, dst = client("SRC"), client("DST")

    prod = psycopg2.connect(a.prod_db)
    prod.set_session(readonly=True)
    stg = psycopg2.connect(a.staging_db)
    with prod.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as pc, stg.cursor() as sc:
        sc.execute("SELECT 1 FROM users WHERE id = %s", (a.owner,))
        if not sc.fetchone():
            sys.exit(f"No staging user {a.owner}")
        ccols, scols = columns(sc, "creations"), columns(sc, "creation_steps")
        report = []
        for cid in heroes:
            pc.execute("SELECT * FROM creations WHERE id = %s AND deleted_at IS NULL", (cid,))
            c = pc.fetchone()
            if not c:
                report.append((cid, "not found in production"))
                continue
            prod_owner = c["user_id"]
            c = dict(c, user_id=a.owner, class_id=None, is_public=True)
            if "featured" in ccols:
                c["featured"] = True
            pc.execute("SELECT * FROM creation_steps WHERE creation_id = %s", (cid,))
            steps = [dict(s) for s in pc.fetchall()]
            keys = []
            for page in src.get_paginator("list_objects_v2").paginate(Bucket=src_bucket, Prefix=f"{prod_owner}/{cid}/"):
                keys += [o["Key"] for o in page.get("Contents", [])]
            if a.dry_run:
                report.append((cid, f"would copy: '{c.get('character_name')}', {len(steps)} steps, {len(keys)} files"))
                continue
            added = insert(sc, "creations", c, ccols)
            for s in steps:
                insert(sc, "creation_steps", s, scols)
            for k in keys:
                body = src.get_object(Bucket=src_bucket, Key=k)
                extra = {"ContentType": body["ContentType"]} if body.get("ContentType") else {}
                dst.put_object(Bucket=dst_bucket, Key=f"{a.owner}/{k[len(prod_owner) + 1:]}", Body=body["Body"].read(), **extra)
            stg.commit()
            report.append((cid, f"{'copied' if added else 'already on staging, files refreshed'}: "
                                f"'{c.get('character_name')}', {len(steps)} steps, {len(keys)} files"))
    for cid, msg in report:
        print(cid, msg)
    print(json.dumps({"heroes": len(heroes), "dry_run": a.dry_run}))


if __name__ == "__main__":
    main()
