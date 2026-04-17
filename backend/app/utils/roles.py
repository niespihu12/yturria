from __future__ import annotations

from typing import Any

from app.models.User import UserRole

PLATFORM_SUPER_ADMIN_EMAILS = frozenset(
    {
        "niespihu12@gmail.com",
    }
)


def normalize_email(value: str) -> str:
    return value.strip().lower()


def is_platform_super_admin_email(email: str) -> bool:
    return normalize_email(email) in PLATFORM_SUPER_ADMIN_EMAILS


def resolve_default_user_role(email: str) -> UserRole:
    if is_platform_super_admin_email(email):
        return UserRole.SUPER_ADMIN
    return UserRole.AGENT


def role_as_value(role: UserRole | str | None) -> str:
    if isinstance(role, UserRole):
        return role.value
    if role is None:
        return ""
    return str(role).strip().lower()


def is_super_admin_role(role: UserRole | str | None) -> bool:
    return role_as_value(role) == UserRole.SUPER_ADMIN.value


def is_super_admin_user(user: Any) -> bool:
    role = getattr(user, "role", None)
    return is_super_admin_role(role)
