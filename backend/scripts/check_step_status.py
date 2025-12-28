#!/usr/bin/env python3
"""Quick script to check step status in database vs what frontend would see."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Creation, CreationStep
from app.schemas.creation import CreationResponse

# Connect to local SQLite
engine = create_engine("sqlite:///./data/db/heromaker.db", connect_args={"check_same_thread": False})
Session = sessionmaker(bind=engine)
db = Session()

# Get a creation with openai_render step
creation = db.query(Creation).join(CreationStep).filter(
    CreationStep.step_name == "openai_render",
    CreationStep.status == "completed"
).first()

if not creation:
    print("No creation found with completed openai_render step")
    sys.exit(1)

print(f"Creation ID: {creation.id}")
print(f"Creation status: {creation.status}")
print("\nSteps in database:")
for step in creation.steps:
    if step.step_name == "openai_render":
        print(f"  {step.step_name}: status={step.status}, completed_at={step.completed_at}")

# Build API response
response = CreationResponse.from_creation(creation)
print("\nSteps in API response:")
for step in response.steps:
    if step.step_name == "openai_render":
        print(f"  {step.step_name}: status={step.status}, completed_at={step.completed_at}")

# Check if file exists
from app.utils.storage import get_storage
storage = get_storage()
file_exists = storage.file_exists("debug-user-uuid", creation.id, "rendered.png")
print(f"\nFile exists: {file_exists}")

if file_exists:
    file_url = storage.get_file_url("debug-user-uuid", creation.id, "rendered.png")
    print(f"File URL: {file_url}")

db.close()

