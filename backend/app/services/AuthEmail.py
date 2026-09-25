from __future__ import annotations

import logging
import os
from html import escape

from dotenv import load_dotenv

from app.config.email import send_email_async

load_dotenv()

logger = logging.getLogger(__name__)
# FRONTEND_URL puede ser una lista separada por comas (CORS); los enlaces usan la primera.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").split(",")[0].strip().rstrip("/")
BRAND_NAME = os.getenv("MAIL_FROM_NAME", "").strip() or "AOS"


class AuthEmail:
    @staticmethod
    def send_confirmation_email(*, email: str, name: str, token: str) -> None:
        subject = f"{BRAND_NAME} - Confirma tu cuenta"
        send_email_async(
            to_email=email,
            subject=subject,
            text=f"{subject}. Codigo: {token} (expira en 10 minutos)",
            html=(
                f"<p>Hola: {escape(name)}, has creado tu cuenta en {escape(BRAND_NAME)}, "
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
        subject = f"{BRAND_NAME} - Restablece tu password"
        send_email_async(
            to_email=email,
            subject=subject,
            text=f"{subject}. Codigo: {token} (expira en 10 minutos)",
            html=(
                f"<p>Hola: {escape(name)}, has solicitado restablecer tu password.</p>"
                "<p>Visita el siguiente enlace:</p>"
                f'<a href="{FRONTEND_URL}/auth/new-password">Restablecer Password</a>'
                f"<p>E ingresa el codigo: <b>{token}</b></p>"
                "<p>Este token expira en 10 minutos</p>"
            ),
        )
        logger.info("Email de recuperacion en cola para %s", email)

    @staticmethod
    def send_login_mfa_code(*, email: str, name: str, token: str) -> None:
        subject = f"{BRAND_NAME} - Codigo de verificacion de acceso"
        send_email_async(
            to_email=email,
            subject=subject,
            text=f"{subject}: {token} (expira en 10 minutos)",
            html=(
                f"<p>Hola: {escape(name)}, detectamos un intento de inicio de sesion en tu cuenta.</p>"
                "<p>Ingresa este codigo de 6 digitos para completar el acceso:</p>"
                f"<p><b style=\"font-size: 24px; letter-spacing: 6px;\">{token}</b></p>"
                "<p>Este codigo expira en 10 minutos.</p>"
            ),
        )
        logger.info("Email de MFA en cola para %s", email)
