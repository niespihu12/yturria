import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { createTool } from '@/api/VoiceRuntimeAPI'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { Field, SectionHeading, SwitchField } from './fields'
import { describeError, errorClass, inputClass, labelClass, textareaClass } from './agentUi'

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

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const CONTENT_TYPES = ['application/json', 'application/x-www-form-urlencoded'] as const
const EXECUTION_MODES = ['immediate', 'post_tool_speech', 'async'] as const
const TOOL_ERROR_HANDLING_MODES = ['auto', 'summarized', 'passthrough', 'hide'] as const
const TOOL_CALL_SOUND_BEHAVIORS = ['auto', 'always'] as const
const JSON_LITERAL_TYPES: JsonLiteralType[] = ['string', 'number', 'integer', 'boolean']

type CreateToolForm = {
  name: string
  description: string
  url: string
  method: (typeof HTTP_METHODS)[number]
  response_timeout_secs: string
  content_type: (typeof CONTENT_TYPES)[number]
  execution_mode: (typeof EXECUTION_MODES)[number]
  tool_error_handling_mode: (typeof TOOL_ERROR_HANDLING_MODES)[number]
  tool_call_sound_behavior: (typeof TOOL_CALL_SOUND_BEHAVIORS)[number]
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

const TYPE_LABELS: Record<JsonLiteralType, string> = {
  string: 'Texto',
  number: 'Número',
  integer: 'Número entero',
  boolean: 'Sí o no',
}

const EXECUTION_MODE_LABELS: Record<CreateToolForm['execution_mode'], string> = {
  immediate: 'Inmediata',
  post_tool_speech: 'Después de que el agente hable',
  async: 'En segundo plano',
}

const ERROR_MODE_LABELS: Record<CreateToolForm['tool_error_handling_mode'], string> = {
  auto: 'Automático',
  summarized: 'Resumir el error',
  passthrough: 'Mostrar el error tal cual',
  hide: 'Ocultar el error',
}

const SOUND_BEHAVIOR_LABELS: Record<CreateToolForm['tool_call_sound_behavior'], string> = {
  auto: 'Automático',
  always: 'Siempre',
}

const PARAM_VALUE_SOURCES: Array<{
  value: ParamValueSource
  label: string
  description: string
}> = [
  {
    value: 'llm_prompt',
    label: 'Lo deduce el agente',
    description: 'El agente obtiene el valor de la conversación.',
  },
  {
    value: 'constant',
    label: 'Valor fijo',
    description: 'Siempre se envía el mismo valor.',
  },
  {
    value: 'dynamic_variable',
    label: 'Variable dinámica',
    description: 'Se toma de una variable de la conversación.',
  },
  {
    value: 'system_provided',
    label: 'Lo completa el sistema',
    description: 'La plataforma llena este valor automáticamente.',
  },
]

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

export default function CreateToolModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const formId = useId()
  const baseId = useId()
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
    onError: (error: Error) =>
      toast.error(describeError(error, 'No pudimos crear la herramienta. Intente de nuevo.')),
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

    if (!form.name.trim()) addError('name', 'Escriba un nombre para la herramienta.')
    if (!form.description.trim()) addError('description', 'Explique cuándo debe usarse la herramienta.')
    if (!form.url.trim()) addError('url', 'Escriba la dirección web de la herramienta.')

    if (form.url.trim()) {
      try {
        new URL(form.url.trim()) // throws if invalid, intentionally unassigned
      } catch {
        addError('url', 'La dirección no es válida. Ejemplo: https://api.ejemplo.com/v1/recurso')
      }
    }

    const timeout = Number(form.response_timeout_secs)
    if (!Number.isFinite(timeout) || timeout <= 0) {
      addError('response_timeout_secs', 'El tiempo de espera debe ser un número mayor que 0.')
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
        addError(key, `${label} no tiene un formato JSON válido.`)
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
          addError(key, `${label} debe ser una lista JSON.`)
          return undefined
        }

        if (!parsed.every((item) => isRecord(item))) {
          addError(key, `${label} debe ser una lista de objetos JSON.`)
          return undefined
        }

        return parsed.map((item) => ({ ...(item as Record<string, unknown>) }))
      } catch {
        addError(key, `${label} no tiene un formato JSON válido.`)
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
          addError(`${errorPrefix}.enum_values`, 'Los valores permitidos solo aplican al tipo Texto.')
        } else {
          literal.enum = enumValues
        }
      }

      if (row.value_source === 'llm_prompt') {
        const description = row.description.trim()
        if (!description) {
          addError(
            `${errorPrefix}.description`,
            'Explique cómo obtener este dato de la conversación.'
          )
          return null
        }
        literal.description = description
        return literal
      }

      if (row.value_source === 'dynamic_variable') {
        const dynamicVariable = row.dynamic_variable.trim()
        if (!dynamicVariable) {
          addError(`${errorPrefix}.dynamic_variable`, 'Escriba el nombre de la variable dinámica.')
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
        addError(`${errorPrefix}.constant_value`, 'Escriba el valor fijo.')
        return null
      }

      if (row.type === 'string') {
        literal.constant_value = rawConstant
        return literal
      }

      if (row.type === 'boolean') {
        const normalized = rawConstant.toLowerCase()
        if (normalized !== 'true' && normalized !== 'false') {
          addError(`${errorPrefix}.constant_value`, 'Para Sí o no, escriba true o false.')
          return null
        }
        literal.constant_value = normalized === 'true'
        return literal
      }

      const asNumber = Number(rawConstant)
      if (!Number.isFinite(asNumber)) {
        addError(`${errorPrefix}.constant_value`, 'El valor fijo debe ser un número.')
        return null
      }

      if (row.type === 'integer' && !Number.isInteger(asNumber)) {
        addError(`${errorPrefix}.constant_value`, 'El valor fijo debe ser un número entero.')
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
        addError(`headers.${row.id}.key`, 'Escriba el nombre del encabezado.')
        continue
      }

      if (Object.prototype.hasOwnProperty.call(requestHeaders, key)) {
        addError(`headers.${row.id}.key`, 'Ese encabezado está repetido.')
        continue
      }

      requestHeaders[key] = value
    }

    const pathParamsSchema: Record<string, unknown> = {}
    for (const row of pathParams) {
      const identifier = row.identifier.trim()
      if (!identifier) {
        addError(`path.${row.id}.identifier`, 'Escriba el identificador del parámetro de ruta.')
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
        addError(`query.${row.id}.identifier`, 'Escriba el identificador del parámetro.')
        continue
      }

      if (Object.prototype.hasOwnProperty.call(queryProperties, identifier)) {
        addError(`query.${row.id}.identifier`, 'Ese parámetro ya existe.')
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
      'El esquema del cuerpo',
      form.request_body_schema,
      { allowNull: true, emptyAsNull: true }
    )
    const authConnection = parseObjectField(
      'auth_connection',
      'La conexión de autenticación',
      form.auth_connection,
      { allowNull: true, emptyAsNull: true }
    )
    const dynamicPlaceholders = parseObjectField(
      'dynamic_variable_placeholders',
      'Las variables dinámicas',
      form.dynamic_variable_placeholders
    )
    const assignments = parseObjectArrayField('assignments', 'Las asignaciones', form.assignments)
    const responseMocks = parseObjectArrayField('response_mocks', 'Las respuestas simuladas', form.response_mocks)

    let toolCallSound: string | null = null
    if (form.tool_call_sound_mode === 'default') {
      toolCallSound = 'default'
    } else if (form.tool_call_sound_mode === 'custom') {
      const customSound = form.tool_call_sound_custom.trim()
      if (!customSound) {
        addError('tool_call_sound_custom', 'Escriba el nombre del sonido personalizado.')
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
    // El modal vive dentro del formulario del agente en el árbol de React:
    // evita que el envío dispare también "Guardar cambios".
    e.stopPropagation()
    const payload = buildPayload()
    if (payload) mutate(payload)
  }

  const renderParamRow = (
    row: ToolParamRow,
    index: number,
    options: {
      section: 'path' | 'query'
      identifierReadOnly?: boolean
      showRequired?: boolean
      onChange: (rowId: string, patch: Partial<ToolParamRow>) => void
      onRemove?: (rowId: string) => void
    }
  ) => {
    const prefix = `${options.section}.${row.id}`
    const rowId = `${baseId}-${row.id}`
    const sourceLabelId = `${rowId}-source`

    return (
      <li key={row.id} className="space-y-4 py-4 first:pt-0 last:pb-0">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-end">
          <Field label="Tipo de dato">
            {(control) => (
              <select
                {...control}
                value={row.type}
                onChange={(event) =>
                  options.onChange(row.id, { type: event.target.value as ToolParamRow['type'] })
                }
                className={inputClass}
              >
                {JSON_LITERAL_TYPES.map((dataType) => (
                  <option key={dataType} value={dataType}>
                    {TYPE_LABELS[dataType]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Identificador" error={errors[`${prefix}.identifier`]}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={row.identifier}
                readOnly={Boolean(options.identifierReadOnly)}
                onChange={(event) => options.onChange(row.id, { identifier: event.target.value })}
                placeholder="customer_id"
                className={cn(inputClass, 'font-mono', options.identifierReadOnly && 'bg-surface-muted text-text-secondary')}
              />
            )}
          </Field>

          <div className="flex items-center gap-2 md:pb-2.5">
            {options.showRequired ? (
              <label className="inline-flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(event) => options.onChange(row.id, { required: event.target.checked })}
                  className="h-4 w-4 accent-primary-600"
                />
                Obligatorio
              </label>
            ) : (
              <span className="text-sm text-text-tertiary">Obligatorio (viene de la dirección)</span>
            )}

            {options.onRemove && (
              <button
                type="button"
                onClick={() => options.onRemove?.(row.id)}
                aria-label={`Eliminar el parámetro ${index + 1}`}
                className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700"
              >
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <fieldset>
          <legend id={sourceLabelId} className={labelClass}>
            Origen del valor
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {PARAM_VALUE_SOURCES.map((source) => (
              <label
                key={source.value}
                className="flex cursor-pointer gap-2.5 rounded-lg border border-border-default bg-surface px-3 py-2.5 transition-colors hover:bg-surface-muted has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500"
              >
                <input
                  type="radio"
                  name={`${rowId}-value-source`}
                  value={source.value}
                  checked={row.value_source === source.value}
                  onChange={() => options.onChange(row.id, { value_source: source.value })}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
                />
                <span>
                  <span className="block text-sm font-medium text-text-primary">{source.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-text-tertiary">
                    {source.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {row.type === 'string' && (
          <Field
            label="Valores permitidos (opcional)"
            help="Sepárelos con comas."
            error={errors[`${prefix}.enum_values`]}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                value={row.enum_values}
                onChange={(event) => options.onChange(row.id, { enum_values: event.target.value })}
                placeholder="vip, estándar, básico"
                className={inputClass}
              />
            )}
          </Field>
        )}

        {row.value_source === 'llm_prompt' && (
          <Field label="Descripción" error={errors[`${prefix}.description`]}>
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={row.description}
                onChange={(event) => options.onChange(row.id, { description: event.target.value })}
                className={textareaClass}
                placeholder="Explique cómo obtener este dato de la conversación."
              />
            )}
          </Field>
        )}

        {row.value_source === 'constant' && (
          <Field label="Valor fijo" error={errors[`${prefix}.constant_value`]}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={row.constant_value}
                onChange={(event) => options.onChange(row.id, { constant_value: event.target.value })}
                className={inputClass}
                placeholder={row.type === 'boolean' ? 'true' : 'Valor'}
              />
            )}
          </Field>
        )}

        {row.value_source === 'dynamic_variable' && (
          <Field label="Variable dinámica" error={errors[`${prefix}.dynamic_variable`]}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={row.dynamic_variable}
                onChange={(event) => options.onChange(row.id, { dynamic_variable: event.target.value })}
                className={cn(inputClass, 'font-mono')}
                placeholder="customer_id"
              />
            )}
          </Field>
        )}
      </li>
    )
  }

  const jsonClass = cn(textareaClass, 'font-mono text-xs')

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      dismissOnBackdrop={false}
      title="Nueva herramienta conectada"
      description="Conecte el agente con un sistema externo mediante una solicitud web (webhook)."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} isLoading={isPending}>
            {isPending ? 'Creando…' : 'Crear herramienta'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="divide-y divide-border-default">
        <section className="space-y-4 pb-6">
          <SectionHeading as="h3" title="Datos básicos" />
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
            <Field label="Nombre" help="Sin espacios, por ejemplo consultar_disponibilidad." error={errors.name}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={form.name}
                  onChange={(event) => set('name', event.target.value)}
                  placeholder="consultar_disponibilidad"
                  className={cn(inputClass, 'font-mono')}
                />
              )}
            </Field>
            <Field label="Método">
              {(control) => (
                <select
                  {...control}
                  value={form.method}
                  onChange={(event) => set('method', event.target.value as CreateToolForm['method'])}
                  className={inputClass}
                >
                  {HTTP_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <Field
            label="Cuándo usarla"
            help="El agente lee esta descripción para decidir cuándo llamar a la herramienta."
            error={errors.description}
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
                placeholder="Consulta la disponibilidad de citas cuando el cliente pide agendar."
                className={textareaClass}
              />
            )}
          </Field>

          <Field
            label="Dirección web (URL)"
            help="Use llaves para parámetros de ruta, por ejemplo {order_id}, y {{ para variables de entorno."
            error={errors.url}
          >
            {(control) => (
              <input
                {...control}
                type="url"
                inputMode="url"
                value={form.url}
                onChange={(event) => set('url', event.target.value)}
                placeholder="https://api.ejemplo.com/v1/pedidos/{order_id}"
                className={cn(inputClass, 'font-mono')}
              />
            )}
          </Field>
        </section>

        <section className="space-y-4 py-6">
          <SectionHeading as="h3" title="Ejecución" description="Cómo se comporta la herramienta durante la llamada." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Tiempo máximo de espera (segundos)"
              help="Se recomiendan 20 segundos."
              error={errors.response_timeout_secs}
            >
              {(control) => (
                <input
                  {...control}
                  type="number"
                  min={1}
                  step={1}
                  value={form.response_timeout_secs}
                  onChange={(event) => set('response_timeout_secs', event.target.value)}
                  className={cn(inputClass, 'tabular-nums')}
                />
              )}
            </Field>
            <Field label="Aviso antes de usarla" help="Si el agente debe decir algo antes de ejecutarla.">
              {(control) => (
                <select
                  {...control}
                  value={form.pre_tool_speech_mode}
                  onChange={(event) =>
                    set('pre_tool_speech_mode', event.target.value as CreateToolForm['pre_tool_speech_mode'])
                  }
                  className={inputClass}
                >
                  <option value="auto">Automático</option>
                  <option value="forced">Siempre</option>
                </select>
              )}
            </Field>
            <Field label="Momento de ejecución">
              {(control) => (
                <select
                  {...control}
                  value={form.execution_mode}
                  onChange={(event) =>
                    set('execution_mode', event.target.value as CreateToolForm['execution_mode'])
                  }
                  className={inputClass}
                >
                  {EXECUTION_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {EXECUTION_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Si la herramienta falla">
              {(control) => (
                <select
                  {...control}
                  value={form.tool_error_handling_mode}
                  onChange={(event) =>
                    set('tool_error_handling_mode', event.target.value as CreateToolForm['tool_error_handling_mode'])
                  }
                  className={inputClass}
                >
                  {TOOL_ERROR_HANDLING_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {ERROR_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Sonido mientras se ejecuta">
              {(control) => (
                <select
                  {...control}
                  value={form.tool_call_sound_mode}
                  onChange={(event) =>
                    set('tool_call_sound_mode', event.target.value as CreateToolForm['tool_call_sound_mode'])
                  }
                  className={inputClass}
                >
                  <option value="none">Ninguno</option>
                  <option value="default">Predeterminado</option>
                  <option value="custom">Personalizado</option>
                </select>
              )}
            </Field>
            <Field label="Cuándo reproducir el sonido">
              {(control) => (
                <select
                  {...control}
                  value={form.tool_call_sound_behavior}
                  onChange={(event) =>
                    set('tool_call_sound_behavior', event.target.value as CreateToolForm['tool_call_sound_behavior'])
                  }
                  className={inputClass}
                >
                  {TOOL_CALL_SOUND_BEHAVIORS.map((mode) => (
                    <option key={mode} value={mode}>
                      {SOUND_BEHAVIOR_LABELS[mode]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {form.tool_call_sound_mode === 'custom' && (
              <Field label="Nombre del sonido personalizado" error={errors.tool_call_sound_custom}>
                {(control) => (
                  <input
                    {...control}
                    type="text"
                    value={form.tool_call_sound_custom}
                    onChange={(event) => set('tool_call_sound_custom', event.target.value)}
                    placeholder="nombre_del_sonido"
                    className={inputClass}
                  />
                )}
              </Field>
            )}
            <Field label="Formato del contenido">
              {(control) => (
                <select
                  {...control}
                  value={form.content_type}
                  onChange={(event) => set('content_type', event.target.value as CreateToolForm['content_type'])}
                  className={cn(inputClass, 'font-mono')}
                >
                  {CONTENT_TYPES.map((contentType) => (
                    <option key={contentType} value={contentType}>
                      {contentType}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <SwitchField
            label="Evitar interrupciones mientras se ejecuta"
            description="Quien llama no puede interrumpir al agente hasta que la herramienta responda."
            checked={form.disable_interruptions}
            onChange={(value) => set('disable_interruptions', value)}
          />
        </section>

        <section className="space-y-4 py-6">
          <SectionHeading
            as="h3"
            title="Encabezados"
            description="Se envían con cada solicitud."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHeaders((prev) => [...prev, createHeaderRow()])}
                leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
              >
                Agregar encabezado
              </Button>
            }
          />
          <ul className="space-y-3">
            {headers.map((header, index) => {
              const keyId = `${baseId}-${header.id}-key`
              const valueId = `${baseId}-${header.id}-value`
              const keyError = errors[`headers.${header.id}.key`]
              return (
                <li key={header.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div>
                    <label htmlFor={keyId} className="sr-only">
                      Nombre del encabezado {index + 1}
                    </label>
                    <input
                      id={keyId}
                      type="text"
                      value={header.key}
                      onChange={(event) => updateHeaderRow(header.id, { key: event.target.value })}
                      placeholder="Authorization"
                      aria-invalid={keyError ? true : undefined}
                      aria-describedby={keyError ? `${keyId}-error` : undefined}
                      className={cn(inputClass, 'font-mono')}
                    />
                    {keyError && (
                      <p id={`${keyId}-error`} className={errorClass}>
                        {keyError}
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor={valueId} className="sr-only">
                      Valor del encabezado {index + 1}
                    </label>
                    <input
                      id={valueId}
                      type="text"
                      value={header.value}
                      onChange={(event) => updateHeaderRow(header.id, { value: event.target.value })}
                      placeholder="Bearer {{api_key}}"
                      className={cn(inputClass, 'font-mono')}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeHeaderRow(header.id)}
                    aria-label={`Eliminar el encabezado ${index + 1}`}
                    className="self-start rounded-lg p-2.5 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700"
                  >
                    <TrashIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="space-y-4 py-6">
          <SectionHeading
            as="h3"
            title="Parámetros de ruta"
            description="Se detectan automáticamente a partir de las llaves en la dirección web."
          />
          {pathParams.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {pathParams.map((row, index) =>
                renderParamRow(row, index, {
                  section: 'path',
                  identifierReadOnly: true,
                  showRequired: false,
                  onChange: updatePathParamRow,
                })
              )}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">
              No hay parámetros de ruta. Escriba, por ejemplo, {'{order_id}'} en la dirección web.
            </p>
          )}
        </section>

        <section className="space-y-4 py-6">
          <SectionHeading
            as="h3"
            title="Parámetros de consulta"
            description="Datos que el agente recopila y envía en la dirección web."
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setQueryParams((prev) => [...prev, createToolParamRow()])}
                leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
              >
                Agregar parámetro
              </Button>
            }
          />
          {queryParams.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {queryParams.map((row, index) =>
                renderParamRow(row, index, {
                  section: 'query',
                  showRequired: true,
                  onChange: updateQueryParamRow,
                  onRemove: removeQueryParamRow,
                })
              )}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">Aún no hay parámetros de consulta.</p>
          )}
        </section>

        <section className="space-y-4 pt-6">
          <SectionHeading
            as="h3"
            title="Opciones técnicas (JSON)"
            description="Para integraciones que necesitan un cuerpo, autenticación o variables específicas."
          />
          <Field
            label="Esquema del cuerpo de la solicitud"
            help="Para POST, PUT o PATCH. Déjelo vacío si no se envía cuerpo."
            error={errors.request_body_schema}
          >
            {(control) => (
              <textarea
                {...control}
                rows={4}
                value={form.request_body_schema}
                onChange={(event) => set('request_body_schema', event.target.value)}
                className={jsonClass}
                placeholder='{"type":"object","properties":{"customer_id":{"type":"string"}},"required":["customer_id"]}'
              />
            )}
          </Field>
          <Field
            label="Conexión de autenticación"
            help="Opcional. Referencia a una conexión de autenticación existente."
            error={errors.auth_connection}
          >
            {(control) => (
              <textarea
                {...control}
                rows={2}
                value={form.auth_connection}
                onChange={(event) => set('auth_connection', event.target.value)}
                className={jsonClass}
                placeholder='{"type":"auth_connection_id","auth_connection_id":"auth_xxx"}'
              />
            )}
          </Field>
          <div className="grid gap-4 lg:grid-cols-3">
            <Field
              label="Variables dinámicas"
              help="Se reemplazan al iniciar la conversación."
              error={errors.dynamic_variable_placeholders}
            >
              {(control) => (
                <textarea
                  {...control}
                  rows={5}
                  value={form.dynamic_variable_placeholders}
                  onChange={(event) => set('dynamic_variable_placeholders', event.target.value)}
                  className={jsonClass}
                  placeholder='{"customer_id":{"type":"string"}}'
                />
              )}
            </Field>
            <Field
              label="Asignaciones de variables"
              help="Variables que se actualizan con la respuesta."
              error={errors.assignments}
            >
              {(control) => (
                <textarea
                  {...control}
                  rows={5}
                  value={form.assignments}
                  onChange={(event) => set('assignments', event.target.value)}
                  className={jsonClass}
                  placeholder='[{"type":"dynamic_variable","output_key":"result.id","dynamic_variable":"order_id"}]'
                />
              )}
            </Field>
            <Field
              label="Respuestas simuladas"
              help="Para probar sin usar sistemas reales."
              error={errors.response_mocks}
            >
              {(control) => (
                <textarea
                  {...control}
                  rows={5}
                  value={form.response_mocks}
                  onChange={(event) => set('response_mocks', event.target.value)}
                  className={jsonClass}
                  placeholder='[{"name":"default","response":{"status":"ok"}}]'
                />
              )}
            </Field>
          </div>
        </section>
      </form>
    </Modal>
  )
}
