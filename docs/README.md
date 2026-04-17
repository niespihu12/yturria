# Yturria Platform Docs

Documentacion oficial del proyecto para desarrollo, producto y handoff.

Ultima actualizacion: Abril 2026.

## 1. Que es este producto hoy

Este repositorio implementa una consola operativa para gestionar:

- Agentes de voz (integrados con ElevenLabs ConvAI).
- Agentes de texto (OpenAI/Gemini).
- Herramientas webhook por agente.
- Base de conocimiento por usuario/agente.
- Integraciones WhatsApp (Meta y Twilio) para agentes de texto.
- Numeros telefonicos para agentes de voz.
- Autenticacion, perfil y MFA por usuario.

Hoy la mayor parte de la experiencia es B2B interna (operador/admin de cuenta).
La experiencia cliente final aun no es un producto web dedicado.

## 2. Stack real implementado

### Backend

- FastAPI + SQLModel + SQLAlchemy.
- MySQL (via DATABASE_URL).
- HTTPX para integraciones externas.
- JWT propio (HMAC SHA256).
- SMTP para correo de auth.

### Frontend

- React 19 + TypeScript + Vite.
- React Router + React Query.
- Tailwind CSS + Headless UI + Heroicons.
- Axios para consumo de API.

## 3. Estado actual del producto

### Hecho

- Flujo completo de auth (registro, confirmacion, login, MFA, reset password).
- CRUD de agentes de voz y detalle avanzado por tabs.
- CRUD de agentes de texto y detalle por tabs.
- Chat de prueba para agente de texto desde la consola.
- WhatsApp inbound para texto (Meta/Twilio) con respuesta automatica.
- Dashboard operativo con data real agregada de voz/texto/numeros.

### Pendiente para estabilidad tecnica

- El build de frontend falla por 5 errores TS en tabs de text-agent.
- CORS backend esta en modo abierto (allow_origins = ["*"]) y debe endurecerse.

### Pendiente para cliente final

- Experiencia web dedicada para usuario final (widget/chat publico).
- Modelo tenant/organizacion explicito (hoy predomina aislamiento por user_id).
- Onboarding autoservicio orientado negocio final.
- Facturacion y limites por plan.

## 4. Como usar estos documentos

- Ver arquitectura y estado tecnico en [ARCHITECTURE.md](ARCHITECTURE.md).
- Ver fases, prioridades y entregables en [ROADMAP.md](ROADMAP.md).

## 5. Arranque rapido local

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e .
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Frontend env minimo

```env
VITE_API_URL=http://localhost:8000/api
```

### Backend env minimo

```env
DATABASE_URL=mysql+mysqldb://user:password@host:3306/dbname
JWT_SECRET=change-me
FRONTEND_URL=http://localhost:5173

ELEVENLABS_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=

TEXT_AGENTS_SECRET_KEY=
TEXT_AGENTS_REQUIRE_USER_KEYS=false

MAIL_USER=
MAIL_PASSWORD=
MAIL_SERVER=
MAIL_PORT=465
MAIL_FROM_NAME=UpTask
MAIL_FROM_EMAIL=
```

## 6. Referencia rapida de modulos

- API Auth: [backend/app/routes/auth_router.py](../backend/app/routes/auth_router.py)
- API Voice: [backend/app/routes/agents_router.py](../backend/app/routes/agents_router.py)
- API Text: [backend/app/routes/text_agents_router.py](../backend/app/routes/text_agents_router.py)
- API Webhooks: [backend/app/routes/webhooks_router.py](../backend/app/routes/webhooks_router.py)
- Router frontend: [frontend/src/router.tsx](../frontend/src/router.tsx)

## 7. Siguiente foco de producto

Pasar de consola operativa a experiencia cliente final:

1. Estabilizar build y seguridad base.
2. Crear canal cliente final (widget/chat publico por tenant).
3. Completar multi-tenant real + onboarding.
4. Activar monetizacion y analitica de negocio.
