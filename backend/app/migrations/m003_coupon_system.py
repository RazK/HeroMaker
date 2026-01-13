"""Migration: Create coupons and coupon_redemptions tables for token system."""
from sqlalchemy import text, inspect
from sqlalchemy.orm import Session


def migrate(db: Session):
    """Create coupons and coupon_redemptions tables."""
    from app.config.settings import DATABASE_URL
    from app.migrations.runner import logger

    is_postgres = DATABASE_URL.startswith("postgresql")

    # Check existing tables
    inspector = inspect(db.bind)
    existing_tables = inspector.get_table_names()

    # Create coupons table
    if 'coupons' not in existing_tables:
        if is_postgres:
            db.execute(text("""
                CREATE TABLE coupons (
                    id VARCHAR(36) PRIMARY KEY,
                    code VARCHAR(255) UNIQUE NOT NULL,
                    token_amount INTEGER NOT NULL,
                    expires_at TIMESTAMP,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.execute(text("CREATE INDEX ix_coupons_code ON coupons(code)"))
        else:
            db.execute(text("""
                CREATE TABLE coupons (
                    id TEXT PRIMARY KEY,
                    code TEXT UNIQUE NOT NULL,
                    token_amount INTEGER NOT NULL,
                    expires_at TIMESTAMP,
                    is_active BOOLEAN DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """))
            db.execute(text("CREATE INDEX ix_coupons_code ON coupons(code)"))
        logger.info("Created coupons table")

    # Create coupon_redemptions table
    if 'coupon_redemptions' not in existing_tables:
        if is_postgres:
            db.execute(text("""
                CREATE TABLE coupon_redemptions (
                    id VARCHAR(36) PRIMARY KEY,
                    coupon_id VARCHAR(36) NOT NULL REFERENCES coupons(id),
                    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
                    redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(coupon_id, user_id)
                )
            """))
            db.execute(text("CREATE INDEX ix_coupon_redemptions_coupon_id ON coupon_redemptions(coupon_id)"))
            db.execute(text("CREATE INDEX ix_coupon_redemptions_user_id ON coupon_redemptions(user_id)"))
        else:
            db.execute(text("""
                CREATE TABLE coupon_redemptions (
                    id TEXT PRIMARY KEY,
                    coupon_id TEXT NOT NULL REFERENCES coupons(id),
                    user_id TEXT NOT NULL REFERENCES users(id),
                    redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(coupon_id, user_id)
                )
            """))
            db.execute(text("CREATE INDEX ix_coupon_redemptions_coupon_id ON coupon_redemptions(coupon_id)"))
            db.execute(text("CREATE INDEX ix_coupon_redemptions_user_id ON coupon_redemptions(user_id)"))
        logger.info("Created coupon_redemptions table")

    db.commit()
