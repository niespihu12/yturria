import logging

from fastapi import FastAPI, HTTPException, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.requests import Request

logger = logging.getLogger(__name__)


def _sanitize_validation_message(message: str) -> str:
    prefixes = ("Value error, ", "Assertion failed, ")
    for prefix in prefixes:
        if message.startswith(prefix):
            return message[len(prefix):]
    return message


def _format_validation_errors(exc: RequestValidationError) -> list[dict[str, str]]:
    formatted_errors: list[dict[str, str]] = []

    for error in exc.errors():
        location = [str(item) for item in error.get("loc", []) if item != "body"]
        field_name = ".".join(location) if location else "body"
        message = _sanitize_validation_message(error.get("msg", "Datos invalidos"))
        formatted_errors.append({"msg": message, "path": field_name})

    if not formatted_errors:
        formatted_errors.append({"msg": "Datos invalidos", "path": "body"})

    return formatted_errors


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Hubo un error"
        return JSONResponse(status_code=exc.status_code, content={"error": detail})

    @app.exception_handler(RequestValidationError)
    async def request_validation_exception_handler(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = _format_validation_errors(exc)
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": errors[0]["msg"], "errors": errors},
        )

    @app.exception_handler(Exception)
    async def unexpected_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled application error", exc_info=exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "Hubo un error"},
        )
