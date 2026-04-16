from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class UserPhoneNumber(SQLModel, table=True):
    __tablename__ = "user_phone_numbers"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    phone_number_id: str = Field(index=True, unique=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)