"""Migration: add creations.featured, the admin's "Editors' choice" star.

The gallery opens on Editors' choice: the heroes an admin has starred. Raz:
"Star all by default; I'll unstar some as admin." So when the column is added,
every hero that is finished and not deleted at that moment is starred. Heroes
made after this start unstarred - an admin curates the front page, and an
unreviewed upload does not appear there until someone stars it.

Finished means what Creation.status calls "completed": the last pipeline step
completed, and no step failed or is still processing.

The backfill runs only in the call that adds the column. Running the migration
again (the runner records it, but the function is idempotent anyway) must
never re-star a hero an admin has since unstarred.

On a brand-new database, Base.metadata.create_all makes the column first and
there is nothing to star, so this does nothing.
"""
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.config.steps import get_last_step


def migrate(db: Session):
    columns = {c["name"] for c in inspect(db.bind).get_columns("creations")}
    if "featured" in columns:
        return
    db.execute(text("ALTER TABLE creations ADD COLUMN featured BOOLEAN NOT NULL DEFAULT FALSE"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_creations_featured ON creations (featured)"))
    last = get_last_step()
    if last:
        db.execute(
            text(
                """
                UPDATE creations SET featured = :yes
                WHERE deleted_at IS NULL
                  AND EXISTS (
                    SELECT 1 FROM creation_steps s
                    WHERE s.creation_id = creations.id
                      AND s.step_name = :last AND s.status = 'completed'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM creation_steps s
                    WHERE s.creation_id = creations.id
                      AND s.status IN ('failed', 'processing')
                  )
                """
            ),
            {"yes": True, "last": last["name"]},
        )
    db.commit()
