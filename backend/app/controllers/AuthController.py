from __future__ import annotations

import hmac
import logging
import threading
import time
from collections import deque
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import func
from sqlmodel import delete, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.TextAgent import TextAgent
from app.models.Token import Token
from app.models.User import User, UserRole
from app.models.UserAgent import UserAgent
from app.models.UserPhoneNumber import UserPhoneNumber
from app.schemas.auth import (
    AdminCreateUserRequest,
    CheckPasswordRequest,
    ConfirmAccountRequest,
    CreateAccountRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MfaCodePayload,
    MfaLoginRequest,
    MfaToggleRequest,
    RequestConfirmationCodeRequest,
    UpdateCurrentUserPasswordRequest,
    UpdatePasswordWithTokenRequest,
    UpdateProfileRequest,
    ValidateTokenRequest,
)
from app.services.AuthEmail import AuthEmail
from app.utils.auth import check_password, hash_password
from app.utils.jwt import decode_jwt, generate_jwt
from app.utils.mfa import MFA_LOCK_MINUTES, MFA_MAX_ATTEMPTS, normalize_mfa_code
from app.utils.roles import (
    is_platform_super_admin_email,
    is_super_admin_user,
    normalize_email,
    resolve_default_user_role,
    role_as_value,
)
from app.utils.token import generate_token

ACCOUNT_CONFIRMATION = "account_confirmation"
PASSWORD_RESET = "password_reset"
MFA_LOGIN = "mfa_login"

logger = logging.getLogger(__name__)

# Los codigos de confirmacion/reset son de 6 digitos y se buscan solo por valor.
# Ademas del limite por IP, un presupuesto global de fallos frena la fuerza bruta
# distribuida (muchas IPs) contra el espacio de 10^6 codigos.
# Muy por encima de lo que aporta una sola IP (10/min x 10 min = 100): una IP
# sola no puede bloquear confirmaciones y resets de todos los usuarios.
TOKEN_FAILURE_LIMIT = 1000
TOKEN_FAILURE_WINDOW_SECONDS = 600
_token_failures: deque[float] = deque()
_token_failures_lock = threading.Lock()


def _token_guessing_blocked(now: float) -> bool:
    cutoff = now - TOKEN_FAILURE_WINDOW_SECONDS
    while _token_failures and _token_failures[0] < cutoff:
        _token_failures.popleft()
    return len(_token_failures) >= TOKEN_FAILURE_LIMIT


def _access_token(user: User) -> str:
    return generate_jwt({"id": user.id, "tv": user.token_version or 0})


class AuthController:
    @staticmethod
    def _require_super_admin(current_user: CurrentUser) -> None:
        if not is_super_admin_user(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo el super admin puede realizar esta accion",
            )

    @staticmethod
    def _get_user_by_email(session: SessionDep, email: str) -> User | None:
        normalized_email = normalize_email(email)
        statement = select(User).where(func.lower(User.email) == normalized_email)
        return session.exec(statement).first()

    @staticmethod
    def _delete_existing_tokens(session: SessionDep, user_id: str, purpose: str) -> None:
        session.exec(
            delete(Token).where(Token.user_id == user_id, Token.purpose == purpose)
        )

    @staticmethod
    def _create_token(session: SessionDep, user_id: str, purpose: str) -> Token:
        AuthController._delete_existing_tokens(session, user_id, purpose)
        token = Token(token=generate_token(), user_id=user_id, purpose=purpose)
        session.add(token)
        return token

    @staticmethod
    def _get_token_or_404(session: SessionDep, token_value: str, purpose: str) -> Token:
        with _token_failures_lock:
            if _token_guessing_blocked(time.monotonic()):
                logger.warning("auth: demasiados codigos invalidos, validacion bloqueada temporalmente")
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Demasiados intentos. Intenta de nuevo en unos minutos",
                )

        statement = select(Token).where(Token.token == token_value, Token.purpose == purpose)
        token = session.exec(statement).first()

        if token and token.expires_at <= datetime.utcnow():
            session.delete(token)
            session.commit()
            token = None

        if not token:
            with _token_failures_lock:
                _token_failures.append(time.monotonic())
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Token no valido",
            )

        return token

    @staticmethod
    def _get_latest_user_token(
        session: SessionDep,
        user_id: str,
        purpose: str,
    ) -> Token | None:
        statement = (
            select(Token)
            .where(Token.user_id == user_id, Token.purpose == purpose)
            .order_by(Token.created_at.desc())
        )
        token = session.exec(statement).first()

        if token and token.expires_at <= datetime.utcnow():
            session.delete(token)
            session.commit()
            return None

        return token

    @staticmethod
    def _get_user_or_404(session: SessionDep, user_id: str) -> User:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El Usuario no existe",
            )
        return user

    @staticmethod
    def _ensure_mfa_not_locked(user: User, session: SessionDep) -> None:
        if user.mfa_locked_until and user.mfa_locked_until <= datetime.utcnow():
            user.mfa_locked_until = None
            user.mfa_failed_attempts = 0
            session.add(user)
            session.commit()

        if user.mfa_locked_until and user.mfa_locked_until > datetime.utcnow():
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Demasiados intentos fallidos. Intenta nuevamente en unos minutos",
            )

    @staticmethod
    def _handle_failed_mfa_attempt(user: User, session: SessionDep) -> None:
        user.mfa_failed_attempts += 1
        if user.mfa_failed_attempts >= MFA_MAX_ATTEMPTS:
            user.mfa_locked_until = datetime.utcnow() + timedelta(minutes=MFA_LOCK_MINUTES)
            user.mfa_failed_attempts = 0
            session.add(user)
            session.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Demasiados intentos fallidos. Intenta nuevamente en unos minutos",
            )

        session.add(user)
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Codigo de autenticacion invalido",
        )

    @staticmethod
    def _reset_mfa_attempts(user: User, session: SessionDep) -> None:
        user.mfa_failed_attempts = 0
        user.mfa_locked_until = None
        session.add(user)
        session.commit()

    @staticmethod
    def create_account(payload: CreateAccountRequest, session: SessionDep) -> str:
        normalized_email = normalize_email(payload.email)
        user_exists = AuthController._get_user_by_email(session, normalized_email)
        if user_exists:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El Usuario ya esta registrado",
            )

        user = User(
            email=normalized_email,
            name=payload.name,
            password=hash_password(payload.password),
            role=resolve_default_user_role(normalized_email),
        )
        session.add(user)
        session.flush()

        token = AuthController._create_token(session, user.id, ACCOUNT_CONFIRMATION)
        user_email = user.email
        user_name = user.name
        token_value = token.token
        session.commit()

        AuthEmail.send_confirmation_email(
            email=user_email,
            name=user_name,
            token=token_value,
        )

        return "Cuenta creada, revisa tu email para confirmarla"

    @staticmethod
    def confirm_account(payload: ConfirmAccountRequest, session: SessionDep) -> str:
        token = AuthController._get_token_or_404(session, payload.token, ACCOUNT_CONFIRMATION)
        user = AuthController._get_user_or_404(session, token.user_id)

        user.confirmed = True
        session.add(user)
        session.delete(token)
        session.commit()

        return "Cuenta confirmada correctamente"

    @staticmethod
    def login(payload: LoginRequest, session: SessionDep):
        user = AuthController._get_user_by_email(session, payload.email)
        # Same response for unknown email and wrong password to avoid account enumeration.
        if (
            not user
            or user.deleted_at is not None
            or not check_password(payload.password, user.password)
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email o password incorrectos",
            )

        if not user.confirmed:
            token = AuthController._create_token(session, user.id, ACCOUNT_CONFIRMATION)
            user_email = user.email
            user_name = user.name
            token_value = token.token
            session.commit()

            AuthEmail.send_confirmation_email(
                email=user_email,
                name=user_name,
                token=token_value,
            )

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=(
                    "La cuenta no ha sido confirmada, te hemos enviado un nuevo "
                    "email de confirmacion"
                ),
            )

        if user.mfa_enabled:
            AuthController._ensure_mfa_not_locked(user, session)
            token = AuthController._create_token(session, user.id, MFA_LOGIN)
            user_email = user.email
            user_name = user.name
            token_value = token.token
            session.commit()

            AuthEmail.send_login_mfa_code(
                email=user_email,
                name=user_name,
                token=token_value,
            )

            mfa_token = generate_jwt(
                {"id": user.id, "purpose": MFA_LOGIN},
                expires_minutes=10,
            )
            return JSONResponse(
                content={
                    "requires_mfa": True,
                    "mfa_token": mfa_token,
                    "message": "Te enviamos un codigo de 6 digitos a tu correo para completar el acceso",
                }
            )

        return PlainTextResponse(_access_token(user))

    @staticmethod
    def login_with_mfa(payload: MfaLoginRequest, session: SessionDep) -> PlainTextResponse:
        try:
            challenge_payload = decode_jwt(payload.mfa_token)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(exc),
            ) from exc

        if challenge_payload.get("purpose") != MFA_LOGIN:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="La sesion MFA no es valida",
            )

        user_id = challenge_payload.get("id")
        if not isinstance(user_id, str):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="La sesion MFA no es valida",
            )

        user = AuthController._get_user_or_404(session, user_id)
        AuthController._ensure_mfa_not_locked(user, session)

        if not user.mfa_enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El MFA no esta configurado para este usuario",
            )

        login_token = AuthController._get_latest_user_token(session, user.id, MFA_LOGIN)
        if not login_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="El codigo MFA expiro. Solicita uno nuevo iniciando sesion otra vez",
            )

        if not hmac.compare_digest(normalize_mfa_code(payload.code), login_token.token):
            AuthController._handle_failed_mfa_attempt(user, session)

        session.delete(login_token)
        session.commit()
        AuthController._reset_mfa_attempts(user, session)
        return PlainTextResponse(_access_token(user))

    @staticmethod
    def request_confirmation_code(
        payload: RequestConfirmationCodeRequest, session: SessionDep
    ) -> str:
        generic_message = "Si la cuenta existe y no esta confirmada, te enviamos un nuevo codigo"
        user = AuthController._get_user_by_email(session, payload.email)
        if not user or user.confirmed or user.deleted_at is not None:
            return generic_message

        token = AuthController._create_token(session, user.id, ACCOUNT_CONFIRMATION)
        user_email = user.email
        user_name = user.name
        token_value = token.token
        session.commit()

        AuthEmail.send_confirmation_email(
            email=user_email,
            name=user_name,
            token=token_value,
        )

        return generic_message

    @staticmethod
    def forgot_password(payload: ForgotPasswordRequest, session: SessionDep) -> str:
        generic_message = "Si el email esta registrado, recibiras instrucciones para restablecer tu password"
        user = AuthController._get_user_by_email(session, payload.email)
        if not user or user.deleted_at is not None:
            return generic_message

        token = AuthController._create_token(session, user.id, PASSWORD_RESET)
        user_email = user.email
        user_name = user.name
        token_value = token.token
        session.commit()

        AuthEmail.send_password_reset_token(
            email=user_email,
            name=user_name,
            token=token_value,
        )

        return generic_message

    @staticmethod
    def validate_token(payload: ValidateTokenRequest, session: SessionDep) -> str:
        AuthController._get_token_or_404(session, payload.token, PASSWORD_RESET)
        return "Token valido, Define tu nuevo password"

    @staticmethod
    def update_password_with_token(
        token: str,
        payload: UpdatePasswordWithTokenRequest,
        session: SessionDep,
    ) -> str:
        if not token.isdigit():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Token invalido",
            )

        token_record = AuthController._get_token_or_404(session, token, PASSWORD_RESET)
        user = AuthController._get_user_or_404(session, token_record.user_id)

        user.password = hash_password(payload.password)
        user.token_version = (user.token_version or 0) + 1
        session.add(user)
        session.delete(token_record)
        session.commit()

        return "El password se ha modificado correctamente"

    @staticmethod
    def user(current_user: CurrentUser) -> dict[str, str | bool]:
        return {
            "_id": current_user.id,
            "name": current_user.name,
            "email": current_user.email,
            "role": role_as_value(current_user.role),
            "mfa_enabled": current_user.mfa_enabled,
        }

    @staticmethod
    def admin_users(current_user: CurrentUser, session: SessionDep) -> dict:
        AuthController._require_super_admin(current_user)

        users = session.exec(select(User).order_by(User.created_at.desc())).all()

        voice_counts = {
            str(user_id): int(total)
            for user_id, total in session.exec(
                select(UserAgent.user_id, func.count(UserAgent.id)).group_by(UserAgent.user_id)
            ).all()
        }
        text_counts = {
            str(user_id): int(total)
            for user_id, total in session.exec(
                select(TextAgent.user_id, func.count(TextAgent.id)).group_by(TextAgent.user_id)
            ).all()
        }
        phone_counts = {
            str(user_id): int(total)
            for user_id, total in session.exec(
                select(UserPhoneNumber.user_id, func.count(UserPhoneNumber.id)).group_by(
                    UserPhoneNumber.user_id
                )
            ).all()
        }

        return {
            "users": [
                {
                    "_id": user.id,
                    "name": user.name,
                    "email": user.email,
                    "role": role_as_value(user.role),
                    "confirmed": user.confirmed,
                    "mfa_enabled": user.mfa_enabled,
                    "created_at_unix_secs": int(user.created_at.timestamp()),
                    "voice_agents_count": voice_counts.get(user.id, 0),
                    "text_agents_count": text_counts.get(user.id, 0),
                    "phone_numbers_count": phone_counts.get(user.id, 0),
                }
                for user in users
            ]
        }

    @staticmethod
    def admin_create_user(
        payload: AdminCreateUserRequest,
        current_user: CurrentUser,
        session: SessionDep,
    ) -> dict:
        AuthController._require_super_admin(current_user)

        normalized_email = normalize_email(payload.email)
        user_exists = AuthController._get_user_by_email(session, normalized_email)
        if user_exists:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El Usuario ya esta registrado",
            )

        user = User(
            email=normalized_email,
            name=payload.name,
            password=hash_password(payload.password),
            role=UserRole(payload.role),
            confirmed=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        return {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": role_as_value(user.role),
            "confirmed": user.confirmed,
            "message": "Usuario creado correctamente",
        }

    @staticmethod
    def update_profile(
        payload: UpdateProfileRequest,
        current_user: CurrentUser,
        session: SessionDep,
    ) -> str:
        normalized_email = normalize_email(payload.email)
        user_exists = AuthController._get_user_by_email(session, normalized_email)
        email_changed = normalized_email != normalize_email(current_user.email)
        if (user_exists and user_exists.id != current_user.id) or (
            email_changed and is_platform_super_admin_email(normalized_email)
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El email ya esta registrado",
            )

        current_user.name = payload.name
        current_user.email = normalized_email

        session.add(current_user)
        session.commit()

        return "Perfil Actualizado correctamente"

    @staticmethod
    def update_current_user_password(
        payload: UpdateCurrentUserPasswordRequest,
        current_user: CurrentUser,
        session: SessionDep,
    ) -> str:
        if not check_password(payload.current_password, current_user.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="El password actual es incorrecto",
            )

        current_user.password = hash_password(payload.password)
        current_user.token_version = (current_user.token_version or 0) + 1
        session.add(current_user)
        session.commit()

        return "El Password se ha modificado correctamente"

    @staticmethod
    def check_password(payload: CheckPasswordRequest, current_user: CurrentUser) -> str:
        if not check_password(payload.password, current_user.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="El password es incorrecto",
            )

        return "Password correcto"

    @staticmethod
    def enable_mfa(
        payload: MfaToggleRequest,
        current_user: CurrentUser,
        session: SessionDep,
    ) -> str:
        if not check_password(payload.current_password, current_user.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="El password actual es incorrecto",
            )

        current_user.mfa_enabled = True
        current_user.mfa_failed_attempts = 0
        current_user.mfa_locked_until = None
        session.add(current_user)
        session.commit()

        return "MFA por correo activado correctamente"

    @staticmethod
    def disable_mfa(
        payload: MfaToggleRequest,
        current_user: CurrentUser,
        session: SessionDep,
    ) -> str:
        if not check_password(payload.current_password, current_user.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="El password actual es incorrecto",
            )

        current_user.mfa_enabled = False
        current_user.mfa_failed_attempts = 0
        current_user.mfa_locked_until = None
        session.add(current_user)
        session.commit()

        AuthController._delete_existing_tokens(session, current_user.id, MFA_LOGIN)
        session.commit()

        return "MFA por correo desactivado correctamente"
