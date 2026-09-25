import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { ChevronDownIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline'
import {
  createTextAgentTool,
  deleteTextAgentTool,
  updateTextAgentTool,
} from '@/api/TextAgentsAPI'
import type { TextAgentTool } from '@/types/textAgent'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'

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

type ToolParameterSchemaDef = {
  type?: string
  description?: string
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

const PARAM_TYPE_LABELS: Record<ParamType, string> = {
  string: 'Texto',
  number: 'Número',
  boolean: 'Sí/No',
  array: 'Lista',
}

const inputClass =
  'h-10 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus:border-primary-600'
const smallInputClass =
  'h-9 min-w-0 rounded-lg border border-border-default bg-surface px-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-600'

const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'
const hintClass = 'mt-1 text-xs leading-relaxed text-text-tertiary'
const microLabelClass = 'mb-1.5 text-xs font-semibold text-text-tertiary'

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
            aria-label={`Nombre del encabezado ${i + 1}`}
            value={h.key}
            onChange={(e) => {
              const next = [...headers]
              next[i] = { ...next[i], key: e.target.value }
              onChange(next)
            }}
            placeholder="Authorization"
            className={`${smallInputClass} flex-1 font-mono`}
          />
          <input
            type="text"
            aria-label={`Valor del encabezado ${i + 1}`}
            value={h.value}
            onChange={(e) => {
              const next = [...headers]
              next[i] = { ...next[i], value: e.target.value }
              onChange(next)
            }}
            placeholder="Bearer …"
            className={`${smallInputClass} flex-1 font-mono`}
          />
          <button
            type="button"
            onClick={() => onChange(headers.filter((_, idx) => idx !== i))}
            aria-label={`Quitar el encabezado ${i + 1}`}
            className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        leftIcon={<PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />}
        onClick={() => onChange([...headers, { key: '', value: '' }])}
      >
        Agregar encabezado
      </Button>
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
  const baseId = useId()
  return (
    <div className="space-y-2">
      {params.length > 0 && (
        <ul className="divide-y divide-border-subtle rounded-lg border border-border-default">
          {params.map((p, i) => (
            <li key={i} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label={`Nombre del parámetro ${i + 1}`}
                  value={p.name}
                  onChange={(e) => {
                    const next = [...params]
                    next[i] = { ...next[i], name: e.target.value }
                    onChange(next)
                  }}
                  placeholder="nombre_parametro"
                  className={`${smallInputClass} w-40 font-mono`}
                />
                <select
                  aria-label={`Tipo del parámetro ${i + 1}`}
                  value={p.type}
                  onChange={(e) => {
                    const next = [...params]
                    next[i] = { ...next[i], type: e.target.value as ParamType }
                    onChange(next)
                  }}
                  className={smallInputClass}
                >
                  {(Object.keys(PARAM_TYPE_LABELS) as ParamType[]).map((t) => (
                    <option key={t} value={t}>
                      {PARAM_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
                <label
                  htmlFor={`${baseId}-required-${i}`}
                  className="flex flex-1 cursor-pointer select-none items-center gap-1.5 text-sm text-text-secondary"
                >
                  <input
                    id={`${baseId}-required-${i}`}
                    type="checkbox"
                    checked={p.required}
                    onChange={(e) => {
                      const next = [...params]
                      next[i] = { ...next[i], required: e.target.checked }
                      onChange(next)
                    }}
                    className="h-4 w-4 accent-primary-700"
                  />
                  Obligatorio
                </label>
                <button
                  type="button"
                  onClick={() => onChange(params.filter((_, idx) => idx !== i))}
                  aria-label={`Quitar el parámetro ${p.name || i + 1}`}
                  className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700"
                >
                  <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <input
                type="text"
                aria-label={`Descripción del parámetro ${i + 1}`}
                value={p.description}
                onChange={(e) => {
                  const next = [...params]
                  next[i] = { ...next[i], description: e.target.value }
                  onChange(next)
                }}
                placeholder="Para qué sirve este dato"
                className={`${smallInputClass} w-full`}
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        leftIcon={<PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />}
        onClick={() => onChange([...params, { ...EMPTY_PARAM }])}
      >
        Agregar parámetro
      </Button>
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
  const baseId = useId()
  const hasData = result_field.trim() || display_fields.trim()

  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${baseId}-panel`}
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border-default px-4 py-3 text-left transition-colors hover:bg-surface-muted"
      >
        <span>
          <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
            Cómo mostrar los resultados
            {hasData && (
              <Badge variant="primary" size="sm">
                Configurado
              </Badge>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-text-tertiary">
            Opcional. Si lo omite, el agente usa la respuesta completa.
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200 ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div id={`${baseId}-panel`} className="space-y-4 px-1">
          <div>
            <label htmlFor={`${baseId}-result`} className={labelClass}>
              Campo de la respuesta con los datos
            </label>
            <input
              id={`${baseId}-result`}
              type="text"
              value={result_field}
              onChange={(e) => onChange(e.target.value, display_fields)}
              placeholder="items, results o data"
              className={`${inputClass} font-mono`}
            />
            <p className={hintClass}>Escriba el nombre del campo tal como aparece en la respuesta JSON.</p>
          </div>

          <div>
            <label htmlFor={`${baseId}-display`} className={labelClass}>
              Datos que se muestran de cada resultado
            </label>
            <input
              id={`${baseId}-display`}
              type="text"
              value={display_fields}
              onChange={(e) => onChange(result_field, e.target.value)}
              placeholder="nombre, precio, descripcion"
              className={`${inputClass} font-mono`}
            />
            <p className={hintClass}>Separe los campos con comas. El agente los muestra en ese orden.</p>
          </div>

          {display_fields.trim() && (
            <p className="text-xs text-text-secondary">
              Vista previa:{' '}
              <code className="font-mono text-text-primary">
                {display_fields
                  .split(',')
                  .map((f) => f.trim())
                  .filter(Boolean)
                  .map((f) => `{${f}}`)
                  .join(' · ')}
              </code>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ToolRow({
  tool,
  agentId,
  onDelete,
}: {
  tool: TextAgentTool
  agentId: string
  onDelete: (tool: TextAgentTool, remove: () => void) => void
}) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['text-agent', agentId] })

  const { mutate: remove, isPending: isRemoving } = useMutation({
    mutationFn: () => deleteTextAgentTool(agentId, tool.id),
    onSuccess: () => {
      toast.success('Herramienta eliminada')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: toggle, isPending: isToggling } = useMutation({
    mutationFn: (enabled: boolean) => updateTextAgentTool(agentId, tool.id, { enabled }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  })

  const schema = (tool.parameters_schema as Record<string, unknown>) ?? {}
  const properties = (schema.properties ?? {}) as Record<string, ToolParameterSchemaDef>
  const required: string[] = (schema.required as string[]) ?? []
  const paramEntries = Object.entries(properties)

  const mapping = tool.response_mapping ?? {}
  const rawResultPath = (mapping as Record<string, unknown>).result_path
  const rawDisplayTemplate = (mapping as Record<string, unknown>).display_template
  const resultPath = typeof rawResultPath === 'string' ? rawResultPath : ''
  const displayTemplate = typeof rawDisplayTemplate === 'string' ? rawDisplayTemplate : ''

  return (
    <li>
      <div className="flex flex-wrap items-start gap-3 px-4 py-4 sm:px-5">
        <Badge size="sm" className="mt-0.5 font-mono">
          {tool.http_method}
        </Badge>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">{tool.name}</p>
          {tool.description && <p className="mt-0.5 text-sm text-text-secondary">{tool.description}</p>}
          <p className="mt-0.5 truncate font-mono text-xs text-text-tertiary">{tool.endpoint_url}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={tool.enabled}
            aria-label={`Herramienta ${tool.name} ${tool.enabled ? 'activa' : 'inactiva'}`}
            disabled={isToggling}
            onClick={() => toggle(!tool.enabled)}
            className={`relative mr-2 inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
              tool.enabled ? 'bg-primary-600' : 'bg-neutral-300'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute left-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform ${
                tool.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailId}
            aria-label={expanded ? `Ocultar detalles de ${tool.name}` : `Ver detalles de ${tool.name}`}
            onClick={() => setExpanded((p) => !p)}
            className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-neutral-100 hover:text-text-primary"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={`h-4 w-4 transition-transform duration-200 ease-out ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
          <button
            type="button"
            disabled={isRemoving}
            onClick={() => onDelete(tool, () => remove())}
            aria-label={`Eliminar ${tool.name}`}
            className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50"
          >
            <TrashIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {expanded && (
        <div id={detailId} className="space-y-4 border-t border-border-subtle bg-surface-muted px-4 py-4 sm:px-5">
          {Object.keys(tool.headers).length > 0 && (
            <div>
              <p className={microLabelClass}>Encabezados</p>
              <dl className="space-y-1 font-mono text-xs">
                {Object.entries(tool.headers).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-primary-700">{k}:</dt>
                    <dd className="break-all text-text-secondary">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {paramEntries.length > 0 && (
            <div>
              <p className={microLabelClass}>Parámetros</p>
              <ul className="space-y-1.5">
                {paramEntries.map(([name, def]) => (
                  <li key={name} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-semibold text-primary-700">{name}</span>
                    <span className="text-text-tertiary">
                      {PARAM_TYPE_LABELS[def.type as ParamType] ?? def.type}
                      {required.includes(name) && ' · obligatorio'}
                    </span>
                    {def.description && <span className="text-text-secondary">{def.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(resultPath || displayTemplate) && (
            <div>
              <p className={microLabelClass}>Cómo se muestran los resultados</p>
              <dl className="space-y-1 text-xs">
                {resultPath && (
                  <div className="flex gap-2">
                    <dt className="text-text-tertiary">Campo</dt>
                    <dd className="font-mono text-text-primary">{resultPath}</dd>
                  </div>
                )}
                {displayTemplate && (
                  <div className="flex gap-2">
                    <dt className="text-text-tertiary">Formato</dt>
                    <dd className="font-mono text-text-secondary">{displayTemplate}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export default function TextAgentToolsTab({ agentId, tools }: Props) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ToolDraft>(EMPTY_DRAFT)
  const [showForm, setShowForm] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const baseId = useId()
  const fieldId = (name: string) => `${baseId}-${name}`

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

  const handleDelete = async (tool: TextAgentTool, remove: () => void) => {
    const accepted = await confirm({
      title: `¿Eliminar «${tool.name}»?`,
      description: 'El agente dejará de consultar este sistema durante las conversaciones. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar herramienta',
      tone: 'danger',
    })
    if (accepted) remove()
  }

  const cancelForm = () => {
    setDraft(EMPTY_DRAFT)
    setShowForm(false)
  }

  const canCreate = draft.name.trim() && draft.endpoint_url.trim()

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Herramientas</h2>
          <p className="mt-1 max-w-[60ch] text-sm text-text-secondary">
            Conecte el agente con sus sistemas (por ejemplo, para consultar pólizas o precios) y los
            consultará durante la conversación. Normalmente lo configura su equipo técnico.
          </p>
        </div>
        {!showForm && (
          <Button
            type="button"
            variant="secondary"
            leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setShowForm(true)}
          >
            Nueva herramienta
          </Button>
        )}
      </div>

      {showForm && (
        <section
          aria-labelledby={fieldId('form-title')}
          className="space-y-6 rounded-xl border border-border-default bg-surface p-5 sm:p-6"
        >
          <h3 id={fieldId('form-title')} className="text-base font-semibold text-text-primary">
            Nueva herramienta
          </h3>

          <div className="grid gap-4 @lg:grid-cols-2">
            <div>
              <label htmlFor={fieldId('name')} className={labelClass}>
                Nombre <span className="font-normal text-text-tertiary">(obligatorio)</span>
              </label>
              <input
                id={fieldId('name')}
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder="buscar_producto"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label htmlFor={fieldId('description')} className={labelClass}>
                Para qué sirve
              </label>
              <input
                id={fieldId('description')}
                type="text"
                value={draft.description}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                placeholder="Busca un producto por nombre o código"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <div>
              <label htmlFor={fieldId('method')} className={labelClass}>
                Método
              </label>
              <select
                id={fieldId('method')}
                value={draft.http_method}
                onChange={(e) => setDraft((p) => ({ ...p, http_method: e.target.value as HttpMethod }))}
                className={`${inputClass} font-mono`}
              >
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as HttpMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={fieldId('url')} className={labelClass}>
                Dirección (URL) <span className="font-normal text-text-tertiary">(obligatoria)</span>
              </label>
              <input
                id={fieldId('url')}
                type="url"
                value={draft.endpoint_url}
                onChange={(e) => setDraft((p) => ({ ...p, endpoint_url: e.target.value }))}
                placeholder="https://api.suempresa.com/v1/productos/buscar"
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>

          <fieldset>
            <legend className={labelClass}>Encabezados de autenticación</legend>
            <HeadersEditor
              headers={draft.headers}
              onChange={(h) => setDraft((p) => ({ ...p, headers: h }))}
            />
          </fieldset>

          <fieldset>
            <legend className={labelClass}>Datos que envía el agente</legend>
            <p className="-mt-1 mb-2 text-xs text-text-tertiary">
              Lo que el agente incluirá al consultar el sistema.
            </p>
            <ParamsEditor
              params={draft.params}
              onChange={(p) => setDraft((prev) => ({ ...prev, params: p }))}
            />
          </fieldset>

          <ResponseMappingEditor
            result_field={draft.result_field}
            display_fields={draft.display_fields}
            onChange={(result_field, display_fields) =>
              setDraft((p) => ({ ...p, result_field, display_fields }))
            }
          />

          <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={cancelForm}>
              Cancelar
            </Button>
            <Button type="button" isLoading={isCreating} disabled={!canCreate} onClick={() => createTool()}>
              Crear herramienta
            </Button>
          </div>
        </section>
      )}

      {tools.length === 0 ? (
        !showForm && (
          <p className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center text-sm text-text-tertiary">
            Este agente aún no consulta ningún sistema externo.
          </p>
        )
      ) : (
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
          {tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              agentId={agentId}
              onDelete={(target, remove) => void handleDelete(target, remove)}
            />
          ))}
        </ul>
      )}

      {confirmDialog}
    </div>
  )
}
