"""Migration: add creations.style, the look the painting is made in.

A key of app.services.openai.STYLES ("pixar", "lego", ...). Nullable, and NULL
means the default style, "pixar": every hero made before styles existed was
painted with that prompt, so no backfill is needed - the existing rows already
mean the right thing.

Idempotent, like the others: it only adds the column if it is missing.
"""
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session


def migrate(db: Session):
    columns = {c["name"] for c in inspect(db.bind).get_columns("creations")}
    if "style" not in columns:
        db.execute(text("ALTER TABLE creations ADD COLUMN style VARCHAR"))
        db.commit()
