# Yturria — Backend

API REST + scheduler de tareas para la plataforma de agentes conversacionales de Yturria Seguros.
Construida con **FastAPI + SQLModel + LangGraph**. Soporta agentes de voz (ElevenLabs), agentes de texto con RAG y el modo Sofía (flujo especializado para seguros mexicanos).

---

## Tabla de contenido

1. [Arquitectura](#arquitectura)
2. [Modelos de datos](#modelos-de-datos)
3. [Flujo de canales](#flujo-de-canales)
4. [Bootstrap de cliente](#bootstrap-de-cliente)
5. [Modo Sofía](#modo-sofía)
6. [Escalación](#escalación)
7. [Embed público](#embed-público)
8. [Cumplimiento legal — primer mensaje](#cumplimiento-legal--primer-mensaje)
9. [Configuración de proveedores LLM](#configuración-de-proveedores-llm)
10. [Variables de entorno](#variables-de-entorno)
11. [Migración de esquema](#migración-de-esquema)
12. [Operación en producción](#operación-en-producción)
13. [Suite de pruebas](#suite-de-pruebas)
14. [Checklist de salida](#checklist-de-salida)

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                        FastAPI App                          │
│                                                             │
│  /api/auth          AuthController    → JWT + MFA           │
│  /api/agents        AgentController   → Voz (ElevenLabs)    │
│  /api/text-agents   TextAgentController → Texto + RAG       │
│  /api/webhooks      WebhooksRouter    → Meta / Twilio       │
│  /api/privacy       PrivacyController → GDPR / auditoría    │
│                                                             │
│  Background task: renewal_scheduler (cada 1 h)             │
└────────────────┬────────────────────────────────────────────┘
                 │ SQLModel (PyMySQL / psycopg)
                 ▼
          Base de datos (MySQL 8 / PostgreSQL 15)
```

### Capas internas

| Capa | Responsabilidad |
|---|---|
| `routes/` | Binding HTTP → controller, validación mínima de forma |
| `controllers/` | Lógica de negocio, orquestación, persistencia |
| `services/` | Integraciones externas (LangGraph/Sofía, Google Calendar, scheduler) |
| `models/` | ORM SQLModel — fuente de verdad del esquema |
| `utils/` | JWT, cripto, roles, defaults de cliente |

---

## Modelos de datos

| Tabla | Descripción |
|---|---|
| `users` | Cuentas con roles: `agent / supervisor / admin / super_admin` |
| `tokens` | Tokens de sesión y recuperación de contraseña |
| `text_agents` | Agentes de texto: provider, modelo, prompt, `sofia_mode`, `legal_notice`, `embed_token` |
| `text_conversations` | Conversaciones por canal; campos de escalación y renovación |
| `text_messages` | Mensajes individuales con `role`, `provider`, `model`, `token_usage` |
| `text_agent_whatsapp_configs` | Configuración Meta Cloud API o Twilio por agente |
| `text_agent_tools` | Herramientas HTTP externas por agente (GET/POST/PUT/PATCH/DELETE) |
| `text_agent_knowledge_base` | Índice de bases de conocimiento vinculadas al agente |
| `text_knowledge_base_documents` | Documentos vectorizados para RAG |
| `text_knowledge_base_chunks` | Chunks con embeddings (500 tokens, overlap 80) |
| `text_provider_configs` | API keys LLM por usuario (cifradas con Fernet) |
| `text_appointments` | Citas agendadas (texto y voz), Google Calendar sync |
| `audit_trail_events` | Registro inmutable de eventos de negocio |
| `data_privacy_requests` | Solicitudes GDPR/LFPDPPP |

---

## Flujo de canales

Todos los canales convergen en **`TextAgentController`**. El núcleo es idéntico; sólo difiere la capa de transporte.

### Canal 1 — Chat autenticado (`POST /api/text-agents/{id}/chat`)

```
Cliente autenticado
  → POST /api/text-agents/{id}/chat  { message, conversation_id? }
  → [nuevo] TextConversation  o  [existente] lookup por conversation_id
  → Guardar TextMessage(role=user)
  → Recuperar historial de la conversación
  → RAG context (top-5 chunks)
  → [sofia_mode=true]  → _run_sofia_chat → LangGraph
  → [sofia_mode=false] → _dispatch_llm (OpenAI / Gemini) + tool loop
  → _maybe_prepend_legal_notice  (solo primer turno)
  → Guardar TextMessage(role=assistant)
  → { conversation_id, response, provider, model, token_usage }
```

### Canal 2 — Webhook Meta (WhatsApp Cloud API)

```
Meta → POST /api/webhooks/whatsapp/{config_id}/meta  { body JSON }
  → Validar config activa y provider=meta
  → Extraer sender + texto
  → handle_whatsapp_incoming(config_id, sender, text)
  → [misma lógica de conversación que canal autenticado]
  → _send_meta_message(access_token, phone_number_id, sender, reply)
  → HTTP 200 { status: ok }
```

Verificación de suscripción: `GET /api/webhooks/whatsapp/{config_id}/meta?hub.mode=subscribe&hub.verify_token=…`

### Canal 3 — Webhook Twilio (WhatsApp Business)

```
Twilio → POST /api/webhooks/whatsapp/{config_id}/twilio  (form-data Body/From)
  → Validar config activa y provider=twilio
  → handle_whatsapp_incoming(config_id, sender, text)
  → Respuesta TwiML: <?xml …><Response><Message>{reply}</Message></Response>
```

### Canal 4 — Embed público (`POST /api/text-agents/{id}/embed/chat`)

```
iframe/widget → POST /api/text-agents/{id}/embed/chat
  { message, token, session_id, conversation_id? }
  → Validar embed_enabled + embed_token
  → session_id se persiste en localStorage del navegador
  → Misma lógica de conversación que canal autenticado
  → { conversation_id, session_id, response, … }
```

URL de integración: `GET /embed/text-agent/{id}?token={embed_token}`

---

## Bootstrap de cliente

`POST /api/agents/bootstrap` — idempotente, crea la estructura inicial para un cliente nuevo.

```
Usuario final (no super_admin)
  → AgentController.bootstrap_client   → 1 agente de voz ElevenLabs con defaults Sofía
  → TextAgentController.bootstrap_client → 1 agente de texto con sofia_mode=true

Si ya existen → devuelve los existentes sin duplicar.
Super admin → { skipped: "super_admin" } (no necesita bootstrap)
```

Defaults aplicados automáticamente al cliente:

| Campo | Valor forzado |
|---|---|
| `provider` | `openai` |
| `model` | `gpt-4.1-mini` |
| `sofia_mode` | `true` |
| `language` | `es` |
| `system_prompt` | `SOFIA_VOICE_PROMPT` (inmutable para cliente) |
| `welcome_message` | `"Hola, soy la asistente virtual de Yturria Seguros…"` |
| Voz LLM | `gpt-4.1-mini` |
| Voz TTS | `eleven_turbo_v2_5` |

---

## Modo Sofía

Flujo especializado para el caso de uso de seguros. Activado con `sofia_mode=true` en el agente.

### Grafo LangGraph (`sofia_graph.py`)

```
START → classify → [intent]
          ├─ cotizacion  → escalate_to_human
          ├─ siniestro   → escalate_to_human
          ├─ renovacion  → respond
          └─ otro        → [threshold?] escalate_to_human | respond
                  ↓
                END
```

### Clasificación de intent (`classify` node)

Orden de evaluación (sin llamada LLM si hay match):

1. **Seguimiento de cita abierta** → `otro` sin escalar
2. **claim_keywords** (`accidente`, `robo`, `choque`, `siniestro`, `reclamo`, `reclamacion`) → `siniestro`
3. **renewal_keywords** (`renov`, `venc`, `vigencia`, `continuidad`) → `renovacion`
4. **ESCALATION_PHRASES** (lista configurable, ver `sofia_prompts.py`) → intent según `quote_keywords`, `should_escalate=true`
5. **quote_keywords** (`cotiz`, `precio`, `costo`, `contratar`, `poliza`, `asegurar`) → `cotizacion`
6. **message_count ≥ escalation_threshold** → auto-escalación
7. **LLM** (`CLASSIFY_PROMPT` → OpenAI) → `cotizacion | siniestro | renovacion | otro`

### Configuración Sofía por agente (`sofia_config_json`)

```jsonc
{
  "company_name": "Yturria Agente de Seguros",
  "company_years": "75",
  "business_hours": "Lunes a viernes 9:00-18:00, sábados 9:00-14:00",
  "company_context": "Especialistas en seguros de auto, vida, gastos médicos y empresariales",
  "escalation_threshold": 4,       // rango: 1–20; default: 4
  "temperature": 0.3,
  "max_tokens": 256,
  "model": "gpt-4.1-mini",
  "advisor_phone": "+521XXXXXXXXXX",
  "advisor_whatsapp_config_id": "",
  "extra_escalation_phrases": []
}
```

**Validación en save**: `escalation_threshold` fuera de `[1, 20]` o no entero → HTTP 422.  
**Runtime**: `_coerce_config` clampea a `[1, 20]` para proteger configuraciones legadas.

---

## Escalación

### Tipos

| `escalation_reason` | Origen |
|---|---|
| `user_request` | Frase de escalación detectada en el mensaje |
| `auto_threshold` | `message_count ≥ escalation_threshold` |

### Flujo tras escalación

1. `conversation.escalation_status = "pending"`
2. Si `advisor_phone` configurado: notificación WhatsApp al asesor vía Twilio con resumen
3. Respuesta al usuario: mensaje de transición (`ESCALATION_MESSAGE`)
4. Siguiente mensaje del mismo usuario **no** genera segunda escalación (`already_escalated` check)

### Gestión desde el panel

```
GET  /api/text-agents/{id}/escalations?status=pending
PATCH /api/text-agents/{id}/escalations/{conversation_id}
      { "status": "in_progress" | "resolved" }
```

---

## Embed público

### Activación

```
PUT /api/text-agents/{id}  { "embed_enabled": true }
```

El `embed_token` se genera una sola vez en el bootstrap y no cambia.

### Integración en sitio externo

```html
<iframe
  src="https://tu-frontend.com/embed/text-agent/{AGENT_ID}?token={EMBED_TOKEN}"
  width="400" height="600"
  frameborder="0"
/>
```

### Ciclo de sesión

- `session_id` se genera en `localStorage` del navegador y persiste entre recargas.
- El backend asocia la conversación a `embed:{session_id}`.
- Si se envía `conversation_id`, la sesión existente continúa.

### Endpoints embed

```
GET  /api/text-agents/{id}/embed/info?token={token}
POST /api/text-agents/{id}/embed/chat
     { message, token, session_id, conversation_id? }
```

---

## Cumplimiento legal — primer mensaje

### Propósito

Toda conversación nueva debe incluir exactamente una vez el aviso legal definido por el negocio, independientemente del canal de entrada.

### Campo de configuración

`text_agents.legal_notice` (LONGTEXT, default `""`). Se configura por agente desde el panel.

### Mecanismo de inyección (`_maybe_prepend_legal_notice`)

```python
def _maybe_prepend_legal_notice(content, legal_notice, has_prior_assistant) -> str:
    notice = (legal_notice or "").strip()
    if not notice or has_prior_assistant:
        return content          # no-op en turnos 2+
    return f"{notice}\n\n{content}"
```

### Cobertura por canal

| Canal | Punto de inyección |
|---|---|
| Chat autenticado | Antes de guardar el primer `TextMessage(role=assistant)` |
| Embed público | Antes de guardar el primer `TextMessage(role=assistant)` |
| WhatsApp Meta | Antes de guardar el primer `TextMessage(role=assistant)` |
| WhatsApp Twilio | Antes de guardar el primer `TextMessage(role=assistant)` |
| Modo Sofía (todos los canales) | Dentro de `_run_sofia_chat`, antes de guardar |

**Garantía de no duplicación**: `has_prior_assistant = any(row.role == "assistant" for row in history_rows)` — si ya existe un mensaje de asistente en la conversación, la inyección es no-op.

---

## Configuración de proveedores LLM

### Proveedores soportados

| Provider | Modelos recomendados | Modo |
|---|---|---|
| `openai` | `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o` | API key por usuario o env global |
| `gemini` | `gemini-2.0-flash`, `gemini-1.5-pro` | API key por usuario o env global |

### Resolución de API key (prioridad)

1. **Key del usuario** (`text_provider_configs` — cifrada con Fernet)
2. **Variable de entorno global** (`OPENAI_API_KEY` / `GEMINI_API_KEY`)

Si `TEXT_AGENTS_REQUIRE_USER_KEYS=true`, solo se acepta la key del usuario.

### Gestión de keys por usuario

```
GET    /api/text-agents/provider-configs
PUT    /api/text-agents/provider-configs/{provider}   { "api_key": "sk-…" }
DELETE /api/text-agents/provider-configs/{provider}
```

Las keys se muestran enmascaradas (`sk-…****`); nunca se devuelven en claro.

---

## Variables de entorno

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `DATABASE_URL` | Sí | — | `mysql+pymysql://…` o `postgresql+psycopg://…` |
| `SECRET_KEY` | Sí | — | Clave JWT (256 bits mínimo) |
| `FERNET_KEY` | Sí | — | Clave Fernet para cifrar API keys (base64 urlsafe) |
| `FRONTEND_URL` | Sí | `http://localhost:5173` | CORS y URLs de correo |
| `OPENAI_API_KEY` | No | — | Key global OpenAI (fallback si usuario no tiene key) |
| `GEMINI_API_KEY` | No | — | Key global Gemini |
| `TEXT_AGENTS_REQUIRE_USER_KEYS` | No | `false` | Forzar key por usuario |
| `RENEWAL_REMINDER_DAYS_AHEAD` | No | `30` | Horizonte del scheduler de renovaciones (días) |
| `TEXT_TOOL_TIMEOUT_SECONDS` | No | `20` | Timeout de llamadas a herramientas externas (1–120 s) |
| `SQL_ECHO` | No | `false` | Log de queries SQL |
| `PLATFORM_SUPER_ADMIN_EMAILS` | No | — | Emails con rol `super_admin` (comma-separated) |

---

## Migración de esquema

No se usa Alembic. El esquema evoluciona mediante funciones `ensure_*` en `main.py` que se ejecutan en el lifespan de FastAPI (solo para MySQL; SQLite se gestiona con `create_all`).

### Funciones activas

| Función | Columnas que garantiza |
|---|---|
| `ensure_user_auth_columns` | `users.role`, `mfa_*` |
| `ensure_token_auth_columns` | `tokens.purpose` |
| `ensure_text_agents_content_columns` | `system_prompt`, `welcome_message` como LONGTEXT |
| `ensure_text_agent_tools_schema_columns` | `body_template`, `parameters_schema_json`, `response_mapping_json` |
| `ensure_text_appointments_columns` | `voice_agent_id`, `google_*`, `google_sync_*` |
| `ensure_kb_index_columns` | Índices de knowledge base |
| `ensure_sofia_and_escalation_columns` | `escalation_*`, `renewal_*`, `deleted_at` |
| `ensure_text_agents_legal_notice_column` | `text_agents.legal_notice` |

Todas son **idempotentes**: comprueban existencia antes de alterar.

---

## Operación en producción

### Arranque

```bash
# Instalar dependencias
uv sync

# Configurar entorno
cp .env.example .env   # editar DATABASE_URL, SECRET_KEY, FERNET_KEY, …

# Arrancar (desarrollo)
uv run uvicorn app.main:app --reload --port 8000

# Arrancar (producción)
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

### Scheduler de renovaciones

Se lanza automáticamente en el lifespan de FastAPI (MySQL únicamente). Ciclo: 1 hora.

```python
# Horizonte configurable por entorno
RENEWAL_REMINDER_DAYS_AHEAD  # default 30 días
```

Para forzar una ejecución manual:

```python
from app.services.renewal_scheduler import run_due_renewal_reminders
with Session(engine) as session:
    n = run_due_renewal_reminders(session)  # usa horizonte de entorno
    print(f"Procesados: {n}")
```

### Logs relevantes

```
renewal_scheduler processed N reminders
renewal scheduler failed                  ← revisar trazas
Sofia graph error                         ← error en LangGraph
```

### Rotación de FERNET_KEY

1. Generar nueva key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
2. Re-cifrar API keys almacenadas con la nueva key antes de rotar la variable.
3. Reiniciar el servidor.

---

## Suite de pruebas

```bash
uv run pytest                          # todos los tests
uv run pytest tests/ -v                # con detalle
uv run pytest -k acceptance            # solo suite de aceptación
uv run pytest -k legal_notice         # cumplimiento legal
uv run pytest -k escalation_threshold # threshold configurable
```

### Archivos de prueba

| Archivo | Qué cubre |
|---|---|
| `test_sofia_acceptance_matrix.py` | **50 casos de negocio** parametrizados + umbral de pipeline (≥90%) |
| `test_legal_notice_unit.py` | Inyección de aviso legal por canal y conversación existente |
| `test_escalation_threshold_unit.py` | Threshold configurable, validación HTTP, coerce/clamp |
| `test_sofia_classify_unit.py` | Clasificación de intent y supresión de re-escalación |
| `test_sofia_config_persistence_unit.py` | Persistencia de configuración Sofía |
| `test_sofia_auto_appointment_integration.py` | Cita automática desde Sofía |
| `test_voice_appointments_integration.py` | CRUD de citas voz |
| `test_sofia_datetime_parser_unit.py` | Parser de fechas para citas |
| `test_appointment_unix_timezone_unit.py` | Conversión de zonas horarias |
| `test_google_calendar_service_unit.py` | Integración Google Calendar |

### Matriz de cobertura — suite de aceptación

| Categoría | Casos | Mecanismo |
|---|---|---|
| `cotizacion_keyword` | 6 | Keyword match → `cotizacion`, sin escalar |
| `cotizacion_escalation` | 6 | Frase de escalación + keyword → escalar |
| `siniestro` | 6 | `claim_keywords` → `siniestro` |
| `renovacion` | 5 | `renewal_keywords` → `renovacion` |
| `otro_user_escalation` | 5 | Frase de escalación sin quote_keyword → `otro` + escalar |
| `suppression_escalated` | 3 | `already_escalated=True` suprime re-escalación |
| `suppression_appointment` | 3 | Cita abierta suprime auto-escalación |
| `auto_threshold` | 4 | `message_count ≥ threshold` → `auto_threshold` |
| `compliance_price` | 4 | Checker: precio exacto vs rango orientativo |
| `compliance_ai_reveal` | 4 | Checker: auto-identificación como IA |
| `compliance_length` | 4 | Checker: máximo 3 líneas por respuesta |
| **Total** | **50** | Umbral pipeline: **90%** |

---

## Checklist de salida

### Antes de merge a `main`

- [ ] `uv run pytest` — 0 fallos
- [ ] `test_zzz_pipeline_compliance_rate` — tasa ≥ 90%
- [ ] Variables de entorno de producción actualizadas (`.env` / secrets manager)
- [ ] `RENEWAL_REMINDER_DAYS_AHEAD` revisado para el horizonte de negocio
- [ ] `escalation_threshold` de agentes de producción validado (rango 1–20)
- [ ] `legal_notice` configurado en cada agente que lo requiera

### Antes de activar un nuevo agente en producción

- [ ] `legal_notice` del agente no vacío si el negocio lo requiere
- [ ] `sofia_config_json.escalation_threshold` ajustado al volumen esperado
- [ ] Webhook Meta/Twilio verificado (`hub.verify_token` configurado)
- [ ] `advisor_phone` configurado si se requieren notificaciones de escalación
- [ ] `embed_enabled` + `embed_token` en posesión del equipo de integración
- [ ] Prueba de primer mensaje en canal embed y WhatsApp (verificar aviso legal)
- [ ] `RENEWAL_REMINDER_DAYS_AHEAD` alineado con política de renovaciones

### Rotación de secretos

- [ ] `SECRET_KEY` rotada → invalida sesiones activas (notificar usuarios)
- [ ] `FERNET_KEY` rotada → re-cifrar API keys almacenadas antes de reiniciar
- [ ] API keys de Meta/Twilio rotadas → actualizar en BD vía panel
