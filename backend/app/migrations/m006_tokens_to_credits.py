"""Migration: Rename tokens to credits in users and coupons tables."""
from sqlalchemy import text, inspect
from sqlalchemy.orm import Session
from app.config.settings import DATABASE_URL
from app.migrations.runner import logger


def migrate(db: Session):
    """Rename tokens column to credits in users table, and token_amount to credit_amount in coupons table."""
    is_postgres = DATABASE_URL.startswith("postgresql")

    inspector = inspect(db.bind)

    # Rename tokens to credits in users table
    columns = [col['name'] for col in inspector.get_columns('users')]
    if 'tokens' in columns and 'credits' not in columns:
        if is_postgres:
            db.execute(text("ALTER TABLE users RENAME COLUMN tokens TO credits"))
        else:
            # SQLite 3.25.0+ supports RENAME COLUMN
            db.execute(text("ALTER TABLE users RENAME COLUMN tokens TO credits"))
        logger.info("Renamed tokens column to credits in users table")

    # Rename token_amount to credit_amount in coupons table
    if 'coupons' in inspector.get_table_names():
        coupon_columns = [col['name'] for col in inspector.get_columns('coupons')]
        if 'token_amount' in coupon_columns and 'credit_amount' not in coupon_columns:
            if is_postgres:
                db.execute(text("ALTER TABLE coupons RENAME COLUMN token_amount TO credit_amount"))
            else:
                # SQLite 3.25.0+ supports RENAME COLUMN
                db.execute(text("ALTER TABLE coupons RENAME COLUMN token_amount TO credit_amount"))
            logger.info("Renamed token_amount column to credit_amount in coupons table")

    db.commit()
