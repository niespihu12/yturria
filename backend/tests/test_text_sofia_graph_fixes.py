"""Regresiones del grafo de Sofía: prompt, guard, keywords de siniestro, API key y threads."""
from __future__ import annotations

import asyncio
import threading

import pytest
from langchain_core.messages import AIMessage, HumanMessage

import app.services.sofia_graph as sofia_graph
from app.services.sofia_graph import classify, guard, respond, route_intent, run_sofia

# conftest reemplaza _make_llm durante cada test; se guarda la implementación real.
_REAL_MAKE_LLM = sofia_graph._make_llm


def _state(user_message: str = "hola", **overrides) -> dict:
    state = {
        "messages": [HumanMessage(content=user_message)],
        "user_message": user_message,
        "intent": "",
        "rag_context": "",
        "should_escalate": False,
        "escalation_reason": "",
        "message_count": 0,
        "response": "",
        "system_prompt_override": "",
        "config": {},
        "already_escalated": False,
        "has_open_appointment": False,
    }
    state.update(overrides)
    return state


class _RecordingLLM:
    def __init__(self, reply: str = "Respuesta de prueba.", calls: list | None = None):
        self.reply = reply
        self.calls = calls if calls is not None else []

    def invoke(self, messages):
        self.calls.append(messages)
        return AIMessage(content=self.reply)


# ── Claim keywords (palabra completa) ────────────────────────────────────────

@pytest.mark.parametrize("message", ["¿Eres un robot?", "me gusta la robotica", "soy chocolatero"])
def test_claim_keywords_do_not_match_substrings(message: str) -> None:
    assert classify(_state(message))["intent"] != "siniestro"


@pytest.mark.parametrize(
    "message",
    ["me robaron el carro", "fue un robo", "hubo varios choques", "tuve un accidente", "reporte de hurto"],
)
def test_claim_keywords_match_whole_words(message: str) -> None:
    assert classify(_state(message))["intent"] == "siniestro"


# ── Escalaciones duplicadas ──────────────────────────────────────────────────

def test_siniestro_routes_to_respond_when_already_escalated() -> None:
    assert route_intent({"intent": "siniestro", "already_escalated": True}) == "respond"
    assert route_intent({"intent": "siniestro", "already_escalated": False}) == "escalate_to_human"


def test_threshold_escalation_blocked_after_resolution() -> None:
    blocked = classify(
        _state("gracias", message_count=10, allow_threshold_escalation=False)
    )
    assert not blocked.get("should_escalate")

    allowed = classify(_state("gracias", message_count=10))
    assert allowed.get("should_escalate") is True
    assert allowed.get("escalation_reason") == "auto_threshold"


def test_uncertainty_escalation_skipped_when_already_escalated(monkeypatch) -> None:
    result = guard(
        _state(
            response="No estoy seguro, permítame consultar.",
            uncertainty_count=1,
            already_escalated=True,
        )
    )
    assert not result.get("should_escalate")
    assert result.get("uncertainty_count") == 2


# ── Guard: veredicto normalizado ─────────────────────────────────────────────

@pytest.mark.parametrize("verdict", ['"OK"', "OK.", "ok", "Ok, cumple con todas las reglas.", "CUMPLE", "Sí"])
def test_guard_keeps_original_on_approval_variants(monkeypatch, verdict: str) -> None:
    monkeypatch.setattr(sofia_graph, "_make_llm", lambda *a, **k: _RecordingLLM(verdict))
    original = "Con gusto le ayudo a cotizar su seguro de auto."
    assert guard(_state(response=original)) == {}


def test_guard_replaces_response_with_real_correction(monkeypatch) -> None:
    corrected = "Con gusto le ayudo. El precio exacto lo confirma un asesor."
    monkeypatch.setattr(sofia_graph, "_make_llm", lambda *a, **k: _RecordingLLM(corrected))
    result = guard(_state(response="Su póliza cuesta exactamente $1,234.56 al mes."))
    assert result == {"response": corrected}


# ── Prompt: RAG / aviso legal / llaves ───────────────────────────────────────

def _system_text_for(monkeypatch, **state_overrides) -> str:
    calls: list = []
    monkeypatch.setattr(sofia_graph, "_make_llm", lambda *a, **k: _RecordingLLM(calls=calls))
    respond(_state(**state_overrides))
    assert calls, "respond() no invocó al LLM"
    return str(calls[0][0].content)


def test_custom_prompt_receives_rag_context_and_legal_notice(monkeypatch) -> None:
    system_text = _system_text_for(
        monkeypatch,
        system_prompt_override="Eres Sofía, asistente virtual.",
        rag_context="Contexto de base de conocimiento:\nEl deducible del plan Oro es 10%.",
        config={"legal_notice": "Aviso de privacidad XYZ", "company_name": "Seguros Demo"},
    )
    assert "Eres Sofía, asistente virtual." in system_text
    assert "El deducible del plan Oro es 10%." in system_text
    assert system_text.count("Contexto de base de conocimiento") == 1
    assert "AVISO LEGAL: Aviso de privacidad XYZ" in system_text
    assert "Seguros Demo" in system_text


def test_custom_prompt_with_braces_does_not_crash(monkeypatch) -> None:
    prompt = 'Responde en JSON {"campo": 1} y usa {variable_desconocida} y {0} tal cual.'
    system_text = _system_text_for(monkeypatch, system_prompt_override=prompt)
    assert '{"campo": 1}' in system_text
    assert "{variable_desconocida}" in system_text


def test_known_placeholders_in_custom_prompt_are_filled(monkeypatch) -> None:
    system_text = _system_text_for(
        monkeypatch,
        system_prompt_override="Empresa: {company_name}. {extra_context}",
        rag_context="Dato clave del KB",
        config={"company_name": "Acme Seguros"},
    )
    assert "Empresa: Acme Seguros." in system_text
    assert system_text.count("Dato clave del KB") == 1
    assert "{company_name}" not in system_text


def test_default_template_used_when_no_override(monkeypatch) -> None:
    system_text = _system_text_for(monkeypatch, rag_context="Info KB")
    assert "Info KB" in system_text
    assert "{company_name}" not in system_text


# ── API key del dueño y ejecución fuera del event loop ───────────────────────

def test_make_llm_uses_explicit_api_key() -> None:
    llm = _REAL_MAKE_LLM("gpt-4.1-mini", 0.0, 10, api_key="sk-owner-key")
    assert llm.openai_api_key.get_secret_value() == "sk-owner-key"

    token = sofia_graph._SOFIA_API_KEY.set("sk-from-context")
    try:
        llm = _REAL_MAKE_LLM("gpt-4.1-mini", 0.0, 10)
    finally:
        sofia_graph._SOFIA_API_KEY.reset(token)
    assert llm.openai_api_key.get_secret_value() == "sk-from-context"


def test_run_sofia_passes_owner_key_and_runs_off_event_loop(monkeypatch) -> None:
    seen_keys: list = []
    seen_threads: list = []

    def fake_make_llm(*args, **kwargs):
        seen_keys.append(kwargs.get("api_key") or sofia_graph._SOFIA_API_KEY.get())
        seen_threads.append(threading.get_ident())
        return _RecordingLLM("otro")

    monkeypatch.setattr(sofia_graph, "_make_llm", fake_make_llm)

    async def _run():
        loop_thread = threading.get_ident()
        result = await run_sofia(
            user_message="hola, ¿qué seguros manejan?",
            history=[{"role": "user", "content": "hola, ¿qué seguros manejan?"}],
            rag_context="",
            message_count=1,
            api_key="sk-owner-key",
        )
        return loop_thread, result

    loop_thread, result = asyncio.run(_run())

    assert result["response"]
    assert seen_keys and all(key == "sk-owner-key" for key in seen_keys)
    assert all(ident != loop_thread for ident in seen_threads)
    assert sofia_graph._SOFIA_API_KEY.get() is None


def test_run_sofia_persisted_uncertainty_triggers_escalation(monkeypatch) -> None:
    def fake_make_llm(*args, **kwargs):
        return _RecordingLLM("No estoy seguro de ese dato, permítame consultar.")

    monkeypatch.setattr(sofia_graph, "_make_llm", fake_make_llm)

    result = asyncio.run(
        run_sofia(
            user_message="¿cuánto cubre?",
            history=[{"role": "user", "content": "¿cuánto cubre?"}],
            rag_context="",
            message_count=1,
            uncertainty_count=1,
        )
    )
    assert result["should_escalate"] is True
    assert result["escalation_reason"] == "uncertainty_detected"
    assert result["uncertainty_count"] == 2


def test_run_sofia_caps_history(monkeypatch) -> None:
    calls: list = []
    monkeypatch.setattr(sofia_graph, "_make_llm", lambda *a, **k: _RecordingLLM(calls=calls))
    monkeypatch.setattr(sofia_graph, "SOFIA_HISTORY_LIMIT", 4)

    history = []
    for idx in range(20):
        history.append({"role": "user", "content": f"u{idx}"})
        history.append({"role": "assistant", "content": f"a{idx}"})
    history.append({"role": "user", "content": "ultimo"})

    asyncio.run(
        run_sofia(user_message="ultimo", history=history, rag_context="", message_count=1)
    )
    respond_call = next(c for c in calls if len(c) > 1)
    # system + 4 mensajes previos + mensaje actual
    assert len(respond_call) == 6
