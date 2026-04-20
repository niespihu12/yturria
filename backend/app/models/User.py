from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.Token import Token


class UserRole(str, Enum):
    AGENT = "agent"
    SUPERVISOR = "supervisor"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    email: str = Field(index=True, unique=True, nullable=False)
    password: str = Field(nullable=False)
    name: str = Field(nullable=False)
    confirmed: bool = Field(default=False, nullable=False)
    role: UserRole = Field(default=UserRole.AGENT, nullable=False)
    mfa_enabled: bool = Field(default=False, nullable=False)
    mfa_failed_attempts: int = Field(default=0, nullable=False)
    mfa_locked_until: datetime | None = Field(default=None, nullable=True)
    deleted_at: datetime | None = Field(default=None, nullable=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)

    tokens: list["Token"] = Relationship(back_populates="user")
