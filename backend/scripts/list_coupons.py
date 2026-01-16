#!/usr/bin/env python3
"""Script to list all available coupons.

Usage:
    python scripts/list_coupons.py
"""
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models import Coupon


def main():
    db = SessionLocal()
    
    try:
        coupons = db.query(Coupon).order_by(Coupon.created_at.desc()).all()
        
        if not coupons:
            print("No coupons found in database.")
            return
        
        print(f"\nFound {len(coupons)} coupon(s):\n")
        print("-" * 80)
        
        for coupon in coupons:
            status = "✅ ACTIVE" if coupon.is_active else "❌ INACTIVE"
            expires = coupon.expires_at.strftime("%Y-%m-%d %H:%M:%S") if coupon.expires_at else "Never"
            usage = f"{coupon.current_uses}/{coupon.max_uses}"
            
            # Check if expired
            if coupon.expires_at and coupon.expires_at < datetime.utcnow():
                status = "⏰ EXPIRED"
            
            # Check if maxed out
            if coupon.current_uses >= coupon.max_uses:
                status = "🔒 MAXED OUT" if coupon.is_active else status
            
            print(f"Code: {coupon.code}")
            print(f"  Credits: {coupon.credit_amount}")
            print(f"  Status: {status}")
            print(f"  Usage: {usage}")
            print(f"  Expires: {expires}")
            print(f"  Created: {coupon.created_at.strftime('%Y-%m-%d %H:%M:%S')}")
            print("-" * 80)
    
    finally:
        db.close()


if __name__ == "__main__":
    main()
