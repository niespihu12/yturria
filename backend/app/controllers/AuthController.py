from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlmodel import delete, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.Token import Token
from app.models.User import User
from app.schemas.auth import (
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
from app.utils.token import generate_token

ACCOUNT_CONFIRMATION = "account_confirmation"
PASSWORD_RESET = "password_reset"
MFA_LOGIN = "mfa_login"


class AuthController:
    @staticmethod
    def _get_user_by_email(session: SessionDep, email: str) -> User | None:
        statement = select(User).where(User.email == email)
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
        statement = select(Token).where(Token.token == token_value, Token.purpose == purpose)
        token = session.exec(statement).first()

        if token and token.expires_at <= datetime.utcnow():
            session.delete(token)
            session.commit()
            token = None

        if not token:
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
        user_exists = AuthController._get_user_by_email(session, payload.email)
        if user_exists:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El Usuario ya esta registrado",
            )

        user = User(
            email=payload.email,
            name=payload.name,
            password=hash_password(payload.password),
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
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="El Usuario no existe",
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

        if not check_password(payload.password, user.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="El password es incorrecto",
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

        return PlainTextResponse(generate_jwt({"id": user.id}))

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

        if normalize_mfa_code(payload.code) != login_token.token:
            AuthController._handle_failed_mfa_attempt(user, session)

        session.delete(login_token)
        session.commit()
        AuthController._reset_mfa_attempts(user, session)
        return PlainTextResponse(generate_jwt({"id": user.id}))

    @staticmethod
    def request_confirmation_code(
        payload: RequestConfirmationCodeRequest, session: SessionDep
    ) -> str:
        user = AuthController._get_user_by_email(session, payload.email)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El Usuario no esta registrado",
            )

        if user.confirmed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El Usuario ya esta confirmado",
            )

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

        return "Se envio un nuevo token a tu email"

    @staticmethod
    def forgot_password(payload: ForgotPasswordRequest, session: SessionDep) -> str:
        user = AuthController._get_user_by_email(session, payload.email)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El Usuario no esta registrado",
            )

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

        return "Revisa tu email para instrucciones"

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
            "mfa_enabled": current_user.mfa_enabled,
        }

    @staticmethod
    def update_profile(
        payload: UpdateProfileRequest,
        current_user: CurrentUser,
        session: SessionDep,
    ) -> str:
        user_exists = AuthController._get_user_by_email(session, payload.email)
        if user_exists and user_exists.id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El email ya esta registrado",
            )

        current_user.name = payload.name
        current_user.email = payload.email

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
