from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.controllers.deps.db_session import SessionDep
from app.models.User import User
from app.utils.jwt import decode_jwt

bearer_scheme = HTTPBearer(auto_error=False)


def authenticate(
    session: SessionDep,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autorizado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_jwt(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user_id = payload.get("id")
    # Purpose-scoped tokens (e.g. the MFA challenge) must never grant API access.
    if not isinstance(user_id, str) or payload.get("purpose"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalido",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = session.get(User, user_id)
    token_version = payload.get("tv", 0)
    if (
        not user
        or user.deleted_at is not None
        or token_version != (user.token_version or 0)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autorizado",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


CurrentUser = Annotated[User, Depends(authenticate)]
