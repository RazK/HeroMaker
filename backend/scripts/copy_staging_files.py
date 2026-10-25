"""Give staging its own files: copy them out of the bucket it shared with production.

Until 2026-10-25 staging stored its files in PRODUCTION's bucket. Nothing
kept the two apart but the user id at the start of every key
(`<user_id>/<creation_id>/<file>`): each environment has its own database,
so its own users. When Railway rotated bucket credentials, staging's keys
(references to its own, empty bucket) could no longer read them.

This copies, from the production bucket into staging's own:

    every object under `<user_id>/` for each user in STAGING's database

and nothing else. Production's own users, its database backups and the
pipeline result cache (`_pipeline_result_cache/`, made from production
users' drawings too) are left where they are. The production bucket is only
listed and read: this script never writes to it or deletes from it.

Idempotent: an object already in staging's bucket with the same size is
skipped. --dry-run counts without writing anything.

At the end it checks the result: every live staging hero's drawing must be
in staging's bucket, unless it was missing from production's too.

Credentials come from the environment (the workflow reads them from Railway;
they are never printed): SRC_* is the production bucket, DST_* staging's.
"""
import argparse
import os
import sys

import boto3
import psycopg2
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


def keys_under(s3, bucket, prefix):
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            yield obj["Key"], obj["Size"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--database-url", required=True, help="STAGING's database")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src_bucket, dst_bucket = os.environ["SRC_BUCKET"], os.environ["DST_BUCKET"]
    if src_bucket == dst_bucket:
        sys.exit("Source and destination are the same bucket: nothing to do (already moved?).")

    with psycopg2.connect(args.database_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM users")
        users = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT user_id, id FROM creations WHERE deleted_at IS NULL")
        heroes = cur.fetchall()
    print(f"Staging's database: {len(users)} users, {len(heroes)} live heroes")

    src, dst = client("SRC"), client("DST")
    copied = skipped = objects = 0
    copied_bytes = 0
    for uid in users:
        prefix = f"{uid}/"
        have = {k: s for k, s in keys_under(dst, dst_bucket, prefix)}
        for key, size in keys_under(src, src_bucket, prefix):
            objects += 1
            if have.get(key) == size:
                skipped += 1
                continue
            if not args.dry_run:
                body = src.get_object(Bucket=src_bucket, Key=key)
                extra = {"ContentType": body["ContentType"]} if body.get("ContentType") else {}
                dst.put_object(Bucket=dst_bucket, Key=key, Body=body["Body"].read(), **extra)
            copied += 1
            copied_bytes += size
    verb = "Would copy" if args.dry_run else "Copied"
    print(f"{verb} {copied} objects ({copied_bytes / 1e6:.1f} MB); {skipped} already there; {objects} found under staging's users")

    # The check: every live staging hero's drawing is in staging's bucket now.
    missing_both = missing_dst = 0
    for uid, cid in heroes:
        key = f"{uid}/{cid}/original.jpg"
        in_dst = any(True for _ in keys_under(dst, dst_bucket, key))
        if in_dst:
            continue
        in_src = any(True for _ in keys_under(src, src_bucket, key))
        if in_src:
            missing_dst += 1
        else:
            missing_both += 1
    print(f"Check: {len(heroes) - missing_dst - missing_both} of {len(heroes)} live heroes have their drawing in staging's bucket; "
          f"{missing_both} had none in production's bucket either")
    if missing_dst and not args.dry_run:
        sys.exit(f"{missing_dst} heroes' drawings are in production's bucket but not staging's: the copy is incomplete.")


if __name__ == "__main__":
    main()
