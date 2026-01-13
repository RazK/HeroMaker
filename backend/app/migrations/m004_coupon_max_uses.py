"""Migration: Add max_uses and current_uses columns to coupons table."""
from sqlalchemy import text, inspect
from sqlalchemy.orm import Session


def migrate(db: Session):
    """Add max_uses and current_uses columns to coupons table."""
    from app.migrations.runner import logger

    # Check existing columns
    inspector = inspect(db.bind)
    columns = [col['name'] for col in inspector.get_columns('coupons')]

    # Add max_uses column (default=1 for single-use)
    if 'max_uses' not in columns:
        db.execute(text("ALTER TABLE coupons ADD COLUMN max_uses INTEGER DEFAULT 1"))
        logger.info("Added max_uses column to coupons table")

    # Add current_uses column (default=0)
    if 'current_uses' not in columns:
        db.execute(text("ALTER TABLE coupons ADD COLUMN current_uses INTEGER DEFAULT 0"))
        # Update current_uses based on existing redemptions
        db.execute(text("""
            UPDATE coupons SET current_uses = (
                SELECT COUNT(*) FROM coupon_redemptions
                WHERE coupon_redemptions.coupon_id = coupons.id
            )
        """))
        logger.info("Added current_uses column to coupons table and synced with existing redemptions")

    db.commit()
