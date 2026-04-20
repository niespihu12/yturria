# Frontend — Yturria Seguros

Panel de administración y widget embed para la plataforma de agentes conversacionales de Yturria Seguros.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | React 19 + TypeScript |
| Build | Vite 6 + SWC |
| Routing | React Router v7 |
| Estado servidor | TanStack Query v5 |
| HTTP | Axios (instancia configurada) |
| UI | Tailwind CSS 4 + Heroicons |
| Notificaciones | React Toastify |
| Forms | React Hook Form |

## Estructura de directorios

```
src/
  api/              # Funciones de llamada HTTP (una por dominio)
  components/       # Componentes reutilizables y tabs por vista
    app/
      agent/        # Tabs del agente de voz
      dashboard/    # SecretaryDashboard (métricas, renovaciones)
      escalations/  # EscalationDetailModal
      text-agent/   # Tabs del agente de texto
  hooks/            # useCurrentUser
  layouts/          # AppLayout, AuthLayout
  lib/              # axios.ts (instancia global)
  types/            # Tipos compartidos (textAgent.ts, agent.ts, index.ts)
  views/
    app/            # Vistas protegidas del panel
    auth/           # Vistas de autenticación
    embed/          # Widget embed público
  router.tsx
  main.tsx
```

## Rutas

### Públicas

| Ruta | Componente | Descripción |
|---|---|---|
| `/embed/text-agent/:id?token=<tok>` | `TextAgentEmbedView` | Widget de chat embebido, sin autenticación |

### Autenticación (`/auth/*`)

| Ruta | Vista |
|---|---|
| `/auth/login` | `LoginView` |
| `/auth/register` | `RegisterView` |
| `/auth/confirm-account` | `ConfirmAccountView` |
| `/auth/request-code` | `RequestNewCodeView` |
| `/auth/forgot-password` | `ForgotPasswordView` |
| `/auth/new-password` | `NewPasswordView` |

### Panel (`AppLayout`, rutas protegidas)

| Ruta | Vista | Descripción |
|---|---|---|
| `/dashboard` | `DashboardView` | Métricas generales y renovaciones próximas |
| `/agentes_voz` | `VoiceAgentsView` | Listado de agentes de voz |
| `/agentes_voz/:id` | `VoiceAgentDetailView` | Detalle, tabs: Agente, Análisis, KB, Herramientas |
| `/agentes_texto` | `TextAgentsView` | Listado de agentes de texto |
| `/agentes_texto/:id` | `TextAgentDetailView` | Detalle, tabs: Config, WhatsApp, Sofia, KB, Herramientas, Integración, Análisis, Citas |
| `/escalamientos` | `EscalationsView` | Panel de escalamientos activos |
| `/citas` | `AppointmentsView` | Gestión de citas |
| `/numeros_telefono` | `PhoneNumbersView` | Números Twilio asociados |
| `/admin/usuarios` | `AdminUsersView` | Administración de usuarios (super_admin) |
| `/configuracion` | `SettingsView` | Configuración de proveedores LLM |

La ruta index (`/`) redirige a `/agentes_voz`.

## API Layer

Todas las llamadas pasan por `src/lib/axios.ts` que configura `baseURL` desde `VITE_BACKEND_URL` y adjunta el token JWT del `localStorage`.

### Archivos

| Archivo | Dominio |
|---|---|
| `AuthAPI.ts` | Login, registro, confirmación, reset de contraseña |
| `TextAgentsAPI.ts` | Agentes texto, conversaciones, escalamientos, KB, herramientas, WhatsApp, renovaciones, citas, embed |
| `VoiceRuntimeAPI.ts` | Agentes de voz, llamadas, análisis |

### Normalización de `sofia_config_json`

`TextAgentsAPI.ts` expone `normalizeSofiaConfigJson()` que acepta string JSON, objeto o vacío y siempre devuelve un string JSON válido. Se aplica antes de enviar al backend en create/update de agentes texto.

## Agente de Texto — Tabs

| Tab | Archivo | Descripción |
|---|---|---|
| Configuración | `TextAgentConfigTab.tsx` | Nombre, modelo, prompt, welcome message, aviso legal, temperatura, max tokens |
| WhatsApp | `TextAgentWhatsAppTab.tsx` | Proveedor (Meta/Twilio), credenciales, webhook URL |
| Sofia | `TextAgentSofiaTab.tsx` | Toggle sofia_mode, formulario SofiaConfig, panel de escalamientos recientes |
| Base de Conocimiento | `TextAgentKnowledgeBaseTab.tsx` | Documentos RAG (texto, URL, archivo) |
| Herramientas | `TextAgentToolsTab.tsx` | HTTP tools con schema de parámetros y mapeo de respuesta |
| Integración | `TextAgentIntegrationTab.tsx` | Embed token, snippet HTML, QR |
| Análisis | `TextAgentAnalysisTab.tsx` | Historial de conversaciones y transcripciones |
| Citas | `TextAgentAppointmentsTab.tsx` | Citas vinculadas al agente |

## Sofia Config UI (`TextAgentSofiaTab.tsx`)

Campos del formulario `SofiaConfig`:

| Campo | Tipo | Rango/Default |
|---|---|---|
| `advisor_phone` | text | — |
| `advisor_name` | text | — |
| `business_name` | text | `"Yturria Seguros"` |
| `business_hours` | text | `"Lun-Vie 9:00-18:00"` |
| `escalation_phrases` | textarea (una por línea) | 4 frases default |
| `max_response_lines` | number | — |
| `escalation_threshold` | slider | 1–20, default 4 |

El tab también muestra los escalamientos pendientes/en progreso del agente con `EscalationStatus` actualizable inline.

## Widget Embed (`TextAgentEmbedView`)

Ruta pública: `/embed/text-agent/:id?token=<embed_token>`

Flujo:
1. Lee `id` del path y `token` del query string.
2. Llama `getPublicTextAgentEmbedInfo(id, token)` — endpoint público, sin JWT.
3. Genera o recupera `session_id` desde `localStorage` (clave `text-agent-embed-session:<id>`).
4. Cada mensaje llama `chatWithPublicTextAgentEmbed(id, token, session_id, message)`.
5. Muestra historial, indicador de escritura y welcome message al cargar.

### Integración en sitio externo

```html
<iframe
  src="https://app.yturria.com/embed/text-agent/<AGENT_ID>?token=<EMBED_TOKEN>"
  width="400"
  height="600"
  style="border:none; border-radius:12px; box-shadow:0 4px 24px rgba(0,0,0,.15)"
  allow="clipboard-write"
></iframe>
```

El token se obtiene en la tab **Integración** del agente. Activar `embed_enabled` desde la misma tab.

## Panel de Escalamientos (`EscalationsView`)

- Lista conversaciones con `escalation_status` en `pending` o `in_progress`.
- Abre `EscalationDetailModal` con transcripción completa y controles de cambio de estado.
- Estados: `pending` → `in_progress` → `resolved`.
- Carga datos vía `getEscalations()` con polling TanStack Query (refetch automático).

## Dashboard (`DashboardView` / `SecretaryDashboard`)

- Métricas: conversaciones activas, escalamientos pendientes, citas del día, renovaciones próximas.
- Widget de renovaciones próximas: lista `UpcomingRenewal[]` con días restantes y estado.
- Acceso directo a detalle de conversación desde cada tarjeta.

## Configuración de Proveedores (`SettingsView`)

- Muestra `ProviderConfig[]` para OpenAI y Google Gemini.
- Indica si la clave viene de entorno (`source: 'env'`) o fue ingresada por el usuario (`source: 'user'`).
- Permite guardar/rotar clave por proveedor cuando `editable: true`.
- Si `requires_user_keys: true`, el panel muestra alerta de configuración requerida.

## Tipos principales

| Tipo | Archivo | Descripción |
|---|---|---|
| `TextAgentSummary` | `textAgent.ts` | Listado de agentes |
| `TextAgentDetail` | `textAgent.ts` | Detalle con tools y KB |
| `SofiaConfig` | `textAgent.ts` | Configuración del modo Sofia |
| `TextConversation` | `textAgent.ts` | Conversación con campos de escalamiento y renovación |
| `EscalatedConversation` | `textAgent.ts` | Conversación escalada (extends TextConversation) |
| `UpcomingRenewal` | `textAgent.ts` | Renovación próxima con días restantes |
| `TextAppointment` | `textAgent.ts` | Cita (fuente: manual/agent/embed/phone/voice) |
| `ProviderConfig` | `textAgent.ts` | Configuración de proveedor LLM |

## Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `VITE_BACKEND_URL` | URL base del backend | `https://api.yturria.com` |

Copiar `.env.example` a `.env.local` para desarrollo local.

## Desarrollo

```bash
npm install
npm run dev         # Inicia en http://localhost:5173
npm run build       # Build de producción en dist/
npm run preview     # Previsualización del build
npm run lint        # ESLint
```

El backend debe estar corriendo en `VITE_BACKEND_URL` y con CORS habilitado para `localhost:5173`.

## Build de producción

```bash
npm run build
# Servir dist/ con cualquier servidor estático (nginx, Vercel, Cloudflare Pages)
```

El `index.html` debe servirse para todas las rutas (`try_files $uri /index.html` en nginx) porque el routing es client-side.

### nginx — configuración mínima

```nginx
server {
    listen 80;
    root /var/www/yturria-frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Modelos de LLM disponibles

| Proveedor | Modelos |
|---|---|
| OpenAI | gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini |
| Google Gemini | gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.0-flash |

## Checklist pre-deploy

- [ ] `VITE_BACKEND_URL` apunta al backend de producción
- [ ] Backend con CORS configurado para el dominio del frontend
- [ ] `embed_enabled` activado en agentes que requieran widget embed
- [ ] `embed_token` rotado si se expuso en canales públicos no deseados
- [ ] Proveedor LLM configurado en Settings (clave de entorno o usuario)
- [ ] `nginx` con `try_files` para SPA routing
- [ ] HTTPS activo (requerido para `clipboard-write` del widget embed)
