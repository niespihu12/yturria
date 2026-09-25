import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  ChevronDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
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
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/utils'
import CreateToolModal from '../CreateToolModal'
import { Field, SectionHeading, Switch, SwitchField } from '../fields'
import { describeError, inputClass, textareaClass } from '../agentUi'

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
type SuggestedToolKind = 'send_whatsapp_message' | 'schedule_appointment'

const SYSTEM_TOOL_TYPE_BY_NAME: Record<string, string> = {
  end_call: 'end_call',
  language_detection: 'language_detection',
  skip_turn: 'skip_turn',
  transfer_to_agent: 'transfer_to_agent',
  transfer_to_number: 'transfer_to_number',
  dtmf: 'play_keypad_touch_tone',
  voicemail_detection: 'voicemail_detection',
}

const CLIENT_ALLOWED_SYSTEM_TOOLS = ['end_call', 'transfer_to_number', 'voicemail_detection']

// Textos de negocio para las acciones del sistema.
const SYSTEM_TOOL_COPY: Record<string, { label: string; description: string }> = {
  end_call: {
    label: 'Terminar la llamada',
    description: 'El agente cuelga cuando la conversación terminó.',
  },
  language_detection: {
    label: 'Detectar el idioma',
    description: 'El agente cambia al idioma de quien llama.',
  },
  skip_turn: {
    label: 'Esperar en silencio',
    description: 'El agente guarda silencio cuando le piden un momento.',
  },
  transfer_to_agent: {
    label: 'Transferir a otro agente',
    description: 'Pasa la llamada a otro agente de voz.',
  },
  transfer_to_number: {
    label: 'Transferir a un número',
    description: 'Pasa la llamada a una persona del equipo.',
  },
  dtmf: {
    label: 'Marcar tonos del teclado',
    description: 'Elige opciones en menús telefónicos automáticos.',
  },
  voicemail_detection: {
    label: 'Detectar buzón de voz',
    description: 'Reconoce cuando contesta un buzón y puede dejar un mensaje.',
  },
}

const SUGGESTED_TOOLS: Array<{ kind: SuggestedToolKind; label: string }> = [
  { kind: 'send_whatsapp_message', label: 'Enviar mensaje por WhatsApp' },
  { kind: 'schedule_appointment', label: 'Agendar citas' },
]

function resolvePublicWebhookBaseUrl(): string {
  const explicit = String(import.meta.env.VITE_PUBLIC_WEBHOOK_BASE_URL ?? '').trim()
  if (explicit) {
    return explicit.replace(/\/$/, '')
  }

  const apiUrl = String(import.meta.env.VITE_API_URL ?? '').trim()
  if (!apiUrl) {
    return ''
  }

  // ElevenLabs necesita una URL absoluta; con VITE_API_URL=/api (mismo origen) se usa el dominio actual.
  const absoluteApiUrl = new URL(apiUrl, window.location.origin).toString()
  return absoluteApiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '')
}

function buildSuggestedToolPayload(kind: SuggestedToolKind): CreateToolPayload {
  const baseUrl = resolvePublicWebhookBaseUrl()
  // El backend inyecta X-Voice-Tool-Token al guardar la herramienta: el secreto
  // nunca debe viajar en el bundle público.
  const requestHeaders = {}

  if (kind === 'send_whatsapp_message') {
    return {
      tool_config: {
        type: 'webhook',
        name: 'send_whatsapp_message',
        description: 'Pasa la conversación a una persona del equipo por WhatsApp usando la configuración global.',
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
                description: 'Número de destino en formato E.164.',
              },
              message: {
                type: 'string',
                description: 'Mensaje opcional a enviar.',
              },
              summary: {
                type: 'string',
                description: 'Resumen de la conversación para dar contexto.',
              },
              conversation_id: {
                type: 'string',
                description: 'ID de conversación (opcional).',
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
              description: 'Teléfono en formato E.164.',
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

type TransferRowsEditorProps = {
  baseId: string
  rows: Array<Record<string, unknown>>
  field: 'agent_id' | 'phone_number'
  targetLabel: string
  targetPlaceholder: string
  listId: string
  canAdd: boolean
  onChange: (rows: Array<Record<string, unknown>>) => void
}

function TransferRowsEditor({
  baseId,
  rows,
  field,
  targetLabel,
  targetPlaceholder,
  listId,
  canAdd,
  onChange,
}: TransferRowsEditorProps) {
  const emptyRow = { [field]: '', condition: '' }

  return (
    <div className="space-y-3">
      <div aria-hidden="true" className="hidden gap-2 text-xs font-medium text-text-tertiary sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <span>{targetLabel}</span>
        <span>Cuándo transferir (opcional)</span>
        <span className="w-16" />
      </div>
      <ul className="space-y-2">
        {rows.map((transfer, index) => {
          const targetId = `${baseId}-${field}-${index}`
          const conditionId = `${baseId}-condition-${index}`
          return (
            <li key={`${field}-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div>
                <label htmlFor={targetId} className="mb-1 block text-xs font-medium text-text-tertiary sm:sr-only">
                  {targetLabel}
                  <span className="sr-only"> {index + 1}</span>
                </label>
                <input
                  id={targetId}
                  type="text"
                  list={listId}
                  value={typeof transfer[field] === 'string' ? (transfer[field] as string) : ''}
                  onChange={(event) =>
                    onChange(
                      rows.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, [field]: event.target.value } : item
                      )
                    )
                  }
                  className={cn(inputClass, field === 'phone_number' && 'tabular-nums')}
                  placeholder={targetPlaceholder}
                />
              </div>
              <div>
                <label htmlFor={conditionId} className="mb-1 block text-xs font-medium text-text-tertiary sm:sr-only">
                  Cuándo transferir (opcional)
                  <span className="sr-only">, destino {index + 1}</span>
                </label>
                <input
                  id={conditionId}
                  type="text"
                  value={typeof transfer.condition === 'string' ? transfer.condition : ''}
                  onChange={(event) =>
                    onChange(
                      rows.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, condition: event.target.value } : item
                      )
                    )
                  }
                  className={inputClass}
                  placeholder="Si el cliente pide hablar con un asesor"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10.5 w-16 justify-self-start hover:bg-danger-50 hover:text-danger-700"
                aria-label={`Quitar el destino ${index + 1}`}
                onClick={() =>
                  onChange(rows.length === 1 ? [emptyRow] : rows.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                Quitar
              </Button>
            </li>
          )
        })}
      </ul>
      {canAdd && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...rows, emptyRow])}
          leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
        >
          Agregar destino
        </Button>
      )}
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
  const baseId = useId()
  const [confirm, confirmDialog] = useConfirm()
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<string | null>(null)
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
      toast.error(describeError(error, 'No pudimos eliminar la herramienta. Intente de nuevo.'))
      setDeletingToolId(null)
    },
  })

  const { mutate: createSuggestedTool, isPending: isCreatingSuggestedTool } = useMutation({
    mutationFn: (kind: SuggestedToolKind) => createTool(buildSuggestedToolPayload(kind)),
    onSuccess: (tool) => {
      onWorkspaceToolToggle(tool.id, true)
      toast.success(`Herramienta «${tool.tool_config.name}» creada y activada`)
      queryClient.invalidateQueries({ queryKey: ['workspace-tools'] })
    },
    onError: (error: Error) =>
      toast.error(describeError(error, 'No pudimos crear la herramienta. Intente de nuevo.')),
  })

  const handleDeleteTool = async (tool: WorkspaceTool) => {
    const accepted = await confirm({
      title: `¿Eliminar la herramienta «${tool.tool_config.name}»?`,
      description:
        'Se eliminará de su cuenta y dejará de estar disponible para todos los agentes que la usan. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar herramienta',
      tone: 'danger',
    })
    if (!accepted) return
    setDeletingToolId(tool.id)
    removeTool(tool.id)
  }

  const workspaceTools: WorkspaceTool[] = data?.tools ?? []

  const handleCreateSuggestedTool = (kind: SuggestedToolKind, label: string) => {
    const existing = workspaceTools.some(
      (tool) => (tool.tool_config.name || '').trim().toLowerCase() === kind
    )
    if (existing) {
      toast.info(`La herramienta «${label}» ya está creada en su cuenta.`)
      return
    }

    const baseUrl = resolvePublicWebhookBaseUrl()
    if (!baseUrl) {
      toast.error(
        'Falta configurar la dirección pública del servidor (VITE_PUBLIC_WEBHOOK_BASE_URL o VITE_API_URL).'
      )
      return
    }

    createSuggestedTool(kind)
  }

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

  const query = search.trim().toLowerCase()

  const filteredWorkspaceTools = ownedWebhookTools.filter((tool) => {
    if (!query) return true
    return (
      tool.tool_config.name.toLowerCase().includes(query) ||
      (tool.tool_config.description ?? '').toLowerCase().includes(query) ||
      (tool.tool_config.type ?? '').toLowerCase().includes(query)
    )
  })

  const filteredSystemTools = SYSTEM_TOOLS.filter((tool) => {
    if (isClient && !CLIENT_ALLOWED_SYSTEM_TOOLS.includes(tool.name)) return false
    if (!query) return true
    const copy = SYSTEM_TOOL_COPY[tool.name]
    return [tool.name, tool.label, tool.description, copy?.label ?? '', copy?.description ?? ''].some(
      (text) => text.toLowerCase().includes(query)
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

  const agentListId = `${baseId}-agent-options`
  const numberListId = `${baseId}-number-options`

  return (
    <div className="space-y-10">
      <div className="max-w-md">
        <label htmlFor={`${baseId}-search`} className="sr-only">
          Buscar herramientas
        </label>
        <div className="relative">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
          />
          <input
            id={`${baseId}-search`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
            placeholder="Buscar por nombre o descripción"
            className={cn(inputClass, 'pl-9')}
          />
        </div>
      </div>

      <section aria-labelledby={`${baseId}-system`} className="space-y-4">
        <SectionHeading
          id={`${baseId}-system`}
          title="Acciones durante la llamada"
          description="Lo que el agente puede hacer por sí mismo mientras atiende."
          action={
            <span className="text-sm text-text-secondary tabular-nums">
              {enabledSystemTools.length} {enabledSystemTools.length === 1 ? 'activa' : 'activas'}
            </span>
          }
        />

        {filteredSystemTools.length > 0 ? (
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
            {filteredSystemTools.map((tool) => {
              const isEnabled = enabledSystemTools.includes(tool.name)
              const copy = SYSTEM_TOOL_COPY[tool.name] ?? { label: tool.label, description: tool.description }
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
              const toolBaseId = `${baseId}-${tool.name}`

              return (
                <li key={tool.name} className="p-4">
                  <SwitchField
                    label={copy.label}
                    description={copy.description}
                    checked={isEnabled}
                    onChange={(value) => onSystemToolToggle(tool.name, value)}
                  />

                  {isEnabled && needsConfig && (
                    <div className="mt-4 space-y-4 rounded-lg bg-surface-muted p-4">
                      {systemToolType === 'transfer_to_agent' && (
                        <>
                          <p className="text-sm font-medium text-text-primary">Agentes de destino</p>
                          <TransferRowsEditor
                            baseId={toolBaseId}
                            rows={agentTransfers}
                            field="agent_id"
                            targetLabel="Agente de destino"
                            targetPlaceholder="Elija o pegue el identificador del agente"
                            listId={agentListId}
                            canAdd
                            onChange={(rows) => setTransferRows(tool.name, rows)}
                          />
                          <datalist id={agentListId}>
                            {transferAgentOptions.map((option) => (
                              <option key={option.agent_id} value={option.agent_id}>
                                {option.name}
                              </option>
                            ))}
                          </datalist>
                          <SwitchField
                            label="Avisar al cliente durante la transferencia"
                            checked={Boolean(params.enable_client_message)}
                            onChange={(value) =>
                              updateSystemToolParams(tool.name, (current) => ({
                                ...current,
                                enable_client_message: value,
                              }))
                            }
                          />
                        </>
                      )}

                      {systemToolType === 'transfer_to_number' && (
                        <>
                          {isClient && (
                            <p className="rounded-lg border border-info-200 bg-info-50 px-3 py-2.5 text-sm leading-relaxed text-info-700">
                              Los destinos se sincronizan desde el{' '}
                              <Link to="/directorio" className="font-medium underline underline-offset-2">
                                Directorio de asesores
                              </Link>
                              . Para cambiarlos, actualice allí sus contactos.
                            </p>
                          )}
                          <div>
                            <p className="text-sm font-medium text-text-primary">Destinos de transferencia</p>
                            <p className="mt-0.5 text-xs text-text-tertiary">
                              Con el indicativo del país, por ejemplo +573001234567.
                            </p>
                          </div>
                          <TransferRowsEditor
                            baseId={toolBaseId}
                            rows={numberTransfers}
                            field="phone_number"
                            targetLabel="Número de destino"
                            targetPlaceholder="+573001234567"
                            listId={numberListId}
                            canAdd={!isClient}
                            onChange={(rows) => setTransferRows(tool.name, rows)}
                          />
                          <datalist id={numberListId}>
                            {transferNumberOptions.map((option) => (
                              <option key={option.phone_number_id} value={option.phone_number}>
                                {option.label}
                              </option>
                            ))}
                          </datalist>
                          <SwitchField
                            label="Avisar al cliente durante la transferencia"
                            checked={Boolean(params.enable_client_message)}
                            onChange={(value) =>
                              updateSystemToolParams(tool.name, (current) => ({
                                ...current,
                                enable_client_message: value,
                              }))
                            }
                          />
                        </>
                      )}

                      {systemToolType === 'play_keypad_touch_tone' && (
                        <>
                          <SwitchField
                            label="Enviar los tonos por fuera del audio"
                            description="Método RFC 4733, compatible con la mayoría de centrales telefónicas."
                            checked={Boolean(params.use_out_of_band_dtmf)}
                            onChange={(value) =>
                              updateSystemToolParams(tool.name, (current) => ({
                                ...current,
                                use_out_of_band_dtmf: value,
                              }))
                            }
                          />
                          <SwitchField
                            label="No hablar después de marcar"
                            checked={Boolean(params.suppress_turn_after_dtmf)}
                            onChange={(value) =>
                              updateSystemToolParams(tool.name, (current) => ({
                                ...current,
                                suppress_turn_after_dtmf: value,
                              }))
                            }
                          />
                        </>
                      )}

                      {systemToolType === 'voicemail_detection' && (
                        <Field label="Mensaje para dejar en el buzón (opcional)">
                          {(control) => (
                            <textarea
                              {...control}
                              rows={3}
                              value={typeof params.voicemail_message === 'string' ? params.voicemail_message : ''}
                              onChange={(event) =>
                                updateSystemToolParams(tool.name, (current) => ({
                                  ...current,
                                  voicemail_message: event.target.value,
                                }))
                              }
                              className={textareaClass}
                              placeholder="Hola, intentamos comunicarnos con usted. Puede devolvernos la llamada cuando le sea posible."
                            />
                          )}
                        </Field>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">Ninguna acción coincide con la búsqueda.</p>
        )}
      </section>

      {!isClient && (
        <section aria-labelledby={`${baseId}-connected`} className="space-y-4 border-t border-border-default pt-8">
          <SectionHeading
            id={`${baseId}-connected`}
            title="Herramientas conectadas"
            description="Conexiones con sistemas externos que el agente puede usar, como agendar citas o enviar mensajes. Los cambios se aplican al guardar."
            action={
              <>
                <span className="text-sm text-text-secondary tabular-nums">
                  {attachedOwnedWebhookCount} en uso
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateModal(true)}
                  leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
                >
                  Nueva herramienta
                </Button>
              </>
            }
          />

          <div className="flex flex-col gap-3 rounded-lg bg-surface-muted px-4 py-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-text-secondary">
              Cree y active en un paso las conexiones que ya ofrece la plataforma.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_TOOLS.map((suggestion) => (
                <Button
                  key={suggestion.kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isCreatingSuggestedTool}
                  onClick={() => handleCreateSuggestedTool(suggestion.kind, suggestion.label)}
                >
                  {suggestion.label}
                </Button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <p role="status" className="flex items-center gap-2.5 py-6 text-sm text-text-secondary">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent"
              />
              Cargando herramientas…
            </p>
          ) : filteredWorkspaceTools.length > 0 ? (
            <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
              {filteredWorkspaceTools.map((tool) => {
                const isAttached = selectedToolIds.includes(tool.id)
                const isExpanded = expandedWorkspaceId === tool.id
                const hasApiSchema = !!tool.tool_config.api_schema
                const detailsId = `${baseId}-details-${tool.id}`
                const toolName = tool.tool_config.name

                return (
                  <li key={tool.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-all font-mono text-sm font-medium text-text-primary">{toolName}</p>
                          {isAttached && (
                            <Badge variant="success" size="sm">
                              En uso
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-text-secondary">
                          {tool.tool_config.description || 'Sin descripción'}
                        </p>
                        {tool.access_info?.creator_email && (
                          <p className="mt-0.5 text-xs text-text-tertiary">
                            Creada por {tool.access_info.creator_email}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Switch
                          checked={isAttached}
                          onChange={(value) => onWorkspaceToolToggle(tool.id, value)}
                          label={`Usar ${toolName} en este agente`}
                        />
                        <button
                          type="button"
                          disabled={deletingToolId === tool.id}
                          onClick={() => handleDeleteTool(tool)}
                          aria-label={`Eliminar ${toolName}`}
                          className="ml-1 rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50"
                        >
                          <TrashIcon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {hasApiSchema && (
                      <div className="mt-2">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          onClick={() =>
                            setExpandedWorkspaceId((current) => (current === tool.id ? null : tool.id))
                          }
                          className="inline-flex items-center gap-1 rounded-md py-1 text-xs font-medium text-primary-700 hover:underline"
                        >
                          Detalles técnicos
                          <ChevronDownIcon
                            aria-hidden="true"
                            className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')}
                          />
                        </button>
                        {isExpanded && (
                          <div id={detailsId} className="mt-2 space-y-2">
                            {tool.tool_config.api_schema?.url && (
                              <p className="break-all font-mono text-xs text-text-secondary">
                                {tool.tool_config.api_schema.method ?? 'GET'} {tool.tool_config.api_schema.url}
                              </p>
                            )}
                            <pre className="max-h-72 overflow-auto rounded-lg border border-border-default bg-surface-muted p-3 font-mono text-xs text-text-secondary">
                              {JSON.stringify(tool.tool_config.api_schema, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border-strong px-6 py-8 text-center text-sm text-text-secondary">
              {query
                ? 'Ninguna herramienta coincide con la búsqueda.'
                : 'Aún no hay herramientas conectadas. Use «Nueva herramienta» o uno de los atajos de arriba.'}
            </p>
          )}
        </section>
      )}

      {(!isClient || embeddedTools.length > 0) && (
        <section aria-labelledby={`${baseId}-embedded`} className="space-y-4 border-t border-border-default pt-8">
          <SectionHeading
            id={`${baseId}-embedded`}
            title="Herramientas incluidas en el agente"
            description="Vienen dentro de la configuración del agente. Se conservan al guardar, pero no se editan desde aquí."
          />

          {embeddedTools.length > 0 ? (
            <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
              {embeddedTools.map((tool: Record<string, unknown>, index) => {
                const embeddedId = `${String(tool.name ?? 'embedded')}-${index}`
                const isExpanded = expandedEmbeddedId === embeddedId
                const detailsId = `${baseId}-embedded-${index}`

                return (
                  <li key={embeddedId} className="p-4">
                    <p className="break-all font-mono text-sm font-medium text-text-primary">
                      {String(tool.name ?? `herramienta_${index + 1}`)}
                    </p>
                    {'description' in tool && typeof tool.description === 'string' && tool.description && (
                      <p className="mt-1 text-sm text-text-secondary">{tool.description}</p>
                    )}
                    {!isClient && (
                      <div className="mt-2">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          onClick={() =>
                            setExpandedEmbeddedId((current) => (current === embeddedId ? null : embeddedId))
                          }
                          className="inline-flex items-center gap-1 rounded-md py-1 text-xs font-medium text-primary-700 hover:underline"
                        >
                          Ver configuración
                          <ChevronDownIcon
                            aria-hidden="true"
                            className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')}
                          />
                        </button>
                        {isExpanded && (
                          <pre
                            id={detailsId}
                            className="mt-2 max-h-72 overflow-auto rounded-lg border border-border-default bg-surface-muted p-3 font-mono text-xs text-text-secondary"
                          >
                            {JSON.stringify(tool, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-text-secondary">Este agente no trae herramientas incluidas.</p>
          )}
        </section>
      )}

      {showCreateModal && !isClient && (
        <CreateToolModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['workspace-tools'] })}
        />
      )}

      {confirmDialog}
    </div>
  )
}

