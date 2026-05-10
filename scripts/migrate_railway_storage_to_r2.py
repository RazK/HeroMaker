"""
One-time migration: copy all files from Railway Storage → Cloudflare R2.

Usage:
    # Set source (Railway Storage) credentials:
    export SRC_S3_BUCKET=<railway-bucket-name>
    export SRC_S3_ENDPOINT=https://storage.railway.app
    export SRC_S3_ACCESS_KEY_ID=<railway-key-id>
    export SRC_S3_SECRET_ACCESS_KEY=<railway-secret>

    # Set destination (Cloudflare R2) credentials:
    export DST_S3_BUCKET=heromaker-prod
    export DST_S3_ENDPOINT=https://e7467ddc40c508926b389e666f5356bc.r2.cloudflarestorage.com
    export DST_S3_ACCESS_KEY_ID=<r2-key-id>
    export DST_S3_SECRET_ACCESS_KEY=<r2-secret>

    .venv/bin/python scripts/migrate_railway_storage_to_r2.py

Notes:
- Thumbnails (thumb_*) are skipped — they regenerate on demand.
- Already-migrated files are skipped (idempotent).
- Run from the project root.
"""
import os
import sys

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    print("ERROR: boto3 not installed. Run: .venv/bin/pip install boto3")
    sys.exit(1)


def make_client(prefix: str):
    bucket = os.environ[f"{prefix}_S3_BUCKET"]
    endpoint = os.environ[f"{prefix}_S3_ENDPOINT"]
    key_id = os.environ[f"{prefix}_S3_ACCESS_KEY_ID"]
    secret = os.environ[f"{prefix}_S3_SECRET_ACCESS_KEY"]
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
    )
    return client, bucket


def list_all_objects(client, bucket: str) -> list[str]:
    keys = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def object_exists(client, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "404":
            return False
        raise


def main():
    missing = [
        v for v in [
            "SRC_S3_BUCKET", "SRC_S3_ENDPOINT", "SRC_S3_ACCESS_KEY_ID", "SRC_S3_SECRET_ACCESS_KEY",
            "DST_S3_BUCKET", "DST_S3_ENDPOINT", "DST_S3_ACCESS_KEY_ID", "DST_S3_SECRET_ACCESS_KEY",
        ] if not os.environ.get(v)
    ]
    if missing:
        print(f"ERROR: Missing environment variables: {', '.join(missing)}")
        print("See the script header for usage instructions.")
        sys.exit(1)

    src_client, src_bucket = make_client("SRC")
    dst_client, dst_bucket = make_client("DST")

    print(f"Source:      {src_bucket} @ {os.environ['SRC_S3_ENDPOINT']}")
    print(f"Destination: {dst_bucket} @ {os.environ['DST_S3_ENDPOINT']}")
    print()

    print("Listing source objects...")
    all_keys = list_all_objects(src_client, src_bucket)
    print(f"Found {len(all_keys)} objects in source bucket.")

    # Thumbnails regenerate on demand — skip them
    keys = [k for k in all_keys if not k.split("/")[-1].startswith("thumb_")]
    skipped_thumbs = len(all_keys) - len(keys)
    if skipped_thumbs:
        print(f"Skipping {skipped_thumbs} cached thumbnails (will regenerate on demand).")
    print()

    total = len(keys)
    copied = 0
    already_there = 0
    failed: list[str] = []

    for i, key in enumerate(keys, 1):
        print(f"[{i}/{total}] {key}", end=" ... ", flush=True)
        try:
            if object_exists(dst_client, dst_bucket, key):
                print("already exists, skipping")
                already_there += 1
                continue

            data = src_client.get_object(Bucket=src_bucket, Key=key)["Body"].read()
            dst_client.put_object(Bucket=dst_bucket, Key=key, Body=data)

            # Verify
            if object_exists(dst_client, dst_bucket, key):
                print(f"OK ({len(data):,} bytes)")
                copied += 1
            else:
                print("FAILED (verification failed)")
                failed.append(key)

        except Exception as e:
            print(f"FAILED ({e})")
            failed.append(key)

    print()
    print("=" * 60)
    print(f"Total objects:   {total}")
    print(f"Copied:          {copied}")
    print(f"Already in R2:   {already_there}")
    print(f"Failed:          {len(failed)}")

    if failed:
        print("\nFailed keys:")
        for k in failed:
            print(f"  {k}")
        sys.exit(1)
    else:
        print("\nAll files migrated successfully!")
        print("\nNext step: update Railway production env vars to point at R2:")
        print(f"  S3_BUCKET            = {dst_bucket}")
        print(f"  S3_ENDPOINT          = {os.environ['DST_S3_ENDPOINT']}")
        print(f"  S3_ACCESS_KEY_ID     = <your R2 key>")
        print(f"  S3_SECRET_ACCESS_KEY = <your R2 secret>")
        print(f"  S3_REGION            = auto")


if __name__ == "__main__":
    main()
