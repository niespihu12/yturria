import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  createTextAgentTool,
  deleteTextAgentTool,
  updateTextAgentTool,
} from '@/api/TextAgentsAPI'
import type { TextAgentTool } from '@/types/textAgent'

type Props = {
  agentId: string
  tools: TextAgentTool[]
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type ParamType = 'string' | 'number' | 'boolean' | 'array'

type ParamDef = {
  name: string
  type: ParamType
  description: string
  required: boolean
}

type ToolDraft = {
  name: string
  description: string
  endpoint_url: string
  http_method: HttpMethod
  headers: Array<{ key: string; value: string }>
  params: ParamDef[]
  result_field: string
  display_fields: string
}

const EMPTY_PARAM: ParamDef = { name: '', type: 'string', description: '', required: false }

const EMPTY_DRAFT: ToolDraft = {
  name: '',
  description: '',
  endpoint_url: '',
  http_method: 'GET',
  headers: [],
  params: [{ name: 'query', type: 'string', description: 'Término de búsqueda', required: true }],
  result_field: '',
  display_fields: '',
}

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  POST: 'bg-blue-50 text-blue-700 border-blue-200',
  PUT: 'bg-amber-50 text-amber-700 border-amber-200',
  PATCH: 'bg-orange-50 text-orange-700 border-orange-200',
  DELETE: 'bg-rose-50 text-rose-700 border-rose-200',
}

const PARAM_TYPE_LABELS: Record<ParamType, string> = {
  string: 'Texto',
  number: 'Número',
  boolean: 'Sí/No',
  array: 'Lista',
}

const inputClass =
  'w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none'

const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-black/50'

function buildParametersSchema(params: ParamDef[]): object {
  if (params.length === 0) return {}
  const properties: Record<string, object> = {}
  const required: string[] = []
  for (const p of params) {
    if (!p.name.trim()) continue
    properties[p.name.trim()] = {
      type: p.type,
      ...(p.description ? { description: p.description } : {}),
    }
    if (p.required) required.push(p.name.trim())
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

function buildResponseMapping(result_field: string, display_fields: string): object {
  if (!result_field.trim() && !display_fields.trim()) return {}
  const result_path = result_field.trim() ? `$.${result_field.trim()}` : ''
  const fields = display_fields.split(',').map((f) => f.trim()).filter(Boolean)
  const display_template = fields.length > 0 ? fields.map((f) => `{${f}}`).join(' · ') : ''
  return {
    ...(result_path ? { result_path } : {}),
    ...(display_template ? { display_template } : {}),
  }
}

function HeadersEditor({
  headers,
  onChange,
}: {
  headers: Array<{ key: string; value: string }>
  onChange: (h: Array<{ key: string; value: string }>) => void
}) {
  return (
    <div className="space-y-2">
      {headers.map((h, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            value={h.key}
            onChange={(e) => {
              const next = [...headers]
              next[i] = { ...next[i], key: e.target.value }
              onChange(next)
            }}
            placeholder="Authorization"
            className="min-w-0 flex-1 rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/40 focus:border-[#271173] focus:outline-none"
          />
          <input
            type="text"
            value={h.value}
            onChange={(e) => {
              const next = [...headers]
              next[i] = { ...next[i], value: e.target.value }
              onChange(next)
            }}
            placeholder="Bearer token..."
            className="min-w-0 flex-1 rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/40 focus:border-[#271173] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onChange(headers.filter((_, idx) => idx !== i))}
            className="rounded-lg border border-rose-200 p-2 text-rose-500 transition-colors hover:bg-rose-50"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...headers, { key: '', value: '' }])}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#d4cfee] px-3 py-1.5 text-xs font-medium text-black/50 transition-colors hover:border-[#271173] hover:text-[#271173]"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Agregar header
      </button>
    </div>
  )
}

function ParamsEditor({
  params,
  onChange,
}: {
  params: ParamDef[]
  onChange: (p: ParamDef[]) => void
}) {
  return (
    <div className="space-y-2">
      {params.map((p, i) => (
        <div key={i} className="rounded-xl border border-[#e4e0f5] bg-[#fafafa] p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={p.name}
              onChange={(e) => {
                const next = [...params]
                next[i] = { ...next[i], name: e.target.value }
                onChange(next)
              }}
              placeholder="nombre_param"
              className="min-w-0 w-36 rounded-lg border border-[#e4e0f5] bg-white px-2.5 py-1.5 font-mono text-xs text-black placeholder:text-black/30 focus:border-[#271173] focus:outline-none"
            />
            <select
              value={p.type}
              onChange={(e) => {
                const next = [...params]
                next[i] = { ...next[i], type: e.target.value as ParamType }
                onChange(next)
              }}
              className="rounded-lg border border-[#e4e0f5] bg-white px-2 py-1.5 text-xs text-black focus:border-[#271173] focus:outline-none"
            >
              {(Object.keys(PARAM_TYPE_LABELS) as ParamType[]).map((t) => (
                <option key={t} value={t}>{PARAM_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <div className="flex flex-1 items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-black/60 select-none">
                <input
                  type="checkbox"
                  checked={p.required}
                  onChange={(e) => {
                    const next = [...params]
                    next[i] = { ...next[i], required: e.target.checked }
                    onChange(next)
                  }}
                  className="h-3.5 w-3.5 accent-[#271173]"
                />
                Requerido
              </label>
            </div>
            <button
              type="button"
              onClick={() => onChange(params.filter((_, idx) => idx !== i))}
              className="rounded-lg border border-rose-200 p-1.5 text-rose-400 transition-colors hover:bg-rose-50"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            type="text"
            value={p.description}
            onChange={(e) => {
              const next = [...params]
              next[i] = { ...next[i], description: e.target.value }
              onChange(next)
            }}
            placeholder="Describe para qué sirve este parámetro..."
            className="mt-2 w-full rounded-lg border border-[#e4e0f5] bg-white px-2.5 py-1.5 text-xs text-black placeholder:text-black/30 focus:border-[#271173] focus:outline-none"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...params, { ...EMPTY_PARAM }])}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#d4cfee] px-3 py-1.5 text-xs font-medium text-black/50 transition-colors hover:border-[#271173] hover:text-[#271173]"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Agregar parámetro
      </button>
    </div>
  )
}

function ResponseMappingEditor({
  result_field,
  display_fields,
  onChange,
}: {
  result_field: string
  display_fields: string
  onChange: (result_field: string, display_fields: string) => void
}) {
  const [open, setOpen] = useState(false)
  const hasData = result_field.trim() || display_fields.trim()

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between rounded-xl border border-dashed border-[#d4cfee] bg-[#fafafa] px-4 py-3 text-left transition-colors hover:border-[#271173]/30 hover:bg-[#f5f3ff]"
      >
        <div>
          <p className="text-xs font-semibold text-black/70">
            ¿Cómo mostrar los resultados?
            {hasData && (
              <span className="ml-2 rounded-full bg-[#ede9ff] px-2 py-0.5 text-[10px] text-[#271173]">configurado</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-black/40">
            Opcional — si lo omites el agente mostrará la respuesta completa
          </p>
        </div>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-black/40 transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="space-y-4 rounded-xl border border-[#e4e0f5] bg-white p-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/70">
              ¿En qué campo de la respuesta están los datos?
            </label>
            <input
              type="text"
              value={result_field}
              onChange={(e) => onChange(e.target.value, display_fields)}
              placeholder="items   ó   results   ó   data"
              className="w-full rounded-lg border border-[#e4e0f5] bg-[#fafafa] px-3 py-2 text-sm text-black placeholder:text-black/30 focus:border-[#271173] focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-black/40">
              Escribe el nombre del campo tal como aparece en la respuesta JSON de la API.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-black/70">
              ¿Qué información mostrar de cada resultado?
            </label>
            <input
              type="text"
              value={display_fields}
              onChange={(e) => onChange(result_field, e.target.value)}
              placeholder="nombre, precio, descripcion"
              className="w-full rounded-lg border border-[#e4e0f5] bg-[#fafafa] px-3 py-2 text-sm text-black placeholder:text-black/30 focus:border-[#271173] focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-black/40">
              Escribe los campos separados por coma. El agente los mostrará en ese orden.
            </p>
          </div>

          {(result_field.trim() || display_fields.trim()) && (
            <div className="rounded-lg border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40">Vista previa</p>
              <p className="mt-1 font-mono text-xs text-black/60">
                {display_fields
                  .split(',')
                  .map((f) => f.trim())
                  .filter(Boolean)
                  .map((f) => `{${f}}`)
                  .join(' · ') || '(sin campos)'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolCard({ tool, agentId }: { tool: TextAgentTool; agentId: string }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['text-agent', agentId] })

  const { mutate: remove, isPending: isRemoving } = useMutation({
    mutationFn: () => deleteTextAgentTool(agentId, tool.id),
    onSuccess: () => { toast.success('Herramienta eliminada'); refresh() },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: toggle } = useMutation({
    mutationFn: (enabled: boolean) => updateTextAgentTool(agentId, tool.id, { enabled }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  })

  const mc = METHOD_COLORS[tool.http_method] ?? 'bg-gray-50 text-gray-600 border-gray-200'

  const schema = (tool.parameters_schema as Record<string, unknown>) ?? {}
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required: string[] = (schema.required as string[]) ?? []
  const paramEntries = Object.entries(properties)

  const mapping = tool.response_mapping ?? {}
  const resultPath = (mapping as Record<string, string>).result_path ?? ''
  const displayTemplate = (mapping as Record<string, string>).display_template ?? ''

  return (
    <div className="overflow-hidden rounded-xl border border-[#e4e0f5] bg-white">
      <div className="flex items-center gap-3 px-5 py-4">
        <span className={`rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums ${mc}`}>
          {tool.http_method}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-black">{tool.name}</p>
          <p className="truncate text-xs text-black/50">{tool.endpoint_url}</p>
          {tool.description && <p className="mt-0.5 text-xs text-black/60">{tool.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => toggle(!tool.enabled)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              tool.enabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                : 'border-[#e4e0f5] text-black/50 hover:bg-[#f5f3ff]'
            }`}
          >
            {tool.enabled ? 'Activa' : 'Inactiva'}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="rounded-lg border border-[#e4e0f5] p-1.5 text-black/50 transition-colors duration-150 hover:border-[#271173] hover:text-[#271173]"
          >
            <ChevronDownIcon
              className={`h-4 w-4 transition-transform duration-200 ease-out ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
          <button
            type="button"
            disabled={isRemoving}
            onClick={() => remove()}
            className="rounded-lg border border-rose-200 p-1.5 text-rose-500 transition-colors hover:bg-rose-50 disabled:opacity-50"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-[#e4e0f5] bg-[#fafafa] px-5 py-4">
          {/* Headers */}
          {Object.keys(tool.headers).length > 0 && (
            <div>
              <p className={labelClass}>Headers</p>
              <div className="divide-y divide-[#e4e0f5] rounded-lg border border-[#e4e0f5] bg-white">
                {Object.entries(tool.headers).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 px-3 py-2 font-mono text-xs">
                    <span className="text-[#271173]">{k}:</span>
                    <span className="break-all text-black/70">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Parameters */}
          {paramEntries.length > 0 && (
            <div>
              <p className={labelClass}>Parámetros</p>
              <div className="space-y-1">
                {paramEntries.map(([name, def]) => (
                  <div key={name} className="flex items-start gap-2 rounded-lg border border-[#e4e0f5] bg-white px-3 py-2">
                    <span className="font-mono text-xs font-semibold text-[#271173]">{name}</span>
                    <span className="rounded bg-[#f5f3ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#271173]/70">
                      {PARAM_TYPE_LABELS[def.type as ParamType] ?? def.type}
                    </span>
                    {required.includes(name) && (
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
                        requerido
                      </span>
                    )}
                    {def.description && (
                      <span className="ml-1 text-xs text-black/50">{def.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Response mapping */}
          {(resultPath || displayTemplate) && (
            <div>
              <p className={labelClass}>Mapeo de respuesta</p>
              <div className="space-y-1">
                {resultPath && (
                  <div className="flex items-center gap-2 rounded-lg border border-[#e4e0f5] bg-white px-3 py-2">
                    <span className="text-xs font-semibold text-black/50">Ruta</span>
                    <code className="font-mono text-xs text-[#271173]">{resultPath}</code>
                  </div>
                )}
                {displayTemplate && (
                  <div className="flex items-center gap-2 rounded-lg border border-[#e4e0f5] bg-white px-3 py-2">
                    <span className="text-xs font-semibold text-black/50">Plantilla</span>
                    <code className="font-mono text-xs text-black/70">{displayTemplate}</code>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TextAgentToolsTab({ agentId, tools }: Props) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ToolDraft>(EMPTY_DRAFT)
  const [showForm, setShowForm] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['text-agent', agentId] })

  const { mutate: createTool, isPending: isCreating } = useMutation({
    mutationFn: () => {
      const headers: Record<string, string> = {}
      for (const h of draft.headers) {
        if (h.key.trim()) headers[h.key.trim()] = h.value
      }
      return createTextAgentTool(agentId, {
        name: draft.name,
        description: draft.description,
        endpoint_url: draft.endpoint_url,
        http_method: draft.http_method,
        headers,
        parameters_schema: buildParametersSchema(draft.params),
        response_mapping: buildResponseMapping(draft.result_field, draft.display_fields),
      })
    },
    onSuccess: () => {
      toast.success('Herramienta creada')
      setDraft(EMPTY_DRAFT)
      setShowForm(false)
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const canCreate = draft.name.trim() && draft.endpoint_url.trim()

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-black">Herramientas</h2>
          <p className="text-xs text-black/50">
            Conecta APIs externas que el agente puede invocar durante una conversación.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((p) => !p)}
          className="flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a]"
        >
          {showForm ? <XMarkIcon className="h-4 w-4" /> : <PlusIcon className="h-4 w-4" />}
          {showForm ? 'Cancelar' : 'Nueva herramienta'}
        </button>
      </div>

      {/* Creation form */}
      {showForm && (
        <div className="space-y-6 rounded-2xl border border-[#e4e0f5] bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-black">Configurar herramienta</h3>

          {/* Basic info */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Nombre *</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder="buscar_producto"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Descripción</label>
              <input
                type="text"
                value={draft.description}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                placeholder="Busca un producto por nombre o SKU"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div>
              <label className={labelClass}>Método</label>
              <select
                value={draft.http_method}
                onChange={(e) => setDraft((p) => ({ ...p, http_method: e.target.value as HttpMethod }))}
                className="rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm font-semibold text-black focus:border-[#271173] focus:outline-none"
              >
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>URL del endpoint *</label>
              <input
                type="url"
                value={draft.endpoint_url}
                onChange={(e) => setDraft((p) => ({ ...p, endpoint_url: e.target.value }))}
                placeholder="https://api.tienda.com/v1/products/search"
                className={inputClass}
              />
            </div>
          </div>

          {/* Headers */}
          <div>
            <label className={labelClass}>Headers de autenticación</label>
            <HeadersEditor
              headers={draft.headers}
              onChange={(h) => setDraft((p) => ({ ...p, headers: h }))}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Parameters */}
            <div>
              <div className="mb-2">
                <label className={labelClass}>Parámetros que enviará el agente</label>
                <p className="text-[11px] text-black/40">
                  Define qué datos incluirá el agente al llamar esta API.
                </p>
              </div>
              <ParamsEditor
                params={draft.params}
                onChange={(p) => setDraft((prev) => ({ ...prev, params: p }))}
              />
            </div>

            {/* Response mapping */}
            <ResponseMappingEditor
              result_field={draft.result_field}
              display_fields={draft.display_fields}
              onChange={(result_field, display_fields) =>
                setDraft((p) => ({ ...p, result_field, display_fields }))
              }
            />
          </div>

          <div className="flex justify-end gap-3 border-t border-[#e4e0f5] pt-4">
            <button
              type="button"
              onClick={() => { setDraft(EMPTY_DRAFT); setShowForm(false) }}
              className="rounded-xl bg-[#f5f3ff] px-4 py-2 text-sm font-medium text-black/70 transition-colors hover:bg-[#ede9ff]"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!canCreate || isCreating}
              onClick={() => createTool()}
              className="flex items-center gap-2 rounded-xl bg-[#271173] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-50"
            >
              {isCreating && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              Crear herramienta
            </button>
          </div>
        </div>
      )}

      {/* Tool list */}
      {tools.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#d4cfee] bg-[#fafafa] py-12 text-center">
          <p className="text-sm text-black/50">No hay herramientas configuradas todavía.</p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-2 text-sm font-medium text-[#271173] hover:text-[#1f0d5a]"
          >
            Crea la primera herramienta
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tools.map((tool, i) => (
            <div key={tool.id} className="stagger-item" style={{ animationDelay: `${i * 40}ms` }}>
              <ToolCard tool={tool} agentId={agentId} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
