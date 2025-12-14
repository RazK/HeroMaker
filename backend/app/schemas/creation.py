from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

class UserBase(BaseModel):
    username: str
    email: str

class UserCreate(UserBase):
    pass

class UserResponse(UserBase):
    id: str
    is_admin: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class TaskResponse(BaseModel):
    name: str
    status: str
    output_file: Optional[str] = None
    file_url: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class CreationBase(BaseModel):
    character_name: Optional[str] = None

class CreationCreate(CreationBase):
    pass

class CreationResponse(CreationBase):
    id: str
    status: str
    current_task: Optional[str] = None
    user_id: str
    created_at: datetime
    updated_at: datetime
    tasks: List[TaskResponse] = []
    
    class Config:
        from_attributes = True

