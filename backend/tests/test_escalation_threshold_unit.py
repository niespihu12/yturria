"""
Pruebas de regresión para escalation_threshold configurable.

Cubre:
  - Nuevo default = 4 en SofiaConfig
  - Auto-escalación dispara exactamente en el threshold configurado
  - Por debajo del threshold no escala
  - Threshold personalizado vía sofia_config_json es respetado
  - _coerce_config clampea valores fuera de rango [1, 20]
  - _coerce_config tolera threshold inválido (no-int) sin romper
  - Configs existentes sin escalation_threshold usan el nuevo default 4
  - Compatibilidad hacia atrás: config con threshold=6 explícito sigue usando 6
  - Validación HTTP en backend: fuera de rango → 422
  - Validación HTTP en backend: tipo inválido → 422
  - Dentro de rango → no error
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import HTTPException

from app.services.sofia_config import DEFAULT_CONFIG, SofiaConfig
from app.services.sofia_graph import _coerce_config, classify
from app.controllers.TextAgentController import _validate_sofia_config_escalation_threshold


# ── helpers ──────────────────────────────────────────────────────────────────

def _state(
    user_message: str = "hola",
    *,
    message_count: int = 0,
    already_escalated: bool = False,
    has_open_appointment: bool = False,
    config: dict | None = None,
) -> dict:
    return {
        "messages": [],
        "user_message": user_message,
        "intent": "",
        "rag_context": "",
        "should_escalate": False,
        "escalation_reason": "",
        "message_count": message_count,
        "response": "",
        "system_prompt_override": "",
        "config": config or {},
        "already_escalated": already_escalated,
        "has_open_appointment": has_open_appointment,
    }


# ── default value ─────────────────────────────────────────────────────────────

def test_default_escalation_threshold_is_4():
    assert DEFAULT_CONFIG.escalation_threshold == 4
    assert SofiaConfig().escalation_threshold == 4


# ── auto-escalation at threshold ──────────────────────────────────────────────

def test_auto_escalation_fires_at_default_threshold():
    result = classify(_state(message_count=4))
    assert result.get("should_escalate") is True
    assert result.get("escalation_reason") == "auto_threshold"


def test_auto_escalation_does_not_fire_below_default_threshold():
    result = classify(_state(message_count=3))
    assert result.get("should_escalate", False) is False


def test_auto_escalation_fires_at_custom_threshold():
    result = classify(_state(message_count=7, config={"escalation_threshold": 7}))
    assert result.get("should_escalate") is True
    assert result.get("escalation_reason") == "auto_threshold"


def test_auto_escalation_does_not_fire_below_custom_threshold():
    result = classify(_state(message_count=6, config={"escalation_threshold": 7}))
    assert result.get("should_escalate", False) is False


def test_auto_escalation_fires_above_threshold():
    result = classify(_state(message_count=10, config={"escalation_threshold": 4}))
    assert result.get("should_escalate") is True


def test_auto_escalation_skipped_if_already_escalated():
    result = classify(_state(message_count=10, already_escalated=True))
    assert result.get("should_escalate", False) is False


def test_auto_escalation_skipped_if_appointment_open():
    result = classify(_state(
        message_count=10,
        has_open_appointment=True,
        config={"escalation_threshold": 4},
    ))
    assert result.get("should_escalate", False) is False


# ── backward compatibility ────────────────────────────────────────────────────

def test_existing_config_without_threshold_uses_new_default():
    cfg = _coerce_config({"advisor_phone": "+521234567890"})
    assert cfg.escalation_threshold == 4


def test_existing_config_with_explicit_threshold_6_is_respected():
    cfg = _coerce_config({"escalation_threshold": 6})
    assert cfg.escalation_threshold == 6


def test_existing_config_with_explicit_threshold_1_is_respected():
    cfg = _coerce_config({"escalation_threshold": 1})
    assert cfg.escalation_threshold == 1


def test_existing_config_with_explicit_threshold_20_is_respected():
    cfg = _coerce_config({"escalation_threshold": 20})
    assert cfg.escalation_threshold == 20


# ── _coerce_config range clamping ─────────────────────────────────────────────

def test_coerce_config_clamps_threshold_above_20():
    cfg = _coerce_config({"escalation_threshold": 99})
    assert cfg.escalation_threshold == 20


def test_coerce_config_clamps_threshold_below_1():
    cfg = _coerce_config({"escalation_threshold": 0})
    assert cfg.escalation_threshold == 1


def test_coerce_config_clamps_negative_threshold():
    cfg = _coerce_config({"escalation_threshold": -5})
    assert cfg.escalation_threshold == 1


def test_coerce_config_invalid_threshold_type_falls_back_to_default():
    cfg = _coerce_config({"escalation_threshold": "no-es-numero"})
    assert cfg.escalation_threshold == DEFAULT_CONFIG.escalation_threshold


# ── backend HTTP validation ───────────────────────────────────────────────────

def test_validate_threshold_within_range_no_error():
    for val in (1, 4, 10, 20):
        _validate_sofia_config_escalation_threshold(json.dumps({"escalation_threshold": val}))


def test_validate_threshold_above_20_raises_422():
    with pytest.raises(HTTPException) as exc_info:
        _validate_sofia_config_escalation_threshold(json.dumps({"escalation_threshold": 21}))
    assert exc_info.value.status_code == 422
    assert "escalation_threshold" in exc_info.value.detail


def test_validate_threshold_below_1_raises_422():
    with pytest.raises(HTTPException) as exc_info:
        _validate_sofia_config_escalation_threshold(json.dumps({"escalation_threshold": 0}))
    assert exc_info.value.status_code == 422


def test_validate_threshold_negative_raises_422():
    with pytest.raises(HTTPException) as exc_info:
        _validate_sofia_config_escalation_threshold(json.dumps({"escalation_threshold": -3}))
    assert exc_info.value.status_code == 422


def test_validate_threshold_non_integer_string_raises_422():
    with pytest.raises(HTTPException) as exc_info:
        _validate_sofia_config_escalation_threshold(json.dumps({"escalation_threshold": "mucho"}))
    assert exc_info.value.status_code == 422


def test_validate_missing_threshold_no_error():
    _validate_sofia_config_escalation_threshold(json.dumps({"advisor_phone": "+521"}))


def test_validate_empty_json_no_error():
    _validate_sofia_config_escalation_threshold("{}")


def test_validate_invalid_json_no_error():
    _validate_sofia_config_escalation_threshold("not-json")
