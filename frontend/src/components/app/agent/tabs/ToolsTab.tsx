import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  BoltIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  LanguageIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PhoneXMarkIcon,
  PlusIcon,
  ServerIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  createTool,
  deleteTool,
  getAgents,
  getPhoneNumbers,
  getTools,
  getVoiceAgentRuntimeConfig,
} from '@/api/VoiceRuntimeAPI'
import { SYSTEM_TOOLS } from '@/types/agent'
import type { AgentDetail, AgentListItem, PhoneNumber, WorkspaceTool } from '@/types/agent'

type Props = {
  agent: AgentDetail
  enabledSystemTools: string[]
  systemToolParamsByName: Record<string, Record<string, unknown>>
  selectedToolIds: string[]
  onSystemToolToggle: (toolName: string, enabled: boolean) => void
  onSystemToolParamsChange: (
    toolName: string,
    params: Record<string, unknown>
  ) => void
  onWorkspaceToolToggle: (toolId: string, enabled: boolean) => void
  isClient?: boolean
}

type CreateToolPayload = Parameters<typeof createTool>[0]

type JsonLiteralType = 'boolean' | 'string' | 'integer' | 'number'
type ParamValueSource = 'llm_prompt' | 'constant' | 'dynamic_variable' | 'system_provided'
type PreToolSpeechMode = 'auto' | 'forced'
type ToolCallSoundMode = 'none' | 'default' | 'custom'

type HeaderRow = {
  id: string
  key: string
  value: string
}

type ToolParamRow = {
  id: string
  identifier: string
  type: JsonLiteralType
  required: boolean
  value_source: ParamValueSource
  description: string
  constant_value: string
  dynamic_variable: string
  enum_values: string
}

type CreateToolForm = {
  name: string
  description: string
  url: string
  method: (typeof HTTP_METHODS)[number]
  response_timeout_secs: string
  content_type: 'application/json' | 'application/x-www-form-urlencoded'
  execution_mode: 'immediate' | 'post_tool_speech' | 'async'
  tool_error_handling_mode: 'auto' | 'summarized' | 'passthrough' | 'hide'
  tool_call_sound_behavior: 'auto' | 'always'
  tool_call_sound_mode: ToolCallSoundMode
  tool_call_sound_custom: string
  disable_interruptions: boolean
  pre_tool_speech_mode: PreToolSpeechMode
  request_body_schema: string
  auth_connection: string
  dynamic_variable_placeholders: string
  assignments: string
  response_mocks: string
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const CONTENT_TYPES = ['application/json', 'application/x-www-form-urlencoded'] as const
const EXECUTION_MODES = ['immediate', 'post_tool_speech', 'async'] as const
const TOOL_ERROR_HANDLING_MODES = ['auto', 'summarized', 'passthrough', 'hide'] as const
const TOOL_CALL_SOUND_BEHAVIORS = ['auto', 'always'] as const
const JSON_LITERAL_TYPES: JsonLiteralType[] = ['string', 'number', 'integer', 'boolean']
const PARAM_VALUE_SOURCES: Array<{
  value: ParamValueSource
  label: string
  description: string
}> = [
  {
    value: 'llm_prompt',
    label: 'LLM Prompt',
    description: 'El LLM extrae el valor desde la conversacion.',
  },
  {
    value: 'constant',
    label: 'Valor fijo',
    description: 'Usa un valor constante definido manualmente.',
  },
  {
    value: 'dynamic_variable',
    label: 'Variable dinamica',
    description: 'Toma el valor desde una variable dinamica.',
  },
  {
    value: 'system_provided',
    label: 'Provisto por sistema',
    description: 'El runtime completa este valor automaticamente.',
  },
]

const inputClass =
  'w-full rounded-xl border border-[#e4e0f5] bg-white px-3.5 py-2.5 text-sm text-black placeholder:text-black/40 focus:border-[#271173] focus:outline-none transition-colors'

const SYSTEM_TOOL_TYPE_BY_NAME: Record<string, string> = {
  end_call: 'end_call',
  language_detection: 'language_detection',
  skip_turn: 'skip_turn',
  transfer_to_agent: 'transfer_to_agent',
  transfer_to_number: 'transfer_to_number',
  dtmf: 'play_keypad_touch_tone',
  voicemail_detection: 'voicemail_detection',
}

function resolvePublicWebhookBaseUrl(): string {
  const explicit = String(import.meta.env.VITE_PUBLIC_WEBHOOK_BASE_URL ?? '').trim()
  if (explicit) {
    return explicit.replace(/\/$/, '')
  }

  const apiUrl = String(import.meta.env.VITE_API_URL ?? '').trim()
  if (!apiUrl) {
    return ''
  }

  return apiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')
}

function buildSuggestedToolPayload(kind: 'send_whatsapp_message' | 'schedule_appointment'): CreateToolPayload {
  const baseUrl = resolvePublicWebhookBaseUrl()
  const runtimeToken = String(import.meta.env.VITE_VOICE_TOOL_TOKEN ?? '').trim()
  const requestHeaders = runtimeToken ? { 'X-Voice-Tool-Token': runtimeToken } : {}

  if (kind === 'send_whatsapp_message') {
    return {
      tool_config: {
        type: 'webhook',
        name: 'send_whatsapp_message',
        description: 'Escala la conversacion a humano por WhatsApp usando la configuracion global.',
        api_schema: {
          url: `${baseUrl}/api/webhooks/voice/tools/send-whatsapp-message`,
          method: 'POST',
          content_type: 'application/json',
          request_headers: requestHeaders,
          request_body_schema: {
            properties: {
              agent_id: {
                type: 'string',
                description: 'ID del agente de voz actual.',
              },
              phone_number: {
                type: 'string',
                description: 'Numero destino en formato E.164.',
              },
              message: {
                type: 'string',
                description: 'Mensaje opcional a enviar.',
              },
              summary: {
                type: 'string',
                description: 'Resumen de la conversacion para contexto.',
              },
              conversation_id: {
                type: 'string',
                description: 'ID de conversacion opcional.',
              },
            },
            required: ['agent_id', 'phone_number'],
          },
        },
        response_timeout_secs: 20,
      },
    }
  }

  return {
    tool_config: {
      type: 'webhook',
      name: 'schedule_appointment',
      description: 'Agenda una cita validando disponibilidad y enviando confirmacion por WhatsApp.',
      api_schema: {
        url: `${baseUrl}/api/webhooks/voice/tools/schedule-appointment`,
        method: 'POST',
        content_type: 'application/json',
        request_headers: requestHeaders,
        request_body_schema: {
          properties: {
            agent_id: {
              type: 'string',
              description: 'ID del agente de voz actual.',
            },
            preferred_date: {
              type: 'string',
              description: 'Fecha preferida en formato YYYY-MM-DD.',
            },
            preferred_time: {
              type: 'string',
              description: 'Hora preferida en formato HH:MM.',
            },
            timezone: {
              type: 'string',
              description: 'Zona horaria IANA, por ejemplo America/Bogota.',
            },
            contact_name: {
              type: 'string',
              description: 'Nombre del contacto.',
            },
            contact_phone: {
              type: 'string',
              description: 'Telefono en formato E.164.',
            },
            contact_email: {
              type: 'string',
              description: 'Email del contacto.',
            },
            notes: {
              type: 'string',
              description: 'Notas de la cita.',
            },
          },
          required: ['agent_id', 'preferred_date', 'preferred_time'],
        },
      },
      response_timeout_secs: 25,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createRowId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function extractPathParamNames(url: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()

  for (const match of url.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    const name = (match[1] ?? '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }

  return names
}

function createHeaderRow(): HeaderRow {
  return {
    id: createRowId('header'),
    key: '',
    value: '',
  }
}

function createToolParamRow(identifier = ''): ToolParamRow {
  return {
    id: createRowId('param'),
    identifier,
    type: 'string',
    required: false,
    value_source: 'llm_prompt',
    description: '',
    constant_value: '',
    dynamic_variable: '',
    enum_values: '',
  }
}

function parseEnumValues(raw: string): string[] {
  const values = raw
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean)

  return [...new Set(values)]
}

function normalizeSystemToolParams(
  toolName: string,
  rawParams?: Record<string, unknown>
): Record<string, unknown> {
  const base = isRecord(rawParams) ? { ...rawParams } : {}
  const systemToolType =
    (typeof base.system_tool_type === 'string' && base.system_tool_type) ||
    SYSTEM_TOOL_TYPE_BY_NAME[toolName] ||
    toolName

  const params: Record<string, unknown> = {
    ...base,
    system_tool_type: systemToolType,
  }

  if (systemToolType === 'transfer_to_agent' || systemToolType === 'transfer_to_number') {
    params.transfers = Array.isArray(params.transfers)
      ? params.transfers.filter(isRecord).map((item) => ({ ...item }))
      : []

    if (typeof params.enable_client_message !== 'boolean') {
      params.enable_client_message = true
    }
  }

  if (systemToolType === 'play_keypad_touch_tone') {
    if (typeof params.use_out_of_band_dtmf !== 'boolean') {
      params.use_out_of_band_dtmf = true
    }
    if (typeof params.suppress_turn_after_dtmf !== 'boolean') {
      params.suppress_turn_after_dtmf = false
    }
  }

  return params
}
function ToolToggle({
  active,
  onChange,
}: {
  active: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      className={`relative h-5 w-10 cursor-pointer rounded-full transition-colors duration-200 ${
        active ? 'bg-[#271173]' : 'bg-black/20'
      }`}
      aria-pressed={active}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          active ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function getSystemToolIcon(toolName: string) {
  if (toolName === 'end_call') return PhoneXMarkIcon
  if (toolName === 'language_detection') return LanguageIcon
  return BoltIcon
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-black/50">{message}</p>
    </div>
  )
}

function CreateToolModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<CreateToolForm>({
    name: '',
    description: '',
    url: '',
    method: 'POST',
    response_timeout_secs: '20',
    content_type: 'application/json',
    execution_mode: 'immediate',
    tool_error_handling_mode: 'auto',
    tool_call_sound_behavior: 'auto',
    tool_call_sound_mode: 'none',
    tool_call_sound_custom: '',
    disable_interruptions: false,
    pre_tool_speech_mode: 'auto',
    request_body_schema: '',
    auth_connection: '',
    dynamic_variable_placeholders: '{}',
    assignments: '[]',
    response_mocks: '[]',
  })
  const [headers, setHeaders] = useState<HeaderRow[]>([createHeaderRow()])
  const [pathParams, setPathParams] = useState<ToolParamRow[]>([])
  const [queryParams, setQueryParams] = useState<ToolParamRow[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Sync path params to URL changes (setState-during-render pattern)
  const [lastUrl, setLastUrl] = useState(form.url)
  if (form.url !== lastUrl) {
    setLastUrl(form.url)
    const names = extractPathParamNames(form.url)
    const prevNames = pathParams.map((row) => row.identifier)
    const sameNames =
      prevNames.length === names.length && prevNames.every((name, index) => name === names[index])
    if (!sameNames) {
      const map = new Map(pathParams.map((row) => [row.identifier, row]))
      setPathParams(names.map((name) => {
        const existing = map.get(name)
        if (existing) return existing
        return { ...createToolParamRow(name), required: true }
      }))
    }
  }

  const { mutate, isPending } = useMutation({
    mutationFn: (payload: CreateToolPayload) => createTool(payload),
    onSuccess: () => {
      toast.success('Herramienta creada')
      onCreated()
      onClose()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const set = <K extends keyof CreateToolForm>(key: K, value: CreateToolForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const updateHeaderRow = (rowId: string, patch: Partial<HeaderRow>) =>
    setHeaders((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)))

  const removeHeaderRow = (rowId: string) =>
    setHeaders((prev) => {
      const next = prev.filter((row) => row.id !== rowId)
      return next.length > 0 ? next : [createHeaderRow()]
    })

  const updatePathParamRow = (rowId: string, patch: Partial<ToolParamRow>) =>
    setPathParams((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)))

  const updateQueryParamRow = (rowId: string, patch: Partial<ToolParamRow>) =>
    setQueryParams((prev) => prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row)))

  const removeQueryParamRow = (rowId: string) =>
    setQueryParams((prev) => prev.filter((row) => row.id !== rowId))

  const buildPayload = (): CreateToolPayload | null => {
    const nextErrors: Record<string, string> = {}
    const addError = (key: string, message: string) => {
      if (!nextErrors[key]) nextErrors[key] = message
    }

    if (!form.name.trim()) addError('name', 'El nombre es requerido')
    if (!form.description.trim()) addError('description', 'La descripcion es requerida')
    if (!form.url.trim()) addError('url', 'La URL es requerida')

    if (form.url.trim()) {
      try {
        new URL(form.url.trim()) // throws if invalid, intentionally unassigned
      } catch {
        addError('url', 'La URL debe ser valida (ej: https://api.example.com/v1/recurso)')
      }
    }

    const timeout = Number(form.response_timeout_secs)
    if (!Number.isFinite(timeout) || timeout <= 0) {
      addError('response_timeout_secs', 'El timeout debe ser un numero mayor a 0')
    }

    const parseObjectField = (
      key: string,
      label: string,
      raw: string,
      options: { allowNull?: boolean; emptyAsNull?: boolean } = {}
    ): Record<string, unknown> | null | undefined => {
      const trimmed = raw.trim()

      if (!trimmed) {
        return options.emptyAsNull ? null : {}
      }

      if (trimmed.toLowerCase() === 'null' && options.allowNull) {
        return null
      }

      try {
        const parsed = JSON.parse(trimmed)

        if (parsed === null && options.allowNull) {
          return null
        }

        if (!isRecord(parsed)) {
          addError(key, `${label} debe ser un objeto JSON.`)
          return undefined
        }

        return parsed
      } catch {
        addError(key, `${label} no es JSON valido.`)
        return undefined
      }
    }

    const parseObjectArrayField = (
      key: string,
      label: string,
      raw: string
    ): Array<Record<string, unknown>> | undefined => {
      const trimmed = raw.trim()

      if (!trimmed) return []

      try {
        const parsed = JSON.parse(trimmed)
        if (!Array.isArray(parsed)) {
          addError(key, `${label} debe ser un arreglo JSON.`)
          return undefined
        }

        if (!parsed.every((item) => isRecord(item))) {
          addError(key, `${label} debe ser un arreglo de objetos JSON.`)
          return undefined
        }

        return parsed.map((item) => ({ ...(item as Record<string, unknown>) }))
      } catch {
        addError(key, `${label} no es JSON valido.`)
        return undefined
      }
    }

    const buildLiteralSchemaProperty = (
      row: ToolParamRow,
      errorPrefix: string
    ): Record<string, unknown> | null => {
      const literal: Record<string, unknown> = {
        type: row.type,
      }

      const enumValues = parseEnumValues(row.enum_values)
      if (enumValues.length > 0) {
        if (row.type !== 'string') {
          addError(`${errorPrefix}.enum_values`, 'Enum values solo aplica para tipo string.')
        } else {
          literal.enum = enumValues
        }
      }

      if (row.value_source === 'llm_prompt') {
        const description = row.description.trim()
        if (!description) {
          addError(
            `${errorPrefix}.description`,
            'La descripcion es requerida cuando el valor viene del LLM.'
          )
          return null
        }
        literal.description = description
        return literal
      }

      if (row.value_source === 'dynamic_variable') {
        const dynamicVariable = row.dynamic_variable.trim()
        if (!dynamicVariable) {
          addError(`${errorPrefix}.dynamic_variable`, 'El nombre de variable dinamica es requerido.')
          return null
        }
        literal.dynamic_variable = dynamicVariable
        return literal
      }

      if (row.value_source === 'system_provided') {
        literal.is_system_provided = true
        return literal
      }

      const rawConstant = row.constant_value.trim()
      if (!rawConstant) {
        addError(
          `${errorPrefix}.constant_value`,
          'El valor fijo es requerido cuando el tipo de valor es constante.'
        )
        return null
      }

      if (row.type === 'string') {
        literal.constant_value = rawConstant
        return literal
      }

      if (row.type === 'boolean') {
        const normalized = rawConstant.toLowerCase()
        if (normalized !== 'true' && normalized !== 'false') {
          addError(`${errorPrefix}.constant_value`, 'Para boolean usa true o false.')
          return null
        }
        literal.constant_value = normalized === 'true'
        return literal
      }

      const asNumber = Number(rawConstant)
      if (!Number.isFinite(asNumber)) {
        addError(`${errorPrefix}.constant_value`, 'El valor fijo debe ser numerico para este tipo.')
        return null
      }

      if (row.type === 'integer' && !Number.isInteger(asNumber)) {
        addError(`${errorPrefix}.constant_value`, 'El valor fijo debe ser entero para tipo integer.')
        return null
      }

      literal.constant_value = asNumber
      return literal
    }

    const requestHeaders: Record<string, unknown> = {}
    for (const row of headers) {
      const key = row.key.trim()
      const value = row.value.trim()

      if (!key && !value) continue

      if (!key) {
        addError(`headers.${row.id}.key`, 'El nombre del encabezado es requerido.')
        continue
      }

      if (Object.prototype.hasOwnProperty.call(requestHeaders, key)) {
        addError(`headers.${row.id}.key`, 'Ese encabezado esta repetido.')
        continue
      }

      requestHeaders[key] = value
    }

    const pathParamsSchema: Record<string, unknown> = {}
    for (const row of pathParams) {
      const identifier = row.identifier.trim()
      if (!identifier) {
        addError(`path.${row.id}.identifier`, 'El identificador del parametro de ruta es requerido.')
        continue
      }

      const literal = buildLiteralSchemaProperty(row, `path.${row.id}`)
      if (!literal) continue
      pathParamsSchema[identifier] = literal
    }

    const queryProperties: Record<string, unknown> = {}
    const queryRequired: string[] = []

    for (const row of queryParams) {
      const hasAnyValue =
        row.identifier.trim().length > 0 ||
        row.description.trim().length > 0 ||
        row.constant_value.trim().length > 0 ||
        row.dynamic_variable.trim().length > 0 ||
        row.enum_values.trim().length > 0

      if (!hasAnyValue) continue

      const identifier = row.identifier.trim()
      if (!identifier) {
        addError(`query.${row.id}.identifier`, 'El identificador del parametro es requerido.')
        continue
      }

      if (Object.prototype.hasOwnProperty.call(queryProperties, identifier)) {
        addError(`query.${row.id}.identifier`, 'Ese parametro ya existe.')
        continue
      }

      const literal = buildLiteralSchemaProperty(row, `query.${row.id}`)
      if (!literal) continue

      queryProperties[identifier] = literal
      if (row.required) {
        queryRequired.push(identifier)
      }
    }

    const queryParamsSchema =
      Object.keys(queryProperties).length > 0
        ? {
            properties: queryProperties,
            ...(queryRequired.length > 0 ? { required: queryRequired } : {}),
          }
        : null

    const requestBodySchema = parseObjectField(
      'request_body_schema',
      'Request body schema',
      form.request_body_schema,
      { allowNull: true, emptyAsNull: true }
    )
    const authConnection = parseObjectField(
      'auth_connection',
      'Auth connection',
      form.auth_connection,
      { allowNull: true, emptyAsNull: true }
    )
    const dynamicPlaceholders = parseObjectField(
      'dynamic_variable_placeholders',
      'Dynamic variable placeholders',
      form.dynamic_variable_placeholders
    )
    const assignments = parseObjectArrayField('assignments', 'Assignments', form.assignments)
    const responseMocks = parseObjectArrayField('response_mocks', 'Response mocks', form.response_mocks)

    let toolCallSound: string | null = null
    if (form.tool_call_sound_mode === 'default') {
      toolCallSound = 'default'
    } else if (form.tool_call_sound_mode === 'custom') {
      const customSound = form.tool_call_sound_custom.trim()
      if (!customSound) {
        addError('tool_call_sound_custom', 'Debes indicar el nombre del sonido personalizado.')
      } else {
        toolCallSound = customSound
      }
    }

    if (
      requestBodySchema === undefined ||
      authConnection === undefined ||
      dynamicPlaceholders === undefined ||
      assignments === undefined ||
      responseMocks === undefined
    ) {
      setErrors(nextErrors)
      return null
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return null
    }

    setErrors({})

    return {
      tool_config: {
        type: 'webhook',
        name: form.name.trim(),
        description: form.description.trim(),
        api_schema: {
          url: form.url.trim(),
          method: form.method,
          request_headers: requestHeaders,
          path_params_schema: pathParamsSchema,
          query_params_schema: queryParamsSchema,
          request_body_schema: requestBodySchema,
          content_type: form.content_type,
          auth_connection: authConnection,
        },
        response_timeout_secs: timeout,
        disable_interruptions: form.disable_interruptions,
        force_pre_tool_speech: form.pre_tool_speech_mode === 'forced',
        execution_mode: form.execution_mode,
        tool_call_sound: toolCallSound,
        tool_call_sound_behavior: form.tool_call_sound_behavior,
        tool_error_handling_mode: form.tool_error_handling_mode,
        dynamic_variables: {
          dynamic_variable_placeholders: dynamicPlaceholders ?? {},
        },
        assignments,
      },
      response_mocks: responseMocks,
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload = buildPayload()
    if (payload) mutate(payload)
  }

  const renderParamRow = (
    row: ToolParamRow,
    options: {
      section: 'path' | 'query'
      identifierReadOnly?: boolean
      showRequired?: boolean
      onChange: (rowId: string, patch: Partial<ToolParamRow>) => void
      onRemove?: (rowId: string) => void
    }
  ) => {
    const prefix = `${options.section}.${row.id}`

    return (
      <div key={row.id} className="space-y-3 rounded-xl border border-[#e4e0f5] bg-white p-3">
        <div className="grid gap-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-black/50">
              Tipo de datos
            </label>
            <select
              value={row.type}
              onChange={(event) =>
                options.onChange(row.id, { type: event.target.value as ToolParamRow['type'] })
              }
              className={inputClass}
            >
              {JSON_LITERAL_TYPES.map((dataType) => (
                <option key={dataType} value={dataType}>
                  {dataType}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-black/50">
              Identificador
            </label>
            <input
              type="text"
              value={row.identifier}
              readOnly={Boolean(options.identifierReadOnly)}
              onChange={(event) => options.onChange(row.id, { identifier: event.target.value })}
              placeholder="customer_id"
              className={`${inputClass} ${options.identifierReadOnly ? 'bg-[#f5f3ff]' : ''}`}
            />
            {errors[`${prefix}.identifier`] && (
              <p className="mt-1 text-xs text-red-500">{errors[`${prefix}.identifier`]}</p>
            )}
          </div>

          <div className="flex items-end gap-2">
            {options.showRequired ? (
              <label className="inline-flex flex-1 items-center gap-2 rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-2.5 text-xs text-black/70">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(event) =>
                    options.onChange(row.id, { required: event.target.checked })
                  }
                  className="h-3.5 w-3.5 rounded border-[#c7c3e0] text-[#271173] focus:ring-[#271173]"
                />
                Requerido
              </label>
            ) : (
              <div className="inline-flex flex-1 items-center rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-2.5 text-xs text-black/70">
                Requerido por URL
              </div>
            )}

            {options.onRemove && (
              <button
                type="button"
                onClick={() => options.onRemove?.(row.id)}
                className="rounded-xl border border-[#e4e0f5] p-2 text-black/50 transition-colors hover:bg-rose-50 hover:text-rose-600"
                title="Eliminar parametro"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-black/50">
            Tipo de valor
          </label>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {PARAM_VALUE_SOURCES.map((source) => {
              const isActive = row.value_source === source.value

              return (
                <button
                  key={source.value}
                  type="button"
                  onClick={() =>
                    options.onChange(row.id, {
                      value_source: source.value,
                    })
                  }
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-[#271173] bg-[#f5f3ff] shadow-[0_0_0_1px_rgba(39,17,115,0.08)]'
                      : 'border-[#e4e0f5] bg-white hover:bg-[#faf9ff]'
                  }`}
                >
                  <p className={`text-xs font-semibold ${isActive ? 'text-[#271173]' : 'text-black/80'}`}>
                    {source.label}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-black/55">{source.description}</p>
                </button>
              )
            })}
          </div>

          {row.type === 'string' && (
            <div className="pt-1">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-black/50">
                Enum values (opcional)
              </label>
              <input
                type="text"
                value={row.enum_values}
                onChange={(event) => options.onChange(row.id, { enum_values: event.target.value })}
                placeholder="vip, standard, basic"
                className={inputClass}
              />
              {errors[`${prefix}.enum_values`] && (
                <p className="mt-1 text-xs text-red-500">{errors[`${prefix}.enum_values`]}</p>
              )}
            </div>
          )}
        </div>

        {row.value_source === 'llm_prompt' && (
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-black/50">
              Descripcion
            </label>
            <textarea
              rows={3}
              value={row.description}
              onChange={(event) => options.onChange(row.id, { description: event.target.value })}
              className={`${inputClass} resize-y`}
              placeholder="Describe detalladamente como extraer este dato de la conversacion."
            />
            {errors[`${prefix}.description`] && (
              <p className="mt-1 text-xs text-red-500">{errors[`${prefix}.description`]}</p>
            )}
          </div>
        )}

        {row.value_source === 'constant' && (
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-black/50">
              Valor fijo
            </label>
            <input
              type="text"
              value={row.constant_value}
              onChange={(event) =>
                options.onChange(row.id, { constant_value: event.target.value })
              }
              className={inputClass}
              placeholder={row.type === 'boolean' ? 'true' : 'Valor'}
            />
            {errors[`${prefix}.constant_value`] && (
              <p className="mt-1 text-xs text-red-500">{errors[`${prefix}.constant_value`]}</p>
            )}
          </div>
        )}

        {row.value_source === 'dynamic_variable' && (
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-black/50">
              Variable dinamica
            </label>
            <input
              type="text"
              value={row.dynamic_variable}
              onChange={(event) =>
                options.onChange(row.id, { dynamic_variable: event.target.value })
              }
              className={inputClass}
              placeholder="customer_id"
            />
            {errors[`${prefix}.dynamic_variable`] && (
              <p className="mt-1 text-xs text-red-500">{errors[`${prefix}.dynamic_variable`]}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-sm">
      <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
        <div className="w-full max-w-6xl overflow-hidden rounded-2xl border border-[#e4e0f5] bg-[#fcfbff] shadow-2xl">
          <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col">
            <div className="flex items-start justify-between border-b border-[#e4e0f5] bg-white px-4 py-4 sm:px-6">
              <div>
                <h2 className="text-base font-semibold text-black">Anadir herramienta webhook</h2>
                <p className="mt-1 text-xs text-black/55">
                  Configura como y cuando el agente debe usar esta herramienta.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-black/50 transition-colors hover:bg-[#f5f3ff] hover:text-black"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
              <section className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-black">Configuracion</h3>
                  <p className="mt-1 text-xs text-black/55">
                    Describe al LLM como y cuando usar la herramienta.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">Tipo</label>
                    <div className="rounded-xl border border-[#271173]/20 bg-[#f5f3ff] px-3.5 py-2.5 text-sm font-medium text-[#271173]">
                      Webhook HTTP
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-black/65">Nombre</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(event) => set('name', event.target.value)}
                        placeholder="consultar_disponibilidad"
                        className={inputClass}
                      />
                      {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-black/65">Metodo</label>
                      <select
                        value={form.method}
                        onChange={(event) =>
                          set('method', event.target.value as CreateToolForm['method'])
                        }
                        className={inputClass}
                      >
                        {HTTP_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">Descripcion</label>
                    <textarea
                      rows={3}
                      value={form.description}
                      onChange={(event) => set('description', event.target.value)}
                      placeholder="Explica con claridad cuando debe ejecutar este webhook."
                      className={`${inputClass} resize-y`}
                    />
                    {errors.description && (
                      <p className="mt-1 text-xs text-red-500">{errors.description}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">URL</label>
                    <input
                      type="url"
                      value={form.url}
                      onChange={(event) => set('url', event.target.value)}
                      placeholder="https://api.example.com/v1/orders/{order_id}"
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] text-black/45">
                      Escribe {'{{'} para usar una variable de entorno.
                    </p>
                    {errors.url && <p className="mt-1 text-xs text-red-500">{errors.url}</p>}
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-black">Runtime</h3>
                  <p className="mt-1 text-xs text-black/55">
                    Define como se ejecuta la herramienta durante la conversacion.
                  </p>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">
                      Tiempo de espera de respuesta (segundos)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={form.response_timeout_secs}
                      onChange={(event) => set('response_timeout_secs', event.target.value)}
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] text-black/45">
                      El valor predeterminado recomendado es 20 segundos.
                    </p>
                    {errors.response_timeout_secs && (
                      <p className="mt-1 text-xs text-red-500">{errors.response_timeout_secs}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">
                      Pre-tool speech
                    </label>
                    <select
                      value={form.pre_tool_speech_mode}
                      onChange={(event) =>
                        set(
                          'pre_tool_speech_mode',
                          event.target.value as CreateToolForm['pre_tool_speech_mode']
                        )
                      }
                      className={inputClass}
                    >
                      <option value="auto">Auto</option>
                      <option value="forced">Forzado</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">
                      Modo de ejecucion
                    </label>
                    <select
                      value={form.execution_mode}
                      onChange={(event) =>
                        set('execution_mode', event.target.value as CreateToolForm['execution_mode'])
                      }
                      className={inputClass}
                    >
                      {EXECUTION_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">
                      Manejo de errores
                    </label>
                    <select
                      value={form.tool_error_handling_mode}
                      onChange={(event) =>
                        set(
                          'tool_error_handling_mode',
                          event.target.value as CreateToolForm['tool_error_handling_mode']
                        )
                      }
                      className={inputClass}
                    >
                      {TOOL_ERROR_HANDLING_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">
                      Sonido de llamada de la herramienta
                    </label>
                    <select
                      value={form.tool_call_sound_mode}
                      onChange={(event) =>
                        set(
                          'tool_call_sound_mode',
                          event.target.value as CreateToolForm['tool_call_sound_mode']
                        )
                      }
                      className={inputClass}
                    >
                      <option value="none">None</option>
                      <option value="default">Default</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">
                      Comportamiento del sonido
                    </label>
                    <select
                      value={form.tool_call_sound_behavior}
                      onChange={(event) =>
                        set(
                          'tool_call_sound_behavior',
                          event.target.value as CreateToolForm['tool_call_sound_behavior']
                        )
                      }
                      className={inputClass}
                    >
                      {TOOL_CALL_SOUND_BEHAVIORS.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">
                      Sonido personalizado
                    </label>
                    <input
                      type="text"
                      value={form.tool_call_sound_custom}
                      onChange={(event) => set('tool_call_sound_custom', event.target.value)}
                      disabled={form.tool_call_sound_mode !== 'custom'}
                      placeholder="custom_sound_name"
                      className={`${inputClass} ${
                        form.tool_call_sound_mode !== 'custom' ? 'bg-[#f5f3ff]' : ''
                      }`}
                    />
                    {errors.tool_call_sound_custom && (
                      <p className="mt-1 text-xs text-red-500">{errors.tool_call_sound_custom}</p>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-black/70">Disable interruptions</p>
                        <p className="text-[11px] text-black/50">
                          Deshabilita interrupciones mientras la herramienta se ejecuta.
                        </p>
                      </div>
                      <ToolToggle
                        active={form.disable_interruptions}
                        onChange={(value) => set('disable_interruptions', value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-black/65">
                      Content-Type
                    </label>
                    <select
                      value={form.content_type}
                      onChange={(event) =>
                        set('content_type', event.target.value as CreateToolForm['content_type'])
                      }
                      className={inputClass}
                    >
                      {CONTENT_TYPES.map((contentType) => (
                        <option key={contentType} value={contentType}>
                          {contentType}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-black">Encabezados</h3>
                    <p className="mt-1 text-xs text-black/55">
                      Define los encabezados que se enviaran con la solicitud.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHeaders((prev) => [...prev, createHeaderRow()])}
                    className="rounded-lg border border-[#271173]/25 px-3 py-1.5 text-xs font-medium text-[#271173] transition-colors hover:bg-[#f5f3ff]"
                  >
                    Anadir encabezado
                  </button>
                </div>

                <div className="space-y-2">
                  {headers.map((header) => (
                    <div key={header.id} className="grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
                      <div>
                        <input
                          type="text"
                          value={header.key}
                          onChange={(event) => updateHeaderRow(header.id, { key: event.target.value })}
                          placeholder="Authorization"
                          className={inputClass}
                        />
                        {errors[`headers.${header.id}.key`] && (
                          <p className="mt-1 text-xs text-red-500">{errors[`headers.${header.id}.key`]}</p>
                        )}
                      </div>
                      <input
                        type="text"
                        value={header.value}
                        onChange={(event) => updateHeaderRow(header.id, { value: event.target.value })}
                        placeholder="Bearer {{api_key}}"
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => removeHeaderRow(header.id)}
                        className="rounded-xl border border-[#e4e0f5] p-2 text-black/50 transition-colors hover:bg-rose-50 hover:text-rose-600"
                        title="Eliminar encabezado"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-black">Parametros de ruta</h3>
                  <p className="mt-1 text-xs text-black/55">
                    Anade la ruta entre llaves en la URL para configurarlos aqui.
                  </p>
                </div>

                {pathParams.length > 0 ? (
                  <div className="space-y-2">
                    {pathParams.map((row) =>
                      renderParamRow(row, {
                        section: 'path',
                        identifierReadOnly: true,
                        showRequired: false,
                        onChange: updatePathParamRow,
                      })
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#d8d3ee] bg-[#faf9ff] px-3.5 py-3 text-xs text-black/55">
                    No se detectaron parametros de ruta. Usa llaves en la URL, por ejemplo {'{order_id}'}.
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-black">Parametros de consulta</h3>
                    <p className="mt-1 text-xs text-black/55">
                      Define los parametros que seran recopilados por el LLM y enviados como query.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQueryParams((prev) => [...prev, createToolParamRow()])}
                    className="rounded-lg border border-[#271173]/25 px-3 py-1.5 text-xs font-medium text-[#271173] transition-colors hover:bg-[#f5f3ff]"
                  >
                    Anadir parametro
                  </button>
                </div>

                {queryParams.length > 0 ? (
                  <div className="space-y-2">
                    {queryParams.map((row) =>
                      renderParamRow(row, {
                        section: 'query',
                        showRequired: true,
                        onChange: updateQueryParamRow,
                        onRemove: removeQueryParamRow,
                      })
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#d8d3ee] bg-[#faf9ff] px-3.5 py-3 text-xs text-black/55">
                    No hay parametros de consulta definidos.
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-black">Autenticacion</h3>
                  <p className="mt-1 text-xs text-black/55">
                    El workspace no tiene conexiones de autenticacion listadas desde este panel.
                    Si tienes una conexion, puedes referenciarla en JSON.
                  </p>
                </div>
                <textarea
                  rows={2}
                  value={form.auth_connection}
                  onChange={(event) => set('auth_connection', event.target.value)}
                  className={`${inputClass} resize-y font-mono text-xs`}
                  placeholder='{"type":"auth_connection_id","auth_connection_id":"auth_xxx"}'
                />
                {errors.auth_connection && (
                  <p className="mt-1 text-xs text-red-500">{errors.auth_connection}</p>
                )}
              </section>

              <section className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-black">Request body schema</h3>
                  <p className="mt-1 text-xs text-black/55">
                    Para POST/PUT/PATCH define el cuerpo en formato JSON schema. Dejalo vacio para null.
                  </p>
                </div>
                <textarea
                  rows={4}
                  value={form.request_body_schema}
                  onChange={(event) => set('request_body_schema', event.target.value)}
                  className={`${inputClass} resize-y font-mono text-xs`}
                  placeholder='{"type":"object","properties":{"customer_id":{"type":"string"}},"required":["customer_id"]}'
                />
                {errors.request_body_schema && (
                  <p className="mt-1 text-xs text-red-500">{errors.request_body_schema}</p>
                )}
              </section>

              <section className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-black">Variables dinamicas</h3>
                  <p className="mt-1 text-xs text-black/55">
                    Placeholders reemplazados al iniciar la conversacion.
                  </p>
                  <textarea
                    rows={5}
                    value={form.dynamic_variable_placeholders}
                    onChange={(event) =>
                      set('dynamic_variable_placeholders', event.target.value)
                    }
                    className={`${inputClass} mt-3 resize-y font-mono text-xs`}
                    placeholder='{"customer_id":{"type":"string"}}'
                  />
                  {errors.dynamic_variable_placeholders && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.dynamic_variable_placeholders}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-black">Asignaciones de variables</h3>
                  <p className="mt-1 text-xs text-black/55">
                    Configura que variables se actualizan desde la respuesta del webhook.
                  </p>
                  <textarea
                    rows={5}
                    value={form.assignments}
                    onChange={(event) => set('assignments', event.target.value)}
                    className={`${inputClass} mt-3 resize-y font-mono text-xs`}
                    placeholder='[{"type":"dynamic_variable","output_key":"result.id","dynamic_variable":"order_id"}]'
                  />
                  {errors.assignments && (
                    <p className="mt-1 text-xs text-red-500">{errors.assignments}</p>
                  )}
                </div>

                <div className="rounded-xl border border-[#e4e0f5] bg-white p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-black">Simulaciones de respuesta</h3>
                  <p className="mt-1 text-xs text-black/55">
                    Respuestas mock para pruebas sin usar sistemas de produccion.
                  </p>
                  <textarea
                    rows={5}
                    value={form.response_mocks}
                    onChange={(event) => set('response_mocks', event.target.value)}
                    className={`${inputClass} mt-3 resize-y font-mono text-xs`}
                    placeholder='[{"name":"default","response":{"status":"ok"}}]'
                  />
                  {errors.response_mocks && (
                    <p className="mt-1 text-xs text-red-500">{errors.response_mocks}</p>
                  )}
                </div>
              </section>
            </div>

            <div className="flex gap-3 border-t border-[#e4e0f5] bg-white px-4 py-4 sm:px-6">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl bg-[#f5f3ff] px-4 py-2.5 text-sm font-medium text-black/80 transition-colors hover:bg-[#ede9ff]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
              >
                {isPending && (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {isPending ? 'Creando...' : 'Crear herramienta'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default function ToolsTab({
  agent,
  enabledSystemTools,
  systemToolParamsByName,
  selectedToolIds,
  onSystemToolToggle,
  onSystemToolParamsChange,
  onWorkspaceToolToggle,
  isClient = false,
}: Props) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<string | null>(null)
  const [togglingWorkspaceId, setTogglingWorkspaceId] = useState<string | null>(null)
  const [expandedEmbeddedId, setExpandedEmbeddedId] = useState<string | null>(null)
  const [deletingToolId, setDeletingToolId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['workspace-tools'],
    queryFn: getTools,
  })

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: getAgents,
  })

  const { data: phoneNumbersData } = useQuery({
    queryKey: ['phone-numbers'],
    queryFn: getPhoneNumbers,
  })

  const { data: runtimeConfigData } = useQuery({
    queryKey: ['voice-runtime-config', agent.agent_id],
    queryFn: () => getVoiceAgentRuntimeConfig(agent.agent_id),
    enabled: isClient && Boolean(agent.agent_id),
  })
  const escalationPhone = runtimeConfigData?.config?.escalation_phone_number ?? ''

  const { mutate: removeTool } = useMutation({
    mutationFn: (toolId: string) => deleteTool(toolId),
    onSuccess: () => {
      toast.success('Herramienta eliminada')
      queryClient.invalidateQueries({ queryKey: ['workspace-tools'] })
      setDeletingToolId(null)
    },
    onError: (error: Error) => {
      toast.error(error.message)
      setDeletingToolId(null)
    },
  })

  const { mutate: createSuggestedTool, isPending: isCreatingSuggestedTool } = useMutation({
    mutationFn: (kind: 'send_whatsapp_message' | 'schedule_appointment') =>
      createTool(buildSuggestedToolPayload(kind)),
    onSuccess: (tool) => {
      onWorkspaceToolToggle(tool.id, true)
      toast.success(`Herramienta ${tool.tool_config.name} creada y activada`)
      queryClient.invalidateQueries({ queryKey: ['workspace-tools'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const handleDeleteTool = (toolId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('¿Eliminar esta herramienta del workspace?')) return
    setDeletingToolId(toolId)
    removeTool(toolId)
  }

  const handleCreateSuggestedTool = (kind: 'send_whatsapp_message' | 'schedule_appointment') => {
    const toolName = kind

    const existing = workspaceTools.some(
      (tool) => (tool.tool_config.name || '').trim().toLowerCase() === toolName
    )
    if (existing) {
      toast.info(`La herramienta ${toolName} ya existe en el workspace`)
      return
    }

    const baseUrl = resolvePublicWebhookBaseUrl()
    if (!baseUrl) {
      toast.error('Configura VITE_PUBLIC_WEBHOOK_BASE_URL o VITE_API_URL para crear herramientas sugeridas')
      return
    }

    createSuggestedTool(kind)
  }

  const workspaceTools: WorkspaceTool[] = data?.tools ?? []
  const ownedWebhookTools = useMemo(
    () =>
      (data?.tools ?? []).filter((tool) => {
        const toolType = (tool.tool_config.type ?? '').toLowerCase()
        return toolType === 'webhook'
      }),
    [data]
  )

  const attachedOwnedWebhookCount = useMemo(
    () => ownedWebhookTools.filter((tool) => selectedToolIds.includes(tool.id)).length,
    [ownedWebhookTools, selectedToolIds]
  )

  const embeddedTools = useMemo(
    () =>
      (agent.conversation_config.agent.prompt.tools ?? []).filter(
        (tool: { type?: string }) => tool.type !== 'system'
      ),
    [agent]
  )

  const filteredWorkspaceTools = ownedWebhookTools.filter((tool) => {
    if (!search) return true
    const query = search.toLowerCase()
    return (
      tool.tool_config.name.toLowerCase().includes(query) ||
      (tool.tool_config.description ?? '').toLowerCase().includes(query) ||
      (tool.tool_config.type ?? '').toLowerCase().includes(query)
    )
  })

  const CLIENT_ALLOWED_SYSTEM_TOOLS = ['end_call', 'transfer_to_number', 'voicemail_detection']
  const filteredSystemTools = SYSTEM_TOOLS.filter((tool) => {
    if (isClient && !CLIENT_ALLOWED_SYSTEM_TOOLS.includes(tool.name)) return false
    if (!search) return true
    const query = search.toLowerCase()
    return (
      tool.name.toLowerCase().includes(query) ||
      tool.label.toLowerCase().includes(query) ||
      tool.description.toLowerCase().includes(query)
    )
  })

  const transferAgentOptions: AgentListItem[] = (agentsData?.agents ?? []).filter(
    (item: AgentListItem) => item.agent_id !== agent.agent_id
  )
  const transferNumberOptions: PhoneNumber[] = phoneNumbersData ?? []

  const getSystemToolParams = (toolName: string) =>
    normalizeSystemToolParams(toolName, systemToolParamsByName[toolName])

  const updateSystemToolParams = (
    toolName: string,
    updater: (params: Record<string, unknown>) => Record<string, unknown>
  ) => {
    const current = getSystemToolParams(toolName)
    onSystemToolParamsChange(toolName, updater({ ...current }))
  }

  const getTransferRows = (toolName: string, fallbackRow: Record<string, unknown>) => {
    const params = getSystemToolParams(toolName)
    const rows = Array.isArray(params.transfers)
      ? params.transfers.filter(isRecord).map((item) => ({ ...item }))
      : []

    if (rows.length > 0) return rows

    // For clients with transfer_to_number, pre-seed from escalation config
    if (isClient && toolName === 'transfer_to_number' && escalationPhone) {
      return [{
        phone_number: escalationPhone,
        condition: 'cuando el usuario solicite hablar con un asesor humano o quiera ser transferido',
      }]
    }

    return [fallbackRow]
  }

  const setTransferRows = (
    toolName: string,
    rows: Array<Record<string, unknown>>
  ) => {
    updateSystemToolParams(toolName, (params) => ({
      ...params,
      transfers: rows,
    }))
  }

  const handleWorkspaceToggle = (toolId: string, enabled: boolean) => {
    setTogglingWorkspaceId(toolId)
    onWorkspaceToolToggle(toolId, enabled)

    setTimeout(() => {
      setTogglingWorkspaceId((current) => (current === toolId ? null : current))
    }, 700)
  }

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="rounded-xl border border-[#e4e0f5] bg-white p-4">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar herramientas por nombre, tipo o descripcion..."
            className="w-full rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] py-2.5 pl-9 pr-3 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded-xl border border-[#e4e0f5] bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium text-black">Herramientas sugeridas de Voice</p>
            <p className="mt-1 text-xs text-black/55">
              Crea rapidamente send_whatsapp_message y schedule_appointment para invocarlas desde el agente.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleCreateSuggestedTool('send_whatsapp_message')}
              disabled={isCreatingSuggestedTool || isClient}
              className="rounded-xl border border-[#271173]/25 bg-[#f5f3ff] px-3 py-2 text-xs font-semibold text-[#271173] transition-colors hover:bg-[#ede9ff] disabled:opacity-50"
            >
              Crear send_whatsapp_message
            </button>
            <button
              type="button"
              onClick={() => handleCreateSuggestedTool('schedule_appointment')}
              disabled={isCreatingSuggestedTool || isClient}
              className="rounded-xl border border-[#271173]/25 bg-[#f5f3ff] px-3 py-2 text-xs font-semibold text-[#271173] transition-colors hover:bg-[#ede9ff] disabled:opacity-50"
            >
              Crear schedule_appointment
            </button>
          </div>
        </div>
      </div>

      {/* System tools */}
      <div className="overflow-hidden rounded-xl border border-[#e4e0f5] bg-white">
        <div className="flex items-center justify-between border-b border-[#e4e0f5] bg-linear-to-r from-[#f5f3ff] to-white px-5 py-4">
          <div className="flex items-center gap-2.5">
            <CpuChipIcon className="h-4 w-4 text-[#271173]" />
            <div>
              <p className="text-sm font-medium text-black">Herramientas del sistema</p>
              <p className="text-xs text-black/50">Acciones nativas del runtime de la plataforma.</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#e4e0f5] bg-white px-2 py-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#271173] text-xs font-bold text-white">
              {enabledSystemTools.length}
            </span>
            <span className="text-xs font-medium text-black/60">activas</span>
          </div>
        </div>

        <div className="divide-y divide-[#e4e0f5]">
          {filteredSystemTools.length > 0 ? (
            filteredSystemTools.map((tool) => {
              const isEnabled = enabledSystemTools.includes(tool.name)
              const SystemIcon = getSystemToolIcon(tool.name)
              const params = getSystemToolParams(tool.name)
              const systemToolType =
                typeof params.system_tool_type === 'string'
                  ? params.system_tool_type
                  : SYSTEM_TOOL_TYPE_BY_NAME[tool.name] ?? tool.name
              const needsConfig = [
                'transfer_to_agent',
                'transfer_to_number',
                'play_keypad_touch_tone',
                'voicemail_detection',
              ].includes(systemToolType)

              const agentTransfers = getTransferRows(tool.name, {
                agent_id: '',
                condition: '',
              })
              const numberTransfers = getTransferRows(tool.name, {
                phone_number: '',
                condition: '',
              })

              return (
                <div
                  key={tool.name}
                  className="px-5 py-3.5 transition-colors hover:bg-[#f5f3ff]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <div className="mt-0.5 rounded-lg border border-[#e4e0f5] bg-white p-1.5">
                        <SystemIcon className="h-4 w-4 text-[#271173]" />
                      </div>
                      <div>
                        <p className="text-sm text-black">{tool.label}</p>
                        <p className="text-xs text-black/50">{tool.description}</p>
                        {isEnabled && needsConfig && (
                          <p className="mt-1 text-[11px] text-[#271173]">
                            Requiere configuracion adicional para guardar correctamente.
                          </p>
                        )}
                      </div>
                    </div>

                    <ToolToggle
                      active={isEnabled}
                      onChange={(value) => onSystemToolToggle(tool.name, value)}
                    />
                  </div>

                  {isEnabled && needsConfig && (
                    <div className="mt-3 space-y-3 rounded-xl border border-[#e4e0f5] bg-white p-3">
                      {systemToolType === 'transfer_to_agent' && (
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-medium text-black/70">
                              Destinos de transferencia a agente
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                setTransferRows(tool.name, [
                                  ...agentTransfers,
                                  { agent_id: '', condition: '' },
                                ])
                              }
                              className="rounded-lg border border-[#271173]/25 px-2.5 py-1 text-[11px] font-medium text-[#271173] hover:bg-[#f5f3ff]"
                            >
                              + Agregar
                            </button>
                          </div>

                          {agentTransfers.map((transfer, index) => (
                            <div key={`${tool.name}-agent-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                              <div>
                                <input
                                  type="text"
                                  list="agent-transfer-options"
                                  value={typeof transfer.agent_id === 'string' ? transfer.agent_id : ''}
                                  onChange={(event) =>
                                    setTransferRows(
                                      tool.name,
                                      agentTransfers.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, agent_id: event.target.value }
                                          : item
                                      )
                                    )
                                  }
                                  className={inputClass}
                                  placeholder="agent_..."
                                />
                              </div>
                              <div>
                                <input
                                  type="text"
                                  value={typeof transfer.condition === 'string' ? transfer.condition : ''}
                                  onChange={(event) =>
                                    setTransferRows(
                                      tool.name,
                                      agentTransfers.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, condition: event.target.value }
                                          : item
                                      )
                                    )
                                  }
                                  className={inputClass}
                                  placeholder="Condicion opcional"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setTransferRows(
                                    tool.name,
                                    agentTransfers.length === 1
                                      ? [{ agent_id: '', condition: '' }]
                                      : agentTransfers.filter((_, itemIndex) => itemIndex !== index)
                                  )
                                }
                                className="rounded-lg border border-[#e4e0f5] px-2 text-xs text-black/60 hover:bg-rose-50 hover:text-rose-600"
                              >
                                Quitar
                              </button>
                            </div>
                          ))}

                          <datalist id="agent-transfer-options">
                            {transferAgentOptions.map((option) => (
                              <option key={option.agent_id} value={option.agent_id}>
                                {option.name}
                              </option>
                            ))}
                          </datalist>

                          <div className="flex items-center justify-between rounded-lg border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-2">
                            <p className="text-[11px] text-black/60">Mensaje al cliente durante transferencia</p>
                            <ToolToggle
                              active={Boolean(params.enable_client_message)}
                              onChange={(value) =>
                                updateSystemToolParams(tool.name, (current) => ({
                                  ...current,
                                  enable_client_message: value,
                                }))
                              }
                            />
                          </div>
                        </div>
                      )}

                      {systemToolType === 'transfer_to_number' && (
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-medium text-black/70">
                              Destinos de transferencia (E.164)
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                setTransferRows(tool.name, [
                                  ...numberTransfers,
                                  { phone_number: '', condition: '' },
                                ])
                              }
                              className="rounded-lg border border-[#271173]/25 px-2.5 py-1 text-[11px] font-medium text-[#271173] hover:bg-[#f5f3ff]"
                            >
                              + Agregar
                            </button>
                          </div>

                          {numberTransfers.map((transfer, index) => (
                            <div key={`${tool.name}-number-${index}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                              <div>
                                <input
                                  type="text"
                                  list="number-transfer-options"
                                  value={
                                    typeof transfer.phone_number === 'string'
                                      ? transfer.phone_number
                                      : ''
                                  }
                                  onChange={(event) =>
                                    setTransferRows(
                                      tool.name,
                                      numberTransfers.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, phone_number: event.target.value }
                                          : item
                                      )
                                    )
                                  }
                                  className={inputClass}
                                  placeholder="+573001234567"
                                />
                              </div>
                              <div>
                                <input
                                  type="text"
                                  value={typeof transfer.condition === 'string' ? transfer.condition : ''}
                                  onChange={(event) =>
                                    setTransferRows(
                                      tool.name,
                                      numberTransfers.map((item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, condition: event.target.value }
                                          : item
                                      )
                                    )
                                  }
                                  className={inputClass}
                                  placeholder="Condicion opcional"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setTransferRows(
                                    tool.name,
                                    numberTransfers.length === 1
                                      ? [{ phone_number: '', condition: '' }]
                                      : numberTransfers.filter((_, itemIndex) => itemIndex !== index)
                                  )
                                }
                                className="rounded-lg border border-[#e4e0f5] px-2 text-xs text-black/60 hover:bg-rose-50 hover:text-rose-600"
                              >
                                Quitar
                              </button>
                            </div>
                          ))}

                          <datalist id="number-transfer-options">
                            {transferNumberOptions.map((option) => (
                              <option key={option.phone_number_id} value={option.phone_number}>
                                {option.label}
                              </option>
                            ))}
                          </datalist>

                          <div className="flex items-center justify-between rounded-lg border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-2">
                            <p className="text-[11px] text-black/60">Mensaje al cliente durante transferencia</p>
                            <ToolToggle
                              active={Boolean(params.enable_client_message)}
                              onChange={(value) =>
                                updateSystemToolParams(tool.name, (current) => ({
                                  ...current,
                                  enable_client_message: value,
                                }))
                              }
                            />
                          </div>
                        </div>
                      )}

                      {systemToolType === 'play_keypad_touch_tone' && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between rounded-lg border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-2">
                            <p className="text-[11px] text-black/60">Enviar DTMF out-of-band (RFC4733)</p>
                            <ToolToggle
                              active={Boolean(params.use_out_of_band_dtmf)}
                              onChange={(value) =>
                                updateSystemToolParams(tool.name, (current) => ({
                                  ...current,
                                  use_out_of_band_dtmf: value,
                                }))
                              }
                            />
                          </div>
                          <div className="flex items-center justify-between rounded-lg border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-2">
                            <p className="text-[11px] text-black/60">Suprimir turno de voz despues del DTMF</p>
                            <ToolToggle
                              active={Boolean(params.suppress_turn_after_dtmf)}
                              onChange={(value) =>
                                updateSystemToolParams(tool.name, (current) => ({
                                  ...current,
                                  suppress_turn_after_dtmf: value,
                                }))
                              }
                            />
                          </div>
                        </div>
                      )}

                      {systemToolType === 'voicemail_detection' && (
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-black/70">
                            Mensaje opcional para dejar en buzon de voz
                          </label>
                          <textarea
                            rows={3}
                            value={typeof params.voicemail_message === 'string' ? params.voicemail_message : ''}
                            onChange={(event) =>
                              updateSystemToolParams(tool.name, (current) => ({
                                ...current,
                                voicemail_message: event.target.value,
                              }))
                            }
                            className={`${inputClass} resize-none`}
                            placeholder="Hola, intentamos comunicarnos contigo. Puedes devolver la llamada cuando te sea posible."
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <EmptyState message="No hay herramientas del sistema que coincidan con la busqueda." />
          )}
        </div>
      </div>

      {/* Workspace tools */}
      {!isClient && (
      <div className="overflow-hidden rounded-xl border border-[#e4e0f5] bg-white">
        <div className="flex items-center justify-between border-b border-[#e4e0f5] bg-linear-to-r from-[#f5f3ff] to-white px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ServerIcon className="h-4 w-4 text-[#271173]" />
            <div>
              <p className="text-sm font-medium text-black">Webhooks del workspace</p>
              <p className="text-xs text-black/50">
                Solo se listan herramientas webhook HTTP creadas por ti. Se adjuntan via{' '}
                <span className="rounded bg-[#f0edff] px-1.5 py-0.5 font-mono text-[11px] text-black/70">
                  tool_ids
                </span>{' '}
                y quedan persistentes al guardar.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#e4e0f5] bg-white px-2 py-1">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#271173] text-xs font-bold text-white">
                {attachedOwnedWebhookCount}
              </span>
              <span className="text-xs font-medium text-black/60">adjuntas</span>
            </div>
            {!isClient && (
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#271173]/20 bg-[#f5f3ff] px-3 py-1.5 text-xs font-medium text-[#271173] transition-colors hover:bg-[#ede9ff]"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Nueva
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2 px-3 py-3">
          {isLoading ? (
            <div className="flex h-28 items-center justify-center gap-2.5 text-sm text-black/60">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
              Cargando herramientas...
            </div>
          ) : filteredWorkspaceTools.length > 0 ? (
            filteredWorkspaceTools.map((tool) => {
              const isAttached = selectedToolIds.includes(tool.id)
              const isExpanded = expandedWorkspaceId === tool.id
              const hasApiSchema = !!tool.tool_config.api_schema
              const apiSchemaText = hasApiSchema
                ? JSON.stringify(tool.tool_config.api_schema, null, 2)
                : ''

              return (
                <div
                  key={tool.id}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setExpandedWorkspaceId((current) =>
                      current === tool.id ? null : tool.id
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setExpandedWorkspaceId((current) =>
                        current === tool.id ? null : tool.id
                      )
                    }
                  }}
                  className="cursor-pointer rounded-xl border border-[#e4e0f5] bg-white p-4 transition-colors hover:bg-[#f5f3ff]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <LinkIcon className="h-3.5 w-3.5 shrink-0 text-black/50" />
                        <p className="text-sm font-medium text-black">
                          {tool.tool_config.name}
                        </p>
                        {isAttached && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full bg-[#ede9ff] px-2 py-0.5 text-[11px] font-medium text-[#271173] ${
                              togglingWorkspaceId === tool.id ? 'animate-pulse' : ''
                            }`}
                          >
                            <CheckCircleIcon className="h-3.5 w-3.5" />
                            Adjunta
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 text-xs text-black/50">
                        <p>{tool.tool_config.description ?? 'Sin descripcion'}</p>
                        <p className="font-mono">Tipo: {tool.tool_config.type ?? 'unknown'}</p>
                        {tool.tool_config.api_schema?.url && (
                          <p className="truncate font-mono">
                            {tool.tool_config.api_schema.method ?? 'GET'}{' '}
                            {tool.tool_config.api_schema.url}
                          </p>
                        )}
                        {tool.access_info?.creator_email && (
                          <p>Owner: {tool.access_info.creator_email}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={deletingToolId === tool.id}
                          onClick={(e) => handleDeleteTool(tool.id, e)}
                          className="rounded-lg p-1.5 text-black/40 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                          title="Eliminar herramienta"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                      <div onClick={(event) => event.stopPropagation()}>
                        <ToolToggle
                          active={isAttached}
                          onChange={(value) => handleWorkspaceToggle(tool.id, value)}
                        />
                      </div>
                      <ChevronDownIcon
                        className={`h-4 w-4 text-black/50 transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </div>

                  {isExpanded && hasApiSchema && (
                    <div className="mt-3 border-t border-[#e4e0f5] pt-3">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black/45">
                        api_schema
                      </p>
                      <pre className="overflow-x-auto rounded-xl bg-[#1a1a2e] p-3 font-mono text-xs text-green-400">
                        {apiSchemaText}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <EmptyState message="No hay webhooks creados por ti. Crea el primero con el boton Nueva." />
          )}
        </div>
      </div>
      )}

      {/* Embedded tools */}
      <div className="rounded-xl border border-[#e4e0f5] bg-white p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <LinkIcon className="h-4 w-4 text-[#271173]" />
          <p className="text-sm font-medium text-black">Herramientas embebidas ya presentes</p>
        </div>

        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 text-amber-600" />
            <p className="text-xs leading-5 text-amber-900">
              Estas herramientas estan directamente en el prompt del agente. Se preservan al
              guardar pero no se pueden editar desde aqui.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {embeddedTools.length > 0 ? (
            embeddedTools.map((tool: Record<string, unknown>, index) => {
              const embeddedId = `${String(tool.name ?? 'embedded')}-${index}`
              const isExpanded = expandedEmbeddedId === embeddedId

              return (
                <div
                  key={embeddedId}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    setExpandedEmbeddedId((current) =>
                      current === embeddedId ? null : embeddedId
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setExpandedEmbeddedId((current) =>
                        current === embeddedId ? null : embeddedId
                      )
                    }
                  }}
                  className="cursor-pointer rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-4"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircleIcon className="h-4 w-4 text-[#271173]" />
                      <p className="text-sm font-medium text-black">
                        {String(tool.name ?? `tool_${index + 1}`)}
                      </p>
                    </div>
                    <ChevronDownIcon
                      className={`h-4 w-4 text-black/50 transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                  <p className="text-xs text-black/60">Tipo: {String(tool.type ?? 'custom')}</p>
                  {'description' in tool && typeof tool.description === 'string' && (
                    <p className="mt-1 text-xs text-black/50">{tool.description}</p>
                  )}

                  {isExpanded && (
                    <div className="mt-3 border-t border-[#e4e0f5] pt-3">
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black/45">
                        tool json
                      </p>
                      <pre className="overflow-x-auto rounded-xl bg-[#1a1a2e] p-3 font-mono text-xs text-green-400">
                        {JSON.stringify(tool, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })
          ) : (
            <EmptyState message="Este agente no tiene herramientas embebidas adicionales." />
          )}
        </div>
      </div>

      {showCreateModal && !isClient && (
        <CreateToolModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['workspace-tools'] })}
        />
      )}
    </div>
  )
}





