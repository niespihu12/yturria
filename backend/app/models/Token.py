from datetime import datetime, timedelta
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from app.models.User import User


class Token(SQLModel, table=True):
    __tablename__ = "tokens"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    token: str = Field(index=True, unique=True, nullable=False)
    purpose: str = Field(default="generic", index=True, nullable=False)
    user_id: str = Field(foreign_key="users.id", nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    expires_at: datetime = Field(
        default_factory=lambda: datetime.utcnow() + timedelta(minutes=10),
        index=True,
        nullable=False,
    )

    user: "User" = Relationship(back_populates="tokens")
