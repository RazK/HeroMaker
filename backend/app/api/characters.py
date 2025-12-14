from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Creation
from app.services.auth import get_current_user
from app.api.creations import hydrate_creation_response

router = APIRouter()

@router.get("/")
def list_characters(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    # Public gallery
    query = db.query(Creation).filter(
        Creation.status == "completed",
        Creation.is_public == True
    )
    
    total = query.count()
    creations = query.order_by(Creation.created_at.desc()).offset(offset).limit(limit).all()
    
    # Transform to character response format (simplified creation response)
    characters = []
    for c in creations:
        resp = hydrate_creation_response(c, c.user_id)
        # Add gallery specific fields if needed
        characters.append(resp)
        
    return {
        "characters": characters,
        "total": total,
        "limit": limit,
        "offset": offset
    }

@router.get("/{creation_id}")
def get_character(
    creation_id: str,
    db: Session = Depends(get_db)
):
    creation = db.query(Creation).filter(
        Creation.id == creation_id,
        Creation.status == "completed"
    ).first()
    
    if not creation:
         # Try finding it even if not completed if owner? 
         # For now, characters endpoint implies completed/public
         return None
         
    return hydrate_creation_response(creation, creation.user_id)

