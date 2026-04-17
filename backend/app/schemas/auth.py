from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _validate_required(value: object, message: str) -> str:
    text = _normalize_text(value)
    if not text:
        raise ValueError(message)
    return text


class BaseSchema(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, validate_default=True)


class EmailPayload(BaseSchema):
    email: str = ""

    @field_validator("email", mode="before")
    @classmethod
    def validate_email(cls, value: object) -> str:
        email = _validate_required(value, "E-mail no valido")
        if not EMAIL_PATTERN.match(email):
            raise ValueError("E-mail no valido")
        return email


class PasswordPayload(BaseSchema):
    password: str = ""
    password_confirmation: str = ""

    @field_validator("password", mode="before")
    @classmethod
    def validate_password_required(cls, value: object) -> str:
        return _validate_required(value, "El password es muy corto, minimo 8 caracteres")

    @field_validator("password")
    @classmethod
    def validate_password_length(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("El password es muy corto, minimo 8 caracteres")
        return value

    @field_validator("password_confirmation", mode="before")
    @classmethod
    def validate_password_confirmation_required(cls, value: object) -> str:
        return _validate_required(value, "Los Passwords no son iguales")

    @model_validator(mode="after")
    def validate_password_match(self) -> "PasswordPayload":
        if self.password_confirmation != self.password:
            raise ValueError("Los Passwords no son iguales")
        return self


class MfaCodePayload(BaseSchema):
    code: str = ""

    @field_validator("code", mode="before")
    @classmethod
    def validate_code_required(cls, value: object) -> str:
        code = _validate_required(value, "Ingresa un codigo de 6 digitos")
        normalized = "".join(character for character in code if character.isdigit())
        if len(normalized) != 6:
            raise ValueError("Ingresa un codigo de 6 digitos")
        return normalized


class CreateAccountRequest(EmailPayload, PasswordPayload):
    name: str = ""

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: object) -> str:
        return _validate_required(value, "El nombre no puede ir vacio")


class ConfirmAccountRequest(BaseSchema):
    token: str = ""

    @field_validator("token", mode="before")
    @classmethod
    def validate_token(cls, value: object) -> str:
        return _validate_required(value, "El Token no puede ir vacio")


class LoginRequest(EmailPayload):
    password: str = ""

    @field_validator("password", mode="before")
    @classmethod
    def validate_password(cls, value: object) -> str:
        return _validate_required(value, "El password no puede ir vacio")


class MfaLoginRequest(MfaCodePayload):
    mfa_token: str = ""

    @field_validator("mfa_token", mode="before")
    @classmethod
    def validate_mfa_token(cls, value: object) -> str:
        return _validate_required(value, "La sesion MFA no es valida")


class RequestConfirmationCodeRequest(EmailPayload):
    pass


class ForgotPasswordRequest(EmailPayload):
    pass


class ValidateTokenRequest(ConfirmAccountRequest):
    pass


class UpdatePasswordWithTokenRequest(PasswordPayload):
    pass


class UpdateProfileRequest(EmailPayload):
    name: str = ""

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: object) -> str:
        return _validate_required(value, "El nombre no puede ir vacio")


class UpdateCurrentUserPasswordRequest(PasswordPayload):
    current_password: str = ""

    @field_validator("current_password", mode="before")
    @classmethod
    def validate_current_password(cls, value: object) -> str:
        return _validate_required(value, "El password actual no puede ir vacio")


class CheckPasswordRequest(BaseSchema):
    password: str = ""

    @field_validator("password", mode="before")
    @classmethod
    def validate_password(cls, value: object) -> str:
        return _validate_required(value, "El password no puede ir vacio")


class MfaToggleRequest(BaseSchema):
    current_password: str = ""

    @field_validator("current_password", mode="before")
    @classmethod
    def validate_current_password(cls, value: object) -> str:
        return _validate_required(value, "El password actual no puede ir vacio")


class AuthenticatedUserResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    name: str
    email: str
    role: str
    mfa_enabled: bool


class AdminUserSummaryResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id")
    name: str
    email: str
    role: str
    confirmed: bool
    mfa_enabled: bool
    created_at_unix_secs: int
    voice_agents_count: int
    text_agents_count: int
    phone_numbers_count: int


class AdminUsersResponse(BaseModel):
    users: list[AdminUserSummaryResponse]


class MfaChallengeResponse(BaseModel):
    requires_mfa: bool = True
    mfa_token: str
    message: str
