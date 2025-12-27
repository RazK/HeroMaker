"""Migration: Rename chatgpt_render step to openai_render."""
from sqlalchemy import text
from sqlalchemy.orm import Session


def migrate(db: Session):
    """Update all chatgpt_render step names to openai_render."""
    result = db.execute(
        text("UPDATE creation_steps SET step_name = 'openai_render' WHERE step_name = 'chatgpt_render'")
    )
    count = result.rowcount
    if count > 0:
        from app.migrations.runner import logger
        logger.info(f"Updated {count} records from 'chatgpt_render' to 'openai_render'")
    db.commit()

