"""
Suite de aceptación de negocio para Sofía — 50 casos reales.

Cubre:
  • intent (cotizacion / siniestro / renovacion / otro)
  • escalation (user_request / auto_threshold / suprimida)
  • compliance de respuesta (sin precio exacto, sin revelar IA, longitud, tono)

Estructura:
  - AcceptanceCase  : descriptor de caso
  - _check_compliance: validador de texto puro (sin LLM)
  - _evaluate_case  : evaluador sin efectos externos
  - test_acceptance_case   : parametrizado, 1 assert por caso
  - test_zzz_pipeline_compliance_rate : falla si cumplimiento < UMBRAL
"""
from __future__ import annotations

import asyncio
import json
import math
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from time import perf_counter
from typing import Any
from uuid import uuid4

import app.controllers.TextAgentController as text_controller_module
import app.models  # noqa: F401
import pytest
from sqlmodel import Session, SQLModel, create_engine, select

from app.controllers.TextAgentController import TextAgentController, _run_sofia_chat
from app.models.AuditTrailEvent import AuditTrailEvent
from app.models.TextAgent import TextAgent
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.models.TextConversation import TextConversation
from app.models.TextMessage import TextMessage
from app.models.User import User, UserRole
from app.services.renewal_scheduler import run_due_renewal_reminders
from app.services.sofia_graph import classify
from app.services.sofia_prompts import SOFIA_SYSTEM_PROMPT

# ── Umbral de pipeline ────────────────────────────────────────────────────────

COMPLIANCE_THRESHOLD = 0.90  # 90 % mínimo; bajar de aquí falla el pipeline

# ── Helpers de sesión ─────────────────────────────────────────────────────────


def _make_session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _state(
    user_message: str,
    *,
    message_count: int = 0,
    already_escalated: bool = False,
    has_open_appointment: bool = False,
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
        "config": {},
        "already_escalated": already_escalated,
        "has_open_appointment": has_open_appointment,
    }


def _seed_user_and_agent(
    session: Session,
    *,
    sofia_mode: bool = True,
    sofia_config: dict | None = None,
) -> tuple[User, TextAgent]:
    now = datetime.utcnow()
    user = User(
        email=f"qa-{uuid4().hex[:8]}@example.com",
        password="secret",
        name="QA User",
        role=UserRole.AGENT,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    agent = TextAgent(
        user_id=user.id,
        name="Sofia QA",
        provider="openai",
        model="gpt-4.1-mini",
        system_prompt="",
        welcome_message="",
        language="es",
        temperature=0.2,
        max_tokens=300,
        sofia_mode=sofia_mode,
        sofia_config_json=json.dumps(sofia_config or {}),
        created_at=now,
        updated_at=now,
    )
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return user, agent


def _create_whatsapp_config(
    session: Session,
    *,
    agent_id: str,
    provider: str,
) -> TextAgentWhatsApp:
    now = datetime.utcnow()
    config = TextAgentWhatsApp(
        text_agent_id=agent_id,
        provider=provider,
        phone_number="+573001112233",
        account_sid="AC_TEST",
        auth_token_encrypted="enc-token",
        access_token_encrypted="enc-meta-token",
        phone_number_id="meta-phone-id",
        business_account_id="meta-business-id",
        webhook_verify_token="verify-token",
        active=True,
        created_at=now,
        updated_at=now,
    )
    session.add(config)
    session.commit()
    session.refresh(config)
    return config


def _create_conversation(
    session: Session,
    *,
    agent: TextAgent,
    user: User,
    title: str,
    renewal_date: datetime | None = None,
    renewal_status: str = "none",
) -> TextConversation:
    now = datetime.utcnow()
    conversation = TextConversation(
        text_agent_id=agent.id,
        user_id=user.id,
        title=title,
        renewal_date=renewal_date,
        renewal_status=renewal_status,
        created_at=now,
        updated_at=now,
    )
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


def _p95(values: list[float]) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(0.95 * len(ordered)) - 1)
    return ordered[index]


# ── Compliance checker (sin LLM) ──────────────────────────────────────────────

_PRICE_QUALIFIERS = (
    "desde", "hasta", "rango", "orientativo", "aproximado",
    "entre", "generalmente", " a $", " a los $",
)
_AI_REVEALS = (
    "soy una ia", "soy un bot", "soy un chatbot",
    "soy inteligencia artificial", "soy una inteligencia artificial",
    "soy un programa", "soy un robot",
    "como ia ", "como bot ", "como chatbot",
    "inteligencia artificial diseñada", "inteligencia artificial creada",
)
_BAD_TONE_PATTERNS = (
    "no sé nada", "no se nada", "no puedo ayudar",
    "no tengo idea", "no lo sé", "no lo se",
)


def _check_compliance(text: str, checks: list[str]) -> list[str]:
    """Devuelve lista de violaciones encontradas (vacía = cumple todo)."""
    violations: list[str] = []
    lower = text.lower()

    if "no_price" in checks:
        # Detecta cifras dolarizadas sin calificador de rango cercano
        has_dollar_amount = bool(re.search(r"\$\s*\d+", text))
        has_qualifier = any(q in lower for q in _PRICE_QUALIFIERS)
        if has_dollar_amount and not has_qualifier:
            violations.append("exact_price")

    if "no_ai" in checks:
        if any(phrase in lower for phrase in _AI_REVEALS):
            violations.append("reveals_ai")

    if "max_length" in checks:
        non_empty = [ln for ln in text.split("\n") if ln.strip()]
        if len(non_empty) > 3:
            violations.append("exceeds_3_lines")

    if "tone" in checks:
        if any(p in lower for p in _BAD_TONE_PATTERNS):
            violations.append("bad_tone")

    return violations


# ── Descriptor de caso ────────────────────────────────────────────────────────


@dataclass
class AcceptanceCase:
    id: str
    category: str
    description: str
    # Routing fields
    message: str = ""
    message_count: int = 0
    already_escalated: bool = False
    has_open_appointment: bool = False
    config: dict = field(default_factory=dict)
    expected_intent: str | None = None
    expected_escalation: bool | None = None
    expected_reason: str | None = None
    # Compliance fields
    response_text: str = ""
    compliance_checks: list[str] = field(default_factory=list)
    expect_violation: bool = False  # True → test pasa si checker detecta violación


# ── 50 casos ─────────────────────────────────────────────────────────────────

ALL_CASES: list[AcceptanceCase] = [

    # ── CATEGORÍA 1: cotizacion_keyword (keyword match, sin escalación) ──────
    # Mensajes con quote_keywords sin ESCALATION_PHRASES → cotizacion, no escalar

    AcceptanceCase(
        id="C01", category="cotizacion_keyword",
        description="Cotizar seguro de auto",
        message="quiero cotizar un seguro de auto",
        expected_intent="cotizacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C02", category="cotizacion_keyword",
        description="Cotizar seguro de vida",
        message="necesito cotizar un seguro de vida para mi familia",
        expected_intent="cotizacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C03", category="cotizacion_keyword",
        description="Solicitud de cotizacion empresarial",
        message="dame una cotizacion de cobertura empresarial por favor",
        expected_intent="cotizacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C04", category="cotizacion_keyword",
        description="Consulta de precio seguro auto",
        message="cual es el precio del seguro para mi auto del año",
        expected_intent="cotizacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C05", category="cotizacion_keyword",
        description="Consulta de precio seguro medico",
        message="necesito saber el precio de un seguro medico para mi empresa",
        expected_intent="cotizacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C06", category="cotizacion_keyword",
        description="Consulta de costo seguro auto",
        message="quiero informacion sobre el costo de un seguro de auto",
        expected_intent="cotizacion", expected_escalation=False,
    ),

    # ── CATEGORÍA 2: cotizacion_escalation (ESCALATION_PHRASE + quote_keyword) ─

    AcceptanceCase(
        id="C07", category="cotizacion_escalation",
        description="Quiere contratar seguro auto",
        message="quiero contratar un seguro de auto ahora",
        expected_intent="cotizacion", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C08", category="cotizacion_escalation",
        description="Interesado en contratar poliza de vida",
        message="me interesa contratar una poliza de vida para mi familia",
        expected_intent="cotizacion", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C09", category="cotizacion_escalation",
        description="Pide cotizacion formal",
        message="quiero una cotizacion formal para cubrir mi empresa",
        expected_intent="cotizacion", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C10", category="cotizacion_escalation",
        description="Necesita poliza de gastos medicos",
        message="necesito una poliza de gastos medicos urgente para mi familia",
        expected_intent="cotizacion", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C11", category="cotizacion_escalation",
        description="Quiere asegurar vehiculo",
        message="quiero asegurar mi vehiculo este mes sin falta",
        expected_intent="cotizacion", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C12", category="cotizacion_escalation",
        description="Quiere adquirir poliza empresarial",
        message="quiero adquirir una poliza empresarial lo antes posible",
        expected_intent="cotizacion", expected_escalation=True,
        expected_reason="user_request",
    ),

    # ── CATEGORÍA 3: siniestro (claim_keywords, retorno sin bandera de escalación) ─

    AcceptanceCase(
        id="C13", category="siniestro",
        description="Accidente en carretera",
        message="tuve un accidente en la carretera federal ayer",
        expected_intent="siniestro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C14", category="siniestro",
        description="Robo de vehiculo",
        message="me robaron el automovil anoche afuera de mi casa",
        expected_intent="siniestro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C15", category="siniestro",
        description="Choque de auto",
        message="hubo un choque con mi carro esta mañana en el estacionamiento",
        expected_intent="siniestro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C16", category="siniestro",
        description="Reporte de siniestro hogar",
        message="necesito reportar un siniestro que ocurrio en mi hogar",
        expected_intent="siniestro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C17", category="siniestro",
        description="Reclamo pendiente",
        message="tengo un reclamo pendiente de mi seguro de auto del mes pasado",
        expected_intent="siniestro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C18", category="siniestro",
        description="Reclamacion por daños",
        message="quiero iniciar una reclamacion por daños materiales a mi vehiculo",
        expected_intent="siniestro", expected_escalation=False,
    ),

    # ── CATEGORÍA 4: renovacion (renewal_keywords) ────────────────────────────

    AcceptanceCase(
        id="C19", category="renovacion",
        description="Poliza por vencer",
        message="cuando vence mi poliza de auto, necesito saber la fecha",
        expected_intent="renovacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C20", category="renovacion",
        description="Renovar seguro de vida",
        message="quiero renovar mi seguro de vida antes de que caduque",
        expected_intent="renovacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C21", category="renovacion",
        description="Consulta de vigencia",
        message="cual es la vigencia de mi seguro de gastos medicos actual",
        expected_intent="renovacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C22", category="renovacion",
        description="Consulta de continuidad de cobertura",
        message="necesito informacion sobre la continuidad de mi cobertura empresarial",
        expected_intent="renovacion", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C23", category="renovacion",
        description="Poliza vencida",
        message="mi seguro vencio el mes pasado, que necesito hacer para renovarlo",
        expected_intent="renovacion", expected_escalation=False,
    ),

    # ── CATEGORÍA 5: otro_user_escalation (EP sin quote_keyword → otro + escalar) ─

    AcceptanceCase(
        id="C24", category="otro_user_escalation",
        description="Solicita hablar con asesor",
        message="quiero hablar con un asesor de la empresa",
        expected_intent="otro", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C25", category="otro_user_escalation",
        description="Necesita hablar con alguien",
        message="necesito hablar con alguien de servicio al cliente",
        expected_intent="otro", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C26", category="otro_user_escalation",
        description="Quiere hablar con persona real",
        message="quiero hablar con una persona real de su equipo",
        expected_intent="otro", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C27", category="otro_user_escalation",
        description="Quiere comunicarse con representante",
        message="comunicarme con un representante del equipo de ventas",
        expected_intent="otro", expected_escalation=True,
        expected_reason="user_request",
    ),
    AcceptanceCase(
        id="C28", category="otro_user_escalation",
        description="Hablar con alguien del equipo",
        message="quiero hablar con alguien del equipo de asesores de seguros",
        expected_intent="otro", expected_escalation=True,
        expected_reason="user_request",
    ),

    # ── CATEGORÍA 6: suppression_escalated (ya escalado, no re-escalar) ──────

    AcceptanceCase(
        id="C29", category="suppression_escalated",
        description="Ya escalado: contratar no re-escala",
        message="quiero contratar un seguro de auto ahora mismo",
        already_escalated=True,
        expected_intent="otro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C30", category="suppression_escalated",
        description="Ya escalado: hablar con asesor no re-escala",
        message="quiero hablar con un asesor urgente por favor",
        already_escalated=True,
        expected_intent="otro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C31", category="suppression_escalated",
        description="Ya escalado: comprar poliza no re-escala",
        message="quiero comprar una poliza de vida ahora",
        already_escalated=True,
        expected_intent="otro", expected_escalation=False,
    ),

    # ── CATEGORÍA 7: suppression_appointment (cita abierta, no auto-escalar) ─

    AcceptanceCase(
        id="C32", category="suppression_appointment",
        description="Seguimiento de cita: si",
        message="si",
        has_open_appointment=True,
        expected_intent="otro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C33", category="suppression_appointment",
        description="Seguimiento de cita: horario disponible",
        message="que horario tienen disponible para la llamada",
        has_open_appointment=True,
        expected_intent="otro", expected_escalation=False,
    ),
    AcceptanceCase(
        id="C34", category="suppression_appointment",
        description="Seguimiento de cita: cuando llaman",
        message="si por favor, cuando me pueden llamar",
        has_open_appointment=True,
        expected_intent="otro", expected_escalation=False,
    ),

    # ── CATEGORÍA 8: auto_threshold (sin keywords, count >= threshold) ───────

    AcceptanceCase(
        id="C35", category="auto_threshold",
        description="Threshold default=4 alcanzado exactamente",
        message="gracias por la informacion brindada",
        message_count=4,
        expected_intent="otro", expected_escalation=True,
        expected_reason="auto_threshold",
    ),
    AcceptanceCase(
        id="C36", category="auto_threshold",
        description="Threshold default superado (5)",
        message="perfecto muchas gracias de antemano",
        message_count=5,
        expected_intent="otro", expected_escalation=True,
        expected_reason="auto_threshold",
    ),
    AcceptanceCase(
        id="C37", category="auto_threshold",
        description="Threshold personalizado 7 alcanzado",
        message="entiendo de acuerdo con lo que me comenta",
        message_count=7,
        config={"escalation_threshold": 7},
        expected_intent="otro", expected_escalation=True,
        expected_reason="auto_threshold",
    ),
    AcceptanceCase(
        id="C38", category="auto_threshold",
        description="Threshold personalizado 10 superado",
        message="ok excelente me parece bien lo que me indica",
        message_count=10,
        config={"escalation_threshold": 4},
        expected_intent="otro", expected_escalation=True,
        expected_reason="auto_threshold",
    ),

    # ── CATEGORÍA 9: compliance_price (sin precio exacto) ────────────────────

    AcceptanceCase(
        id="C39", category="compliance_price",
        description="Precio exacto sin calificador → viola",
        response_text="El seguro de auto cuesta $950 pesos al mes.",
        compliance_checks=["no_price"],
        expect_violation=True,
    ),
    AcceptanceCase(
        id="C40", category="compliance_price",
        description="Rango con 'aproximadamente' → cumple",
        response_text=(
            "Los seguros de auto arrancan desde $500 aproximadamente, "
            "dependiendo del vehículo y la cobertura seleccionada."
        ),
        compliance_checks=["no_price"],
        expect_violation=False,
    ),
    AcceptanceCase(
        id="C41", category="compliance_price",
        description="Rango explícito desde-hasta → cumple",
        response_text=(
            "Le puedo indicar un rango orientativo de $400 a $1,500 mensual "
            "según el perfil y la cobertura."
        ),
        compliance_checks=["no_price"],
        expect_violation=False,
    ),
    AcceptanceCase(
        id="C42", category="compliance_price",
        description="Precio exacto sin contexto de rango → viola",
        response_text="Su cobertura tiene un costo de $1,200 mensuales exactos.",
        compliance_checks=["no_price"],
        expect_violation=True,
    ),

    # ── CATEGORÍA 10: compliance_ai_reveal (no revelar IA) ───────────────────

    AcceptanceCase(
        id="C43", category="compliance_ai_reveal",
        description="Se identifica como IA → viola",
        response_text="Soy una inteligencia artificial diseñada para orientarle en seguros.",
        compliance_checks=["no_ai"],
        expect_violation=True,
    ),
    AcceptanceCase(
        id="C44", category="compliance_ai_reveal",
        description="Se identifica como bot → viola",
        response_text="Soy un bot de Yturria Seguros, con gusto le ayudo.",
        compliance_checks=["no_ai"],
        expect_violation=True,
    ),
    AcceptanceCase(
        id="C45", category="compliance_ai_reveal",
        description="Asistente virtual sin revelar IA → cumple",
        response_text=(
            "Soy la asistente virtual de Yturria Seguros. "
            "Con gusto le oriento sobre nuestras coberturas."
        ),
        compliance_checks=["no_ai"],
        expect_violation=False,
    ),
    AcceptanceCase(
        id="C46", category="compliance_ai_reveal",
        description="Respuesta de orientación sin mención de IA → cumple",
        response_text="Con mucho gusto le oriento sobre las opciones de seguro disponibles.",
        compliance_checks=["no_ai"],
        expect_violation=False,
    ),

    # ── CATEGORÍA 11: compliance_length (máximo 3 líneas) ────────────────────

    AcceptanceCase(
        id="C47", category="compliance_length",
        description="Respuesta de 3 líneas → cumple",
        response_text="Hola, bienvenido a Yturria Seguros.\nCon gusto le atiendo.\nDígame en qué le puedo ayudar.",
        compliance_checks=["max_length"],
        expect_violation=False,
    ),
    AcceptanceCase(
        id="C48", category="compliance_length",
        description="Respuesta de 4 líneas → viola",
        response_text=(
            "Bienvenido a Yturria Seguros.\n"
            "Contamos con más de 75 años de experiencia.\n"
            "Trabajamos con GNP, AXA y Chubb.\n"
            "Dígame en qué le puedo orientar hoy."
        ),
        compliance_checks=["max_length"],
        expect_violation=True,
    ),
    AcceptanceCase(
        id="C49", category="compliance_length",
        description="Respuesta de 1 línea → cumple",
        response_text="Claro, con mucho gusto le oriento sobre el proceso de renovación.",
        compliance_checks=["max_length"],
        expect_violation=False,
    ),
    AcceptanceCase(
        id="C50", category="compliance_length",
        description="Respuesta de 5 líneas → viola",
        response_text=(
            "Hola.\n"
            "Gracias por contactarnos.\n"
            "Somos Yturria Seguros.\n"
            "Llevamos 75 años en el mercado.\n"
            "¿En qué le puedo ayudar?"
        ),
        compliance_checks=["max_length"],
        expect_violation=True,
    ),
]

assert len(ALL_CASES) == 50, f"Se esperaban 50 casos, hay {len(ALL_CASES)}"

# ── Evaluador (sin efectos externos) ─────────────────────────────────────────


def _make_classify_state(case: AcceptanceCase) -> dict:
    return {
        "messages": [],
        "user_message": case.message,
        "intent": "",
        "rag_context": "",
        "should_escalate": False,
        "escalation_reason": "",
        "message_count": case.message_count,
        "response": "",
        "system_prompt_override": "",
        "config": case.config,
        "already_escalated": case.already_escalated,
        "has_open_appointment": case.has_open_appointment,
    }


def _evaluate_case(case: AcceptanceCase) -> tuple[bool, str]:
    """
    Retorna (passed, detail).
    No llama a LLM ni a servicios externos; todos los casos de la matriz
    están diseñados para resolverse mediante keyword-matching, threshold
    determinista o análisis estático de texto.
    """
    if case.response_text:
        violations = _check_compliance(case.response_text, case.compliance_checks)
        if case.expect_violation:
            passed = len(violations) > 0
            detail = (
                f"Se esperaba violación pero el checker no detectó nada."
                if not passed
                else f"Violación detectada correctamente: {violations}"
            )
        else:
            passed = len(violations) == 0
            detail = (
                f"Violaciones inesperadas: {violations}"
                if not passed
                else "OK"
            )
        return passed, detail

    # Caso de routing
    result = classify(_make_classify_state(case))
    checks: list[str] = []

    if case.expected_intent is not None:
        got = result.get("intent")
        if got != case.expected_intent:
            checks.append(f"intent={got!r} esperado={case.expected_intent!r}")

    if case.expected_escalation is not None:
        got_esc = bool(result.get("should_escalate", False))
        if got_esc != case.expected_escalation:
            checks.append(
                f"escalation={got_esc} esperado={case.expected_escalation}"
            )

    if case.expected_reason is not None:
        got_reason = result.get("escalation_reason", "")
        if got_reason != case.expected_reason:
            checks.append(
                f"reason={got_reason!r} esperado={case.expected_reason!r}"
            )

    passed = len(checks) == 0
    return passed, "; ".join(checks) if checks else "OK"


# ── Test parametrizado (1 assert por caso) ───────────────────────────────────


@pytest.mark.parametrize("case", ALL_CASES, ids=lambda c: c.id)
def test_acceptance_case(case: AcceptanceCase) -> None:
    passed, detail = _evaluate_case(case)
    assert passed, f"[{case.category}] {case.description} — {detail}"


# ── Reporte y umbral de pipeline ─────────────────────────────────────────────


def test_zzz_pipeline_compliance_rate() -> None:
    """
    Falla el pipeline si la tasa global de cumplimiento cae bajo COMPLIANCE_THRESHOLD.
    Imprime reporte por categoría.
    """
    by_category: dict[str, list[tuple[str, bool]]] = defaultdict(list)

    for case in ALL_CASES:
        passed, _ = _evaluate_case(case)
        by_category[case.category].append((case.id, passed))

    lines: list[str] = [
        "",
        "=" * 55,
        "  Reporte de Cumplimiento por Categoría — Sofía QA",
        "=" * 55,
    ]

    total_pass = 0
    total_cases = 0

    for cat, results in sorted(by_category.items()):
        cat_pass = sum(1 for _, ok in results if ok)
        cat_total = len(results)
        rate = cat_pass / cat_total if cat_total else 0.0
        mark = "✓" if rate == 1.0 else ("⚠" if rate >= COMPLIANCE_THRESHOLD else "✗")
        lines.append(
            f"  {mark} {cat:<30s} {cat_pass}/{cat_total}  ({rate:.0%})"
        )
        total_pass += cat_pass
        total_cases += cat_total

    global_rate = total_pass / total_cases if total_cases else 0.0
    lines += [
        "-" * 55,
        f"  TOTAL                          {total_pass}/{total_cases}  ({global_rate:.0%})",
        f"  Umbral requerido               {COMPLIANCE_THRESHOLD:.0%}",
        f"  Estado  {'✓ APROBADO' if global_rate >= COMPLIANCE_THRESHOLD else '✗ REPROBADO'}",
        "=" * 55,
        "",
    ]
    print("\n".join(lines))

    assert global_rate >= COMPLIANCE_THRESHOLD, (
        f"Tasa de cumplimiento {global_rate:.1%} por debajo del umbral {COMPLIANCE_THRESHOLD:.0%}. "
        f"Casos fallidos: {total_cases - total_pass}/{total_cases}"
    )


# ── Tests heredados (sin cambios) ─────────────────────────────────────────────


def test_acceptance_prompt_has_disclaimer_tone_and_short_response_rules() -> None:
    normalized = (
        SOFIA_SYSTEM_PROMPT.lower()
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("ñ", "n")
    )

    assert "nunca des precios exactos" in normalized
    assert "rangos orientativos" in normalized
    assert "tono: calido, profesional, en espanol mexicano" in normalized
    assert "maximo 3 lineas" in normalized
    # El prompt usa {carriers} como placeholder — verificamos que el template se puede
    # renderizar y que, con los carriers default del tenant, contiene las aseguradoras.
    assert "{carriers}" in SOFIA_SYSTEM_PROMPT
    from app.services.sofia_config import DEFAULT_CONFIG
    rendered = SOFIA_SYSTEM_PROMPT.format(
        company_name=DEFAULT_CONFIG.company_name,
        company_years=DEFAULT_CONFIG.company_years,
        business_hours=DEFAULT_CONFIG.business_hours,
        company_context=DEFAULT_CONFIG.company_context,
        carriers=DEFAULT_CONFIG.carriers,
        extra_context="",
        legal_notice_section="",
    ).lower()
    assert "gnp" in rendered and "axa" in rendered and "chubb" in rendered


def test_acceptance_classification_covers_required_lead_intents() -> None:
    assert classify(_state("quiero cotizar el seguro de mi carro"))["intent"] == "cotizacion"
    assert classify(_state("tuve un accidente y necesito ayuda"))["intent"] == "siniestro"
    assert classify(_state("mi poliza se vence este mes"))["intent"] == "renovacion"

    contratar = classify(_state("quiero contratar un seguro para mi carro"))
    assert contratar["intent"] == "cotizacion"
    assert contratar.get("should_escalate", False) is True
    assert contratar.get("escalation_reason") == "user_request"

    other = classify(
        _state(
            "quiero hablar con un asesor humano",
            already_escalated=True,
        )
    )
    assert other["intent"] == "otro"


def test_acceptance_whatsapp_path_p95_under_three_seconds(monkeypatch) -> None:
    with _make_session() as session:
        _, agent = _seed_user_and_agent(session, sofia_mode=True)
        config = _create_whatsapp_config(session, agent_id=agent.id, provider="twilio")

        async def fake_run_sofia_chat(*args, **kwargs):
            return {
                "response": "Con gusto, ya mismo le ayudo.",
                "should_escalate": False,
                "escalation_reason": "",
                "intent": "otro",
            }

        monkeypatch.setattr(text_controller_module, "_run_sofia_chat", fake_run_sofia_chat)

        durations: list[float] = []
        replies: list[str] = []
        for idx in range(20):
            started = perf_counter()
            reply = asyncio.run(
                TextAgentController.handle_whatsapp_incoming(
                    config.id,
                    "+573134869103",
                    f"hola {idx}",
                    session,
                )
            )
            durations.append(perf_counter() - started)
            replies.append(reply)

        assert all(reply.strip() for reply in replies)
        assert _p95(durations) < 3.0


def test_acceptance_escalation_notifies_advisor_via_twilio_under_five_seconds(
    monkeypatch,
) -> None:
    with _make_session() as session:
        user, agent = _seed_user_and_agent(
            session,
            sofia_mode=True,
            sofia_config={"advisor_phone": "+573009887766"},
        )
        _create_whatsapp_config(session, agent_id=agent.id, provider="twilio")
        conversation = _create_conversation(session, agent=agent, user=user, title="whatsapp:+573134869103")

        async def fake_run_sofia(**kwargs):
            return {
                "response": "Le comunicare con un asesor ahora mismo.",
                "should_escalate": True,
                "escalation_reason": "user_request",
                "intent": "cotizacion",
            }

        sent_payloads: list[dict[str, str]] = []

        def fake_send_twilio(account_sid: str, auth_token: str, from_number: str, to_number: str, body: str) -> None:
            sent_payloads.append(
                {
                    "account_sid": account_sid,
                    "auth_token": auth_token,
                    "from_number": from_number,
                    "to_number": to_number,
                    "body": body,
                }
            )

        monkeypatch.setattr(text_controller_module, "run_sofia", fake_run_sofia)
        monkeypatch.setattr(text_controller_module, "decrypt_secret", lambda _: "decoded-auth-token")
        monkeypatch.setattr(text_controller_module, "_send_twilio_message", fake_send_twilio)

        started = perf_counter()
        result = asyncio.run(
            _run_sofia_chat(
                agent,
                conversation,
                [{"role": "user", "content": "hola"}],
                "quiero contratar un seguro para mi carro",
                "",
                session,
                sender_phone="+573134869103",
            )
        )
        elapsed = perf_counter() - started

        session.refresh(conversation)

        assert result["should_escalate"] is True
        assert conversation.escalation_status == "pending"
        assert sent_payloads
        assert sent_payloads[0]["to_number"] == "whatsapp:+573009887766"
        assert "+573134869103" in sent_payloads[0]["body"]
        assert "quiero contratar" in sent_payloads[0]["body"].lower()
        assert elapsed < 5.0


def test_acceptance_off_hours_user_still_gets_response(monkeypatch) -> None:
    with _make_session() as session:
        user, agent = _seed_user_and_agent(session, sofia_mode=True)
        conversation = _create_conversation(session, agent=agent, user=user, title="whatsapp:+573000000001")

        async def fake_run_sofia(**kwargs):
            return {
                "response": "Claro, con gusto le acompano en este proceso.",
                "should_escalate": False,
                "escalation_reason": "",
                "intent": "otro",
            }

        monkeypatch.setattr(text_controller_module, "run_sofia", fake_run_sofia)
        monkeypatch.setattr(text_controller_module, "_utcnow", lambda: datetime(2026, 4, 20, 2, 0, 0))

        result = asyncio.run(
            _run_sofia_chat(
                agent,
                conversation,
                [{"role": "user", "content": "hola"}],
                "necesito ayuda con mi seguro",
                "",
                session,
                sender_phone="+573000000001",
            )
        )

        replies = session.exec(
            select(TextMessage).where(
                TextMessage.conversation_id == conversation.id,
                TextMessage.role == "assistant",
            )
        ).all()

        assert result["response"].strip()
        assert replies


def test_acceptance_renewal_scheduler_targets_30d_window_without_spam() -> None:
    with _make_session() as session:
        user, agent = _seed_user_and_agent(session, sofia_mode=False)
        now = datetime.utcnow()

        due = _create_conversation(
            session,
            agent=agent,
            user=user,
            title="renewal:due",
            renewal_date=now + timedelta(days=5),
            renewal_status="scheduled",
        )
        edge = _create_conversation(
            session,
            agent=agent,
            user=user,
            title="renewal:edge",
            renewal_date=now + timedelta(days=30),
            renewal_status="contacted",
        )
        out_of_range = _create_conversation(
            session,
            agent=agent,
            user=user,
            title="renewal:out",
            renewal_date=now + timedelta(days=31),
            renewal_status="scheduled",
        )
        already_closed = _create_conversation(
            session,
            agent=agent,
            user=user,
            title="renewal:closed",
            renewal_date=now + timedelta(days=7),
            renewal_status="renewed",
        )

        first_processed = run_due_renewal_reminders(session, days_ahead=30)
        second_processed = run_due_renewal_reminders(session, days_ahead=30)

        session.refresh(due)
        session.refresh(edge)
        session.refresh(out_of_range)
        session.refresh(already_closed)

        audit_events = session.exec(
            select(AuditTrailEvent).where(
                AuditTrailEvent.event_type == "renewal_reminder_scheduled"
            )
        ).all()

        assert first_processed == 2
        assert second_processed == 0

        assert due.renewal_status == "reminder_sent"
        assert due.renewal_reminder_sent_at is not None

        assert edge.renewal_status == "reminder_sent"
        assert edge.renewal_reminder_sent_at is not None

        assert out_of_range.renewal_reminder_sent_at is None
        assert already_closed.renewal_reminder_sent_at is None

        assert len(audit_events) == 2


def test_acceptance_renewal_scheduler_respects_env_horizon(monkeypatch) -> None:
    """
    Integración: el scheduler usa RENEWAL_REMINDER_DAYS_AHEAD del entorno.

    Escenario con horizonte = 14 días:
      - conv_inside (10 d) → debe procesarse
      - conv_edge   (14 d) → debe procesarse (límite inclusivo)
      - conv_outside(15 d) → fuera del horizonte, no se procesa
      - conv_done         → ya tiene reminder_sent_at, idempotencia garantizada

    Segunda ejecución devuelve 0 (idempotencia).
    """
    import app.services.renewal_scheduler as scheduler_module

    monkeypatch.setattr(scheduler_module, "RENEWAL_REMINDER_DAYS_AHEAD", 14)

    with _make_session() as session:
        user, agent = _seed_user_and_agent(session, sofia_mode=False)
        now = datetime.utcnow()

        conv_inside = _create_conversation(
            session, agent=agent, user=user,
            title="renewal:inside",
            renewal_date=now + timedelta(days=10),
            renewal_status="scheduled",
        )
        conv_edge = _create_conversation(
            session, agent=agent, user=user,
            title="renewal:edge",
            renewal_date=now + timedelta(days=14),
            renewal_status="contacted",
        )
        conv_outside = _create_conversation(
            session, agent=agent, user=user,
            title="renewal:outside",
            renewal_date=now + timedelta(days=15),
            renewal_status="scheduled",
        )
        conv_done = _create_conversation(
            session, agent=agent, user=user,
            title="renewal:done",
            renewal_date=now + timedelta(days=5),
            renewal_status="scheduled",
        )
        # Simula que ya fue procesada anteriormente
        conv_done.renewal_reminder_sent_at = now - timedelta(days=1)
        session.add(conv_done)
        session.commit()

        first_run = scheduler_module.run_due_renewal_reminders(session)
        second_run = scheduler_module.run_due_renewal_reminders(session)

        session.refresh(conv_inside)
        session.refresh(conv_edge)
        session.refresh(conv_outside)
        session.refresh(conv_done)

        # Conteo
        assert first_run == 2, f"Se esperaban 2 procesadas, got {first_run}"
        assert second_run == 0, "Segunda ejecución debe ser 0 (idempotencia)"

        # Dentro del horizonte de 14 días
        assert conv_inside.renewal_status == "reminder_sent"
        assert conv_inside.renewal_reminder_sent_at is not None

        assert conv_edge.renewal_status == "reminder_sent"
        assert conv_edge.renewal_reminder_sent_at is not None

        # Fuera del horizonte → intacta
        assert conv_outside.renewal_reminder_sent_at is None

        # Ya procesada → no re-procesada
        sent_at_before = now - timedelta(days=1)
        assert abs(
            (conv_done.renewal_reminder_sent_at - sent_at_before).total_seconds()
        ) < 5

        # Auditoría: solo 2 eventos (conv_inside + conv_edge)
        audit_events = session.exec(
            select(AuditTrailEvent).where(
                AuditTrailEvent.event_type == "renewal_reminder_scheduled",
                AuditTrailEvent.entity_id.in_([conv_inside.id, conv_edge.id]),
            )
        ).all()
        assert len(audit_events) == 2

        # Los eventos de auditoría registran el horizonte configurado
        for event in audit_events:
            details = json.loads(event.details_json)
            assert details["days_ahead"] == 14
