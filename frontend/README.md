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
| `VITE_API_URL` | URL base de la API (incluye `/api`). En Docker basta `/api` | `http://localhost:8000/api` |
| `VITE_BRAND` | Marca de la interfaz. Vacío = marca propia; `bolivar` = tema de demostración Seguros Bolívar | `bolivar` |

Copiar `.env.example` a `.env.local` para desarrollo local.

## Marca y sistema de diseño

- **Tokens:** toda la UI usa tokens de `src/styles/design-tokens.css` (colores, radios, sombras,
  fuentes). No se usan colores hex en componentes. Contexto y convenciones: `../.impeccable.md`.
- **Temas de marca:** `src/styles/brand-bolivar.css` sobrescribe los tokens bajo
  `:root[data-brand='bolivar']` (verde `#006B38`, amarillo `#FFD050`, Marcellus + Albert Sans).
  Los datos de cada marca (nombre, logo, favicon, fuentes) están en `src/brands.json`; el plugin
  `brandHtml` de `vite.config.mjs` los escribe en `index.html` para evitar parpadeos.
- **Uso del logo de Seguros Bolívar:** solo en el tema de demostración. Su manual de marca para
  intermediarios exige autorización de su área de Marca para usarlo en piezas propias.
- **Componentes base:** `src/components/ui/` (`Button`, `Modal`, `useConfirm`, `AdvancedSection`,
  `PageHeader`, `Badge`). Los archivos que usan react-hook-form se excluyen del React Compiler
  (ver `vite.config.mjs`) porque memoizaría `formState`.

## Desarrollo

```bash
npm install
npm run dev         # Inicia en http://localhost:5173
VITE_BRAND=bolivar npm run dev   # Mismo servidor con el tema Seguros Bolívar
npm run build       # Build de producción en dist/
npm run preview     # Previsualización del build
npm run lint        # ESLint
npm run test:e2e    # Pruebas end-to-end (Playwright)
```

El backend debe estar corriendo en `VITE_API_URL` y con CORS habilitado para `localhost:5173`.

Para una demo con datos de ejemplo sin tocar la base real: `SEED_DEMO_DATA=1 node e2e/start-backend.mjs`
levanta el backend en `:8002` con SQLite desechable (usuario `cliente@e2e.test`, contraseña
`E2eClave123!`), y luego `VITE_API_URL=http://localhost:8002/api VITE_BRAND=bolivar npm run dev`.

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
