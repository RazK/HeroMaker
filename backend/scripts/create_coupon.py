#!/usr/bin/env python3
"""Admin script to create coupon codes.

Usage:
    python scripts/create_coupon.py --code HERO-TEST100 --tokens 100
    python scripts/create_coupon.py --code WELCOME50 --tokens 50 --expires 2025-12-31
    python scripts/create_coupon.py --code LAUNCH10 --tokens 25 --max-uses 10
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.services.coupons import create_coupon, CouponError


def main():
    parser = argparse.ArgumentParser(description="Create a coupon code")
    parser.add_argument("--code", required=True, help="Coupon code (e.g., HERO-TEST100)")
    parser.add_argument("--tokens", type=int, required=True, help="Number of tokens to award")
    parser.add_argument("--max-uses", type=int, default=1, help="Max redemptions (default: 1)")
    parser.add_argument("--expires", help="Expiration date (YYYY-MM-DD format)")
    parser.add_argument("--inactive", action="store_true", help="Create as inactive")

    args = parser.parse_args()

    # Parse expiration date if provided
    expires_at = None
    if args.expires:
        try:
            expires_at = datetime.strptime(args.expires, "%Y-%m-%d")
        except ValueError:
            print(f"Error: Invalid date format '{args.expires}'. Use YYYY-MM-DD.")
            sys.exit(1)

    # Create database session
    db = SessionLocal()

    try:
        coupon = create_coupon(
            code=args.code,
            token_amount=args.tokens,
            db=db,
            max_uses=args.max_uses,
            expires_at=expires_at,
            is_active=not args.inactive
        )

        print(f"✅ Created coupon:")
        print(f"   Code: {coupon.code}")
        print(f"   Tokens: {coupon.token_amount}")
        print(f"   Max uses: {coupon.max_uses}")
        print(f"   Expires: {coupon.expires_at or 'Never'}")
        print(f"   Active: {coupon.is_active}")

    except CouponError as e:
        print(f"❌ Error: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
