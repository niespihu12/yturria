"""Cliente HTTP compartido para la API de ElevenLabs."""
from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException, status

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"


def _headers(*, json_body: bool = False) -> dict[str, str]:
    if not ELEVENLABS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ELEVENLABS_API_KEY no configurada en el backend",
        )

    headers = {"xi-api-key": ELEVENLABS_API_KEY}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _extract_el_error(body: Any, fallback: str = "Error con ElevenLabs") -> str:
    if isinstance(body, dict):
        detail = body.get("detail")
        if isinstance(detail, dict):
            return detail.get("message", str(detail))
        if isinstance(detail, str):
            return detail
        error = body.get("error")
        if isinstance(error, str):
            return error
    return fallback


def _parse_el_response(resp: httpx.Response) -> Any:
    if not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        return {"detail": resp.text}


def elevenlabs_request(
    method: str,
    path: str,
    *,
    json: dict | None = None,
    params: dict | None = None,
    data: dict | None = None,
    files: dict | None = None,
) -> Any:
    headers = _headers(json_body=json is not None and files is None and data is None)
    with httpx.Client(timeout=60) as client:
        resp = client.request(
            method,
            f"{ELEVENLABS_BASE}{path}",
            headers=headers,
            json=json,
            params=params,
            data=data,
            files=files,
        )

    body = _parse_el_response(resp)
    if not resp.is_success:
        raise HTTPException(
            status_code=resp.status_code,
            detail=_extract_el_error(body, fallback=resp.text or "Error con ElevenLabs"),
        )
    return body


def elevenlabs_get(path: str, *, params: dict | None = None) -> Any:
    return elevenlabs_request("GET", path, params=params)


def elevenlabs_post(path: str, body: dict) -> Any:
    return elevenlabs_request("POST", path, json=body)


def elevenlabs_patch(path: str, body: dict) -> Any:
    return elevenlabs_request("PATCH", path, json=body)


def elevenlabs_delete(path: str) -> Any:
    return elevenlabs_request("DELETE", path)
