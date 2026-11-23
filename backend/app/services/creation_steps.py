"""Reading a hero's steps: the one query every part of the pipeline repeats."""
from typing import Optional

from sqlalchemy.orm import Session

from app.models import CreationStep


def find_step(db: Session, creation_id: str, step_name: str) -> Optional[CreationStep]:
    """The hero's step called `step_name`, or None."""
    return db.query(CreationStep).filter(
        CreationStep.creation_id == creation_id,
        CreationStep.step_name == step_name,
    ).first()
