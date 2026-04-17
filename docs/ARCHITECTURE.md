# Arquitectura del Sistema

Producto: Yturria AI Platform  
Version: 1.0 (alineada al codigo actual)  
Fecha: Abril 2026

## 1. Objetivo

Documentar la arquitectura real implementada hoy y el camino tecnico para evolucionar de una consola operativa (admin/operator) hacia una experiencia de cliente final.

## 2. Principios de arquitectura

1. Alinear documentacion con codigo real, no con supuestos.
2. Evolucion incremental: estabilizar lo actual antes de abrir nuevos canales.
3. Aislamiento por cuenta de usuario como base actual; evolucion a tenant explicito.
4. Integraciones externas desacopladas por controladores y API wrappers.
5. Seguridad por defecto: secretos cifrados, JWT, MFA, hardening progresivo.

## 3. Contexto del sistema (estado actual)

### Actores

- Operador interno (admin/agente): configura agentes, herramientas, knowledge base y canales.
- Cliente final (externo): hoy interactua solo por WhatsApp o voz, no por un portal dedicado.

### Integraciones externas activas

- ElevenLabs ConvAI (agentes de voz, conversaciones, tools, KB, phone numbers).
- OpenAI / Gemini (LLM para agentes de texto).
- Twilio y Meta WhatsApp (entrada/salida de mensajes para texto).
- SMTP (emails de auth y MFA).

## 4. Vista de contenedores

```text
┌─────────────────────────────────────────────────────────────┐
│ Frontend SPA (React + Vite)                                │
│ - Auth, Dashboard, Voice Agents, Text Agents, Settings     │
│ - Consume REST /api via Axios                              │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTP JSON + Bearer JWT
┌───────────────▼─────────────────────────────────────────────┐
│ Backend API (FastAPI + SQLModel)                           │
│ - /auth                                                    │
│ - /agents (voz)                                            │
│ - /text-agents (texto)                                     │
│ - /webhooks (WhatsApp Meta/Twilio)                         │
└───────────────┬─────────────────────────────────────────────┘
                │ SQLAlchemy
┌───────────────▼─────────────────────────────────────────────┐
│ MySQL                                                      │
│ - users/tokens                                             │
│ - text_* tables (agents, messages, KB, tools, whatsapp)    │
│ - ownership tables para recursos de voz                    │
└─────────────────────────────────────────────────────────────┘

Backend tambien consume APIs externas:
- ElevenLabs REST
- OpenAI REST
- Gemini REST
- Twilio REST
- Meta Graph API
- SMTP server
```

## 5. Frontend (implementado)

### Shell y ruteo

- Rutas auth y privadas en [frontend/src/router.tsx](../frontend/src/router.tsx).
- Layout protegido en [frontend/src/layouts/AppLayout.tsx](../frontend/src/layouts/AppLayout.tsx).
- Sidebar de consola en [frontend/src/components/app/Sidebar.tsx](../frontend/src/components/app/Sidebar.tsx).

### Modulos principales

- Dashboard operacional con data real: [frontend/src/views/app/DashboardView.tsx](../frontend/src/views/app/DashboardView.tsx).
- Gestion de agentes de voz: [frontend/src/views/app/VoiceAgentsView.tsx](../frontend/src/views/app/VoiceAgentsView.tsx), [frontend/src/views/app/VoiceAgentDetailView.tsx](../frontend/src/views/app/VoiceAgentDetailView.tsx).
- Gestion de agentes de texto: [frontend/src/views/app/TextAgentsView.tsx](../frontend/src/views/app/TextAgentsView.tsx), [frontend/src/views/app/TextAgentDetailView.tsx](../frontend/src/views/app/TextAgentDetailView.tsx).
- Numeros telefonicos: [frontend/src/views/app/PhoneNumbersView.tsx](../frontend/src/views/app/PhoneNumbersView.tsx).
- Perfil y seguridad: [frontend/src/views/app/SettingsView.tsx](../frontend/src/views/app/SettingsView.tsx).

### Capa API frontend

- Auth API: [frontend/src/api/AuthAPI.ts](../frontend/src/api/AuthAPI.ts).
- Voice runtime API: [frontend/src/api/VoiceRuntimeAPI.ts](../frontend/src/api/VoiceRuntimeAPI.ts).
- Text agents API: [frontend/src/api/TextAgentsAPI.ts](../frontend/src/api/TextAgentsAPI.ts).
- Cliente Axios base: [frontend/src/lib/axios.ts](../frontend/src/lib/axios.ts).

## 6. Backend (implementado)

### Inicializacion y middleware

- App + migraciones de arranque: [backend/app/main.py](../backend/app/main.py).
- CORS middleware: [backend/app/middlewares/cors.py](../backend/app/middlewares/cors.py).
- Error handling middleware: [backend/app/middlewares/http_error_handler.py](../backend/app/middlewares/http_error_handler.py).

### Rutas y controladores

- Auth: [backend/app/routes/auth_router.py](../backend/app/routes/auth_router.py), [backend/app/controllers/AuthController.py](../backend/app/controllers/AuthController.py).
- Voz: [backend/app/routes/agents_router.py](../backend/app/routes/agents_router.py), [backend/app/controllers/AgentController.py](../backend/app/controllers/AgentController.py).
- Texto: [backend/app/routes/text_agents_router.py](../backend/app/routes/text_agents_router.py), [backend/app/controllers/TextAgentController.py](../backend/app/controllers/TextAgentController.py).
- Webhooks WhatsApp: [backend/app/routes/webhooks_router.py](../backend/app/routes/webhooks_router.py).

### Configuracion y utilidades

- DB engine: [backend/app/config/db.py](../backend/app/config/db.py).
- Email SMTP: [backend/app/config/email.py](../backend/app/config/email.py).
- JWT: [backend/app/utils/jwt.py](../backend/app/utils/jwt.py).
- Secrets encryption: [backend/app/utils/crypto.py](../backend/app/utils/crypto.py).
- MFA helpers: [backend/app/utils/mfa.py](../backend/app/utils/mfa.py).

## 7. Modelo de datos (estado actual)

### Identidad y seguridad

- users: cuenta, rol, confirmacion, MFA.
- tokens: tokens temporales para confirmacion/reset/MFA.

### Voz (ownership local + recursos en ElevenLabs)

- user_agents: mapea usuario a agent_id externo.
- user_tools: mapea usuario a tool_id externo.
- user_phone_numbers: mapea usuario a phone_number_id externo.

### Texto (persistencia local)

- text_agents: configuracion de agente (provider/model/system_prompt/welcome_message).
- text_provider_configs: API keys por usuario/proveedor.
- text_agent_tools: webhooks por agente.
- text_knowledge_base_documents: documentos base.
- text_knowledge_base_chunks: chunks para retrieval keyword-based.
- text_agent_knowledge_base: asociacion agente-documento y uso.
- text_agent_whatsapp_configs: config de canal WhatsApp (Meta/Twilio).
- text_conversations y text_messages: historial de chat.

## 8. Flujos clave

### 8.1 Flujo voz (consola)

1. Usuario autenticado lista/crea agente de voz.
2. Backend crea/consulta en ElevenLabs y guarda ownership local.
3. Preview de llamada usa signed URL de ElevenLabs.
4. Conversaciones, audio y analisis se leen desde ElevenLabs.

### 8.2 Flujo texto en consola

1. Usuario crea agente de texto y selecciona provider/model.
2. Usuario configura tools y knowledge base.
3. Preview envia mensajes a /text-agents/{id}/chat.
4. Backend arma prompt (system + KB + tools), llama OpenAI/Gemini y guarda conversacion.

### 8.3 Flujo WhatsApp texto

1. Proveedor envia webhook a /webhooks/whatsapp/{config_id}/meta o /twilio.
2. Backend valida config activa y normaliza mensaje.
3. handle_whatsapp_incoming genera respuesta con LLM.
4. Backend responde por Meta API o Twilio API.

## 9. Seguridad y cumplimiento (estado actual)

### Implementado

- JWT con expiracion.
- MFA por correo en login.
- API keys cifradas para proveedores de texto y WhatsApp.
- Verificacion de ownership por usuario para recursos criticos.

### Riesgo actual a corregir

- CORS esta abierto en [backend/app/middlewares/cors.py](../backend/app/middlewares/cors.py) con allow_origins = ["*"].

## 10. Calidad tecnica y estado de build

- Frontend build completo aun falla por errores TS en tabs de text-agent.
- Vite build del bundle funciona, pero tsc -b no esta en verde.
- Existe warning de deprecacion TS por baseUrl en tsconfig.app.json.

## 11. Brecha hacia producto de cliente final

### Lo que falta

1. Canal web cliente final (widget o chat publico) sin login de consola.
2. Tenant/organizacion explicito (hoy hay aislamiento por user_id).
3. Onboarding guiado para negocio final (no tecnico).
4. Facturacion y metrica de uso por plan.
5. SLA/observabilidad de producto y no solo consola.

### Objetivo de arquitectura destino

Agregar una capa "Customer Experience" encima de la plataforma actual:

```text
Customer Channels (web widget / whatsapp / voz)
           │
Conversation Orchestrator
           │
Current Core Platform (FastAPI + MySQL + Integrations)
           │
Ops Console (React actual)
```

La consola actual se conserva como backoffice y se complementa con experiencia final.

## 12. Decisiones de arquitectura vigentes

1. Mantener FastAPI y MySQL en corto plazo para no frenar avance.
2. Priorizar estabilizacion + experiencia cliente final antes de replatforming.
3. Evolucionar a tenant explicito sin romper compatibilidad de datos.
4. Mantener integraciones desacopladas por proveedor para swap futuro.
