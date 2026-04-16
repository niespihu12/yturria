from __future__ import annotations

import logging
import os

from dotenv import load_dotenv

from app.config.email import send_email_async

load_dotenv()

logger = logging.getLogger(__name__)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


class AuthEmail:
    @staticmethod
    def send_confirmation_email(*, email: str, name: str, token: str) -> None:
        send_email_async(
            to_email=email,
            subject="UpTask - Confirma tu cuenta",
            text="UpTask - Confirma tu cuenta",
            html=(
                f"<p>Hola: {name}, has creado tu cuenta en UpTask, "
                "ya casi esta todo listo, solo debes confirmar tu cuenta</p>"
                "<p>Visita el siguiente enlace:</p>"
                f'<a href="{FRONTEND_URL}/auth/confirm-account">Confirma cuenta</a>'
                f"<p>E ingresa el codigo: <b>{token}</b></p>"
                "<p>Este token expira en 10 minutos</p>"
            ),
        )
        logger.info("Email de confirmacion en cola para %s", email)

    @staticmethod
    def send_password_reset_token(*, email: str, name: str, token: str) -> None:
        send_email_async(
            to_email=email,
            subject="UpTask - Reestablece tu password",
            text="UpTask - Reestablece tu password",
            html=(
                f"<p>Hola: {name}, has solicitado reestablecer tu password.</p>"
                "<p>Visita el siguiente enlace:</p>"
                f'<a href="{FRONTEND_URL}/auth/new-password">Reestablecer Password</a>'
                f"<p>E ingresa el codigo: <b>{token}</b></p>"
                "<p>Este token expira en 10 minutos</p>"
            ),
        )
        logger.info("Email de recuperacion en cola para %s", email)

    @staticmethod
    def send_login_mfa_code(*, email: str, name: str, token: str) -> None:
        send_email_async(
            to_email=email,
            subject="UpTask - Codigo de verificacion de acceso",
            text="UpTask - Codigo de verificacion de acceso",
            html=(
                f"<p>Hola: {name}, detectamos un intento de inicio de sesion en tu cuenta.</p>"
                "<p>Ingresa este codigo de 6 digitos para completar el acceso:</p>"
                f"<p><b style=\"font-size: 24px; letter-spacing: 6px;\">{token}</b></p>"
                "<p>Este codigo expira en 10 minutos.</p>"
            ),
        )
        logger.info("Email de MFA en cola para %s", email)
