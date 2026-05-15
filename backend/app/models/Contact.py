from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class Contact(SQLModel, table=True):
    __tablename__ = "contacts"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    name: str = Field(nullable=False)
    last_name: str = Field(default="", nullable=False)
    specialty: str = Field(default="", nullable=False)
    phone: str = Field(default="", nullable=False)
    email: str = Field(default="", nullable=False)
    whatsapp: str = Field(default="", nullable=False)
    active: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
