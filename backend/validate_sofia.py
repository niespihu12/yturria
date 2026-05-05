"""Script de validación de Sofía contra el dataset de QA.

Uso:
    uv run python validate_sofia.py
    uv run python validate_sofia.py --dataset=tests/validation_dataset/qa_pairs.json
    uv run python validate_sofia.py --agent-id=<id> --threshold=95

Requiere:
    DATABASE_URL y OPENAI_API_KEY en el entorno (o .env).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DATASET_DEFAULT = Path(__file__).parent / "tests/validation_dataset/qa_pairs.json"
ESCALATION_REASONS_THAT_COUNT = {"siniestro", "active_claim"}


def _load_dataset(path: str) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("El dataset debe ser una lista JSON de objetos QA.")
    return data


def _run_sofia(question: str, config: dict) -> dict:
    """Invocar el grafo Sofía de forma síncrona y retornar el estado final."""
    from app.services.sofia_graph import build_sofia_graph, SofiaState

    graph = build_sofia_graph()
    initial_state: SofiaState = {
        "messages": [],
        "user_message": question,
        "intent": "",
        "rag_context": "",
        "should_escalate": False,
        "escalation_reason": "",
        "message_count": 1,
        "response": "",
        "system_prompt_override": "",
        "config": config,
        "already_escalated": False,
        "has_open_appointment": False,
        "uncertainty_count": 0,
    }
    return graph.invoke(initial_state)


def _check_result(pair: dict, state: dict) -> tuple[bool, str]:
    """Retorna (passed, reason)."""
    response = (state.get("response") or "").lower()
    should_escalate = bool(state.get("should_escalate"))

    if pair.get("should_escalate") and not should_escalate:
        return False, "esperaba escalación pero no ocurrió"

    if not pair.get("should_escalate") and should_escalate:
        reason = state.get("escalation_reason", "")
        if reason not in ESCALATION_REASONS_THAT_COUNT:
            pass  # escalaciones opcionales no penalizan
        else:
            return False, f"escaló inesperadamente: {reason}"

    missing = [kw for kw in pair.get("expected_contains", []) if kw.lower() not in response]
    if missing:
        return False, f"respuesta no contiene: {missing}"

    return True, "ok"


def main() -> None:
    parser = argparse.ArgumentParser(description="Validación de Sofía contra dataset QA")
    parser.add_argument("--dataset", default=str(DATASET_DEFAULT))
    parser.add_argument("--agent-id", default="", help="ID del agente para cargar su configuración (opcional)")
    parser.add_argument("--threshold", type=float, default=95.0, help="% mínimo de precisión para aprobar")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    pairs = _load_dataset(args.dataset)
    print(f"\n{'='*60}")
    print(f"Dataset: {args.dataset} ({len(pairs)} preguntas)")
    print(f"Umbral mínimo: {args.threshold}%")
    print("=" * 60)

    config: dict = {}
    if args.agent_id:
        try:
            from sqlmodel import Session, select
            from app.config.db import engine
            from app.models.TextAgent import TextAgent
            import ast

            with Session(engine) as session:
                agent = session.get(TextAgent, args.agent_id)
                if agent:
                    config = json.loads(agent.sofia_config_json or "{}")
                    print(f"Config del agente '{agent.name}' cargada.\n")
                else:
                    print(f"Agente {args.agent_id} no encontrado, usando config por defecto.\n")
        except Exception as exc:
            print(f"WARN: No se pudo cargar config del agente: {exc}\n")

    passed = 0
    failed = 0
    errors: list[dict] = []

    for i, pair in enumerate(pairs, 1):
        q_id = pair.get("id", f"Q{i:03d}")
        question = pair.get("question", "")
        category = pair.get("category", "")

        try:
            state = _run_sofia(question, config)
            ok, reason = _check_result(pair, state)
        except Exception as exc:
            ok = False
            reason = f"excepción: {exc}"
            state = {}

        if ok:
            passed += 1
            if args.verbose:
                print(f"  ✓ [{q_id}] {category}: {question[:60]}")
        else:
            failed += 1
            errors.append({"id": q_id, "question": question, "reason": reason})
            print(f"  ✗ [{q_id}] {category}: {question[:60]}")
            print(f"       → {reason}")
            if args.verbose and state.get("response"):
                print(f"       Respuesta: {state['response'][:120]}")

    total = passed + failed
    accuracy = (passed / total * 100) if total > 0 else 0.0

    print(f"\n{'='*60}")
    print(f"Resultado: {passed}/{total} correctas ({accuracy:.1f}%)")
    print(f"Umbral: {args.threshold}%  →  {'APROBADO ✓' if accuracy >= args.threshold else 'REPROBADO ✗'}")
    print("=" * 60)

    if errors:
        print(f"\nFallos ({len(errors)}):")
        for e in errors:
            print(f"  [{e['id']}] {e['question'][:70]}")
            print(f"       {e['reason']}")

    if accuracy < args.threshold:
        print(f"\nPrecisión {accuracy:.1f}% por debajo del umbral {args.threshold}%. Deploy bloqueado.")
        sys.exit(1)

    print(f"\nValidación aprobada. Puede proceder con el deploy.")


if __name__ == "__main__":
    main()
