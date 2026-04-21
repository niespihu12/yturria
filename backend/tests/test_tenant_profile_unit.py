"""
Pruebas de backward compatibility y perfil de tenant configurable.

Cubre:
  - TenantProfile usa valores Yturria por defecto (sin env vars)
  - Env vars sobrescriben cada campo de TenantProfile (TENANT_LEGAL_NOTICE y alias TENANT_LEGAL_DISCLAIMER)
  - SofiaConfig hereda defaults de TENANT cuando los campos no están en JSON
  - _coerce_config: business_name (legacy UI) → company_name
  - _coerce_config: company_name explícito sobrevive sin alteración
  - _coerce_config: legal_disclaimer (nombre antiguo) → legal_notice (backward compat)
  - _coerce_config: carriers y legal_notice nuevos fluyen al config
  - Configs existentes vacías ({}) usan tenant por defecto (backward compat)
  - Configs con escalation_threshold conservan clamping [1, 20]
  - SOFIA_VOICE_PROMPT y SOFIA_FIRST_MESSAGE reflejan TENANT
  - respond() formatea prompt sin KeyError cuando carriers/legal_notice presentes
  - legal_notice_section vacío cuando legal_notice es empty string
  - legal_notice_section poblado cuando legal_notice tiene valor
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.utils.client_defaults import (
    TenantProfile,
    _build_first_message,
    _build_voice_prompt,
    _load_tenant_profile,
    TENANT,
)
from app.services.sofia_config import DEFAULT_CONFIG, SofiaConfig
from app.services.sofia_graph import _coerce_config
from app.services.sofia_prompts import SOFIA_SYSTEM_PROMPT


# ── TenantProfile defaults ────────────────────────────────────────────────────

def test_tenant_default_company_name():
    t = TenantProfile()
    assert t.company_name == "Yturria Agente de Seguros"


def test_tenant_default_company_years():
    t = TenantProfile()
    assert t.company_years == "75"


def test_tenant_default_carriers_contains_gnp():
    t = TenantProfile()
    assert "GNP" in t.carriers


def test_tenant_default_legal_notice_is_empty():
    t = TenantProfile()
    assert t.legal_notice == ""


def test_tenant_default_business_hours_non_empty():
    t = TenantProfile()
    assert t.business_hours


# ── Env var overrides ─────────────────────────────────────────────────────────

def test_load_tenant_profile_overrides_company_name(monkeypatch):
    monkeypatch.setenv("TENANT_COMPANY_NAME", "Seguros Beta")
    t = _load_tenant_profile()
    assert t.company_name == "Seguros Beta"


def test_load_tenant_profile_overrides_company_years(monkeypatch):
    monkeypatch.setenv("TENANT_COMPANY_YEARS", "10")
    t = _load_tenant_profile()
    assert t.company_years == "10"


def test_load_tenant_profile_overrides_carriers(monkeypatch):
    monkeypatch.setenv("TENANT_CARRIERS", "GNP, AXA")
    t = _load_tenant_profile()
    assert t.carriers == "GNP, AXA"


def test_load_tenant_profile_overrides_legal_notice_canonical(monkeypatch):
    monkeypatch.setenv("TENANT_LEGAL_NOTICE", "Precios orientativos, no vinculantes.")
    t = _load_tenant_profile()
    assert t.legal_notice == "Precios orientativos, no vinculantes."


def test_load_tenant_profile_overrides_legal_notice_legacy_alias(monkeypatch):
    monkeypatch.delenv("TENANT_LEGAL_NOTICE", raising=False)
    monkeypatch.setenv("TENANT_LEGAL_DISCLAIMER", "Compat legado.")
    t = _load_tenant_profile()
    assert t.legal_notice == "Compat legado."


def test_load_tenant_profile_overrides_business_hours(monkeypatch):
    monkeypatch.setenv("TENANT_BUSINESS_HOURS", "L-V 8:00-17:00")
    t = _load_tenant_profile()
    assert t.business_hours == "L-V 8:00-17:00"


def test_load_tenant_profile_overrides_company_context(monkeypatch):
    monkeypatch.setenv("TENANT_COMPANY_CONTEXT", "Seguros marítimos en el norte del país")
    t = _load_tenant_profile()
    assert t.company_context == "Seguros marítimos en el norte del país"


def test_load_tenant_profile_strips_whitespace(monkeypatch):
    monkeypatch.setenv("TENANT_COMPANY_NAME", "  Seguros Gamma  ")
    t = _load_tenant_profile()
    assert t.company_name == "Seguros Gamma"


# ── SofiaConfig defaults from TENANT ─────────────────────────────────────────

def test_sofia_config_default_company_name_matches_tenant():
    cfg = SofiaConfig()
    assert cfg.company_name == TENANT.company_name


def test_sofia_config_default_carriers_matches_tenant():
    cfg = SofiaConfig()
    assert cfg.carriers == TENANT.carriers


def test_sofia_config_default_legal_notice_matches_tenant():
    cfg = SofiaConfig()
    assert cfg.legal_notice == TENANT.legal_notice


def test_default_config_escalation_threshold_unchanged():
    assert DEFAULT_CONFIG.escalation_threshold == 4


# ── _coerce_config backward compat ───────────────────────────────────────────

def test_coerce_empty_dict_uses_tenant_company_name():
    cfg = _coerce_config({})
    assert cfg.company_name == TENANT.company_name


def test_coerce_empty_dict_uses_tenant_carriers():
    cfg = _coerce_config({})
    assert cfg.carriers == TENANT.carriers


def test_coerce_legacy_business_name_maps_to_company_name():
    cfg = _coerce_config({"business_name": "Seguros Legacy S.A."})
    assert cfg.company_name == "Seguros Legacy S.A."


def test_coerce_explicit_company_name_wins_over_business_name():
    cfg = _coerce_config({"company_name": "Explícito", "business_name": "Ignorado"})
    assert cfg.company_name == "Explícito"


def test_coerce_carriers_explicit_value_is_preserved():
    cfg = _coerce_config({"carriers": "Solo GNP"})
    assert cfg.carriers == "Solo GNP"


def test_coerce_legal_notice_explicit_value_is_preserved():
    cfg = _coerce_config({"legal_notice": "No vinculante."})
    assert cfg.legal_notice == "No vinculante."


def test_coerce_legal_disclaimer_legacy_name_maps_to_legal_notice():
    cfg = _coerce_config({"legal_disclaimer": "Compat legado."})
    assert cfg.legal_notice == "Compat legado."


def test_coerce_company_years_explicit_value_is_preserved():
    cfg = _coerce_config({"company_years": "30"})
    assert cfg.company_years == "30"


def test_coerce_escalation_threshold_still_clamped():
    cfg = _coerce_config({"escalation_threshold": 99})
    assert cfg.escalation_threshold == 20


def test_coerce_none_input_returns_default():
    cfg = _coerce_config(None)
    assert cfg.company_name == TENANT.company_name


# ── Voice prompt & first message reflect TENANT ───────────────────────────────

def test_voice_prompt_contains_company_name():
    t = TenantProfile(company_name="Seguros Test")
    prompt = _build_voice_prompt(t)
    assert "Seguros Test" in prompt


def test_voice_prompt_contains_carriers():
    t = TenantProfile(carriers="Solo HDI")
    prompt = _build_voice_prompt(t)
    assert "Solo HDI" in prompt


def test_voice_prompt_does_not_contain_legal_notice_section():
    # El aviso legal va en el primer mensaje, no en el voice prompt del LLM.
    t = TenantProfile(legal_notice="No vinculante.")
    prompt = _build_voice_prompt(t)
    assert "AVISO LEGAL" not in prompt


def test_first_message_contains_company_name():
    t = TenantProfile(company_name="Seguros Omega")
    msg = _build_first_message(t)
    assert "Seguros Omega" in msg


# ── SOFIA_SYSTEM_PROMPT template format keys ──────────────────────────────────

def test_system_prompt_accepts_carriers_key():
    rendered = SOFIA_SYSTEM_PROMPT.format(
        company_name="Test",
        company_years="10",
        business_hours="L-V 9-18",
        company_context="Seguros",
        carriers="GNP, AXA",
        extra_context="",
        legal_notice_section="",
    )
    assert "GNP, AXA" in rendered


def test_system_prompt_accepts_legal_notice_section():
    rendered = SOFIA_SYSTEM_PROMPT.format(
        company_name="Test",
        company_years="10",
        business_hours="L-V 9-18",
        company_context="Seguros",
        carriers="GNP",
        extra_context="",
        legal_notice_section="\nAVISO LEGAL: No vinculante.",
    )
    assert "No vinculante." in rendered


def test_system_prompt_empty_legal_notice_section_no_aviso():
    rendered = SOFIA_SYSTEM_PROMPT.format(
        company_name="Test",
        company_years="10",
        business_hours="L-V 9-18",
        company_context="Seguros",
        carriers="GNP",
        extra_context="",
        legal_notice_section="",
    )
    assert "AVISO LEGAL" not in rendered
