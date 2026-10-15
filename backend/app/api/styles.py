"""The painting styles a hero can be made in. Public: the picker shows them
before anyone has paid for anything."""
from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import openai as openai_service

router = APIRouter()


class StyleResponse(BaseModel):
    key: str
    label: str


@router.get("/api/styles", response_model=List[StyleResponse])
def list_styles():
    """Every style, in picker order. The first is the default. Prompts stay
    server-side: they are ours to tune, not part of the API."""
    return openai_service.list_styles()
