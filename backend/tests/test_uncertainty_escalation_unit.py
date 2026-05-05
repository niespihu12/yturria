"""Tests unitarios para el detector de escalación por incertidumbre en guard node."""
import pytest

from app.services.sofia_graph import _detect_uncertainty, _UNCERTAINTY_ESCALATION_THRESHOLD


# ── 10 variaciones de frases de duda ──────────────────────────────────────────

UNCERTAINTY_PHRASES = [
    "No estoy seguro de ese dato, le recomiendo llamar a la aseguradora.",
    "Permítame consultar con el equipo antes de confirmarle eso.",
    "Tengo que verificar ese precio antes de dárselo.",
    "Déjeme verificar si esa cobertura aplica para su póliza.",
    "Necesito consultar internamente para responderle con precisión.",
    "Debo consultar esa información antes de comprometerte con un valor.",
    "No tengo esa información disponible en este momento.",
    "No cuento con esa información en mi base de datos actual.",
    "No puedo confirmar ese dato sin revisarlo primero.",
    "Tendría que revisar el contrato para darle una respuesta exacta.",
]

NON_UNCERTAINTY_PHRASES = [
    "Su póliza cubre daños por colisión hasta $50,000.",
    "La prima mensual para su plan es de $120.000.",
    "Puede renovar su póliza hasta 30 días antes del vencimiento.",
    "Para reportar un siniestro llame al 018000123456.",
    "Su agente asignado es María González, cel 3001234567.",
]


@pytest.mark.parametrize("phrase", UNCERTAINTY_PHRASES)
def test_detects_uncertainty(phrase: str) -> None:
    assert _detect_uncertainty(phrase), f"Debería detectar incertidumbre en: {phrase!r}"


@pytest.mark.parametrize("phrase", NON_UNCERTAINTY_PHRASES)
def test_no_false_positives(phrase: str) -> None:
    assert not _detect_uncertainty(phrase), f"Falso positivo en: {phrase!r}"


def test_uncertainty_threshold_is_two() -> None:
    assert _UNCERTAINTY_ESCALATION_THRESHOLD == 2


def test_case_insensitive() -> None:
    assert _detect_uncertainty("NO ESTOY SEGURO de ese precio.")
    assert _detect_uncertainty("PERMÍTAME CONSULTAR con el equipo.")
