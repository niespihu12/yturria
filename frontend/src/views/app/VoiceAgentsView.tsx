import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { useForm, useWatch } from 'react-hook-form'
import {
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  PencilSquareIcon,
  PhoneIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { createAgent, deleteAgent, getAgents } from '@/api/VoiceRuntimeAPI'
import { listTextAgentTemplates } from '@/api/TextAgentsAPI'
import type { AgentListItem } from '@/types/agent'
import type { TextAgentTemplate, TextAgentTemplateKey } from '@/types/textAgent'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type CreateForm = {
  name: string
  template_key: TextAgentTemplateKey
}

const TEMPLATE_ACCENTS: Record<
  TextAgentTemplateKey,
  {
    surface: string
    border: string
    chip: string
    dot: string
    gradient: string
  }
> = {
  sofia: {
    surface: 'bg-primary-50',
    border: 'border-primary-200',
    chip: 'bg-primary-100 text-primary-700',
    dot: 'bg-primary-500',
    gradient: 'from-primary-500/10 to-primary-600/5',
  },
  recepcionista: {
    surface: 'bg-accent-50',
    border: 'border-accent-200',
    chip: 'bg-accent-100 text-accent-700',
    dot: 'bg-accent-500',
    gradient: 'from-accent-500/10 to-accent-600/5',
  },
  faq_bot: {
    surface: 'bg-warning-50',
    border: 'border-warning-200',
    chip: 'bg-warning-100 text-warning-700',
    dot: 'bg-warning-500',
    gradient: 'from-warning-500/10 to-warning-600/5',
  },
  custom: {
    surface: 'bg-info-50',
    border: 'border-info-200',
    chip: 'bg-info-100 text-info-700',
    dot: 'bg-info-500',
    gradient: 'from-info-500/10 to-info-600/5',
  },
}

function getTemplateAccent(templateKey: TextAgentTemplateKey) {
  return TEMPLATE_ACCENTS[templateKey] ?? TEMPLATE_ACCENTS.sofia
}

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function VoiceAgentsView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { isSuperAdmin } = useCurrentUser()

  const scopedUserId = searchParams.get('user_id') || undefined

  const { data, isLoading, isError } = useQuery({
    queryKey: ['agents', scopedUserId ?? 'all'],
    queryFn: () => getAgents({ userId: scopedUserId }),
  })

  const {
    data: templatesData,
    isLoading: loadingTemplates,
    isError: templatesError,
  } = useQuery({
    queryKey: ['text-agent-templates'],
    queryFn: listTextAgentTemplates,
  })

  const agents: AgentListItem[] = data?.agents ?? []
  const templates: TextAgentTemplate[] = templatesData?.templates ?? []
  const clientAgentLimit = templatesData?.client_agent_limit ?? 3
  const canCreate = isSuperAdmin || agents.length < clientAgentLimit

  const defaultValues = useMemo<CreateForm>(
    () => ({
      name: '',
      template_key: 'sofia',
    }),
    []
  )

  const {
    register,
    handleSubmit,
    control,
    setValue,
    reset,
    formState: { errors },
  } = useForm<CreateForm>({ defaultValues })

  const selectedTemplateKey = useWatch({ control, name: 'template_key' }) ?? 'sofia'
  const selectedTemplate =
    templates.find((template) => template.key === selectedTemplateKey) ?? templates[0] ?? null

  const closeModal = () => {
    setShowModal(false)
    reset(defaultValues)
  }

  const { mutate: create, isPending: isCreating } = useMutation({
    mutationFn: (values: CreateForm) =>
      createAgent({
        name: values.name,
        template_key: values.template_key,
        conversation_config: {
          agent: {
            prompt: {
              prompt: '',
              llm: 'gemini-2.5-flash',
            },
            first_message: 'Hola, en que puedo ayudarte?',
            language: 'es',
          },
        },
      }),
    onSuccess: (newAgent) => {
      toast.success('Agente creado')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      closeModal()
      navigate(`/agentes_voz/${newAgent.agent_id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: remove } = useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => {
      toast.success('Agente eliminado')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setDeletingId(null)
    },
    onError: (error: Error) => {
      toast.error(error.message)
      setDeletingId(null)
    },
  })

  const handleDelete = (agentId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (confirm('Eliminar este agente?')) {
      setDeletingId(agentId)
      remove(agentId)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="w-full p-8">
      <section className="section-enter mb-8 overflow-hidden rounded-3xl border border-border-default bg-surface px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-600">
              Workspace
            </p>
            <h1 className="mt-2 text-3xl font-bold text-text-primary">Agentes de Voz</h1>
            <p className="mt-2 max-w-2xl text-sm text-text-secondary">
              Entra directo al detalle del agente para editar prompt, knowledge base, herramientas
              y pruebas de llamada desde un solo lugar.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            {!isSuperAdmin && (
              <div className="rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
                {agents.length} / {clientAgentLimit} agentes usados
              </div>
            )}
            {canCreate && (
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-primary-700 hover:-translate-y-px shadow-sm"
              >
                <PlusIcon className="w-4 h-4" />
                Nuevo agente
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Listado</h2>
          <p className="mt-1 text-sm text-text-secondary">
            {scopedUserId
              ? 'Vista filtrada por usuario para revision administrativa.'
              : 'La consola ahora abre por defecto en esta seccion justo despues del login.'}
          </p>
        </div>
        {!canCreate && !isSuperAdmin && (
          <p className="text-sm font-medium text-text-tertiary">
            Ya alcanzaste el limite de {clientAgentLimit} agentes para esta cuenta.
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-3xl border border-border-default bg-surface shadow-sm">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">
            <div className="flex items-center gap-2.5">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
              Cargando agentes...
            </div>
          </div>
        ) : isError ? (
          <div className="flex h-48 items-center justify-center px-6 text-center text-text-secondary">
            Error al cargar agentes. Revisa la configuracion de la plataforma y vuelve a intentar.
          </div>
        ) : agents.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50">
              <PhoneIcon className="h-6 w-6 text-primary-600" />
            </div>
            <p className="text-sm text-text-secondary">No hay agentes todavia</p>
            {canCreate && (
              <button
                onClick={() => setShowModal(true)}
                className="text-sm font-medium text-primary-600 transition-colors hover:text-primary-700"
              >
                Crea tu primer agente
              </button>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-default bg-bg-secondary/50">
                <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Nombre
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Creado por
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Creado en
                </th>
                <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {agents.map((agent) => (
                <tr
                  key={agent.agent_id}
                  onClick={() => navigate(`/agentes_voz/${agent.agent_id}`)}
                  className="group cursor-pointer transition-all duration-150 hover:bg-primary-50/60"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 ring-1 ring-primary-100">
                        <PhoneIcon className="h-4 w-4 text-primary-600" />
                      </div>
                      <span className="text-sm font-semibold text-text-primary transition-colors group-hover:text-primary-700">
                        {agent.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-text-secondary">
                    {agent.access_info?.creator_email ?? '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-text-secondary">
                    {agent.created_at_unix_secs ? formatDate(agent.created_at_unix_secs) : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          navigate(`/agentes_voz/${agent.agent_id}`)
                        }}
                        className="rounded-lg p-2 text-text-tertiary transition-all duration-200 hover:bg-primary-50 hover:text-primary-700"
                        title="Editar"
                      >
                        <PencilSquareIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(event) => handleDelete(agent.agent_id, event)}
                        disabled={deletingId === agent.agent_id}
                        className="rounded-lg p-2 text-text-tertiary transition-all duration-200 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50"
                        title="Eliminar"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-overlay p-4 backdrop-blur-md">
          <div className="modal-content flex flex-col w-full max-w-5xl max-h-[90vh] rounded-3xl border border-border-default bg-surface shadow-2xl">
            <div className="border-b border-border-default bg-gradient-to-br from-primary-50 via-surface to-bg-secondary px-6 py-5 shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary-700">
                    Crear agente de voz
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-text-primary">Elige una plantilla</h2>
                  <p className="mt-2 max-w-2xl text-sm text-text-secondary">
                    Al crear el agente, la plantilla define el prompt inicial, mensaje de bienvenida
                    y contexto operativo.
                  </p>
                </div>

                <button
                  onClick={closeModal}
                  className="rounded-xl p-2 text-text-muted transition-all duration-200 hover:bg-neutral-100 hover:text-text-primary"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 rounded-b-3xl">
            <form
              onSubmit={handleSubmit((values) => create(values))}
              className="grid gap-0 lg:grid-cols-[1.55fr_0.95fr]"
            >
              <div className="border-b border-border-default p-6 lg:border-b-0 lg:border-r border-r-border-default">
                <input
                  type="hidden"
                  {...register('template_key', { required: 'Selecciona una plantilla' })}
                />

                {loadingTemplates ? (
                  <div className="flex min-h-60 items-center justify-center text-sm text-text-tertiary">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                      Cargando plantillas...
                    </div>
                  </div>
                ) : templatesError ? (
                  <div className="rounded-3xl border border-danger-200 bg-danger-50 px-5 py-4 text-sm text-danger-700">
                    No fue posible cargar plantillas. Cierra el modal e intenta de nuevo.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {templates.map((template) => {
                      const isSelected = selectedTemplateKey === template.key
                      const accent = getTemplateAccent(template.key)
                      return (
                        <button
                          key={template.key}
                          type="button"
                          onClick={() =>
                            setValue('template_key', template.key, {
                              shouldDirty: true,
                              shouldTouch: true,
                              shouldValidate: true,
                            })}
                          className={`group rounded-2xl border p-5 text-left transition-all duration-200 ${
                            isSelected
                              ? `${accent.border} ${accent.surface} shadow-lg ring-1 ring-inset ring-primary-200`
                              : 'border-border-default bg-surface hover:border-primary-300 hover:bg-primary-50/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${accent.dot}`} />
                                <h3 className="text-base font-semibold text-text-primary">{template.label}</h3>
                              </div>
                              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{template.summary}</p>
                            </div>

                            {template.recommended && (
                              <span className="shrink-0 rounded-full bg-primary-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white shadow-sm">
                                recomendado
                              </span>
                            )}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {template.highlights.map((highlight) => (
                              <span
                                key={highlight}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${accent.chip}`}
                              >
                                {highlight}
                              </span>
                            ))}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {errors.template_key && (
                  <p className="mt-3 text-xs text-danger-600">{errors.template_key.message}</p>
                )}
              </div>

              <div className="flex flex-col justify-between bg-bg-secondary p-6">
                <div className="space-y-5">
                  <div className="rounded-2xl border border-border-default bg-surface p-5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <SparklesIcon className="h-4 w-4 text-primary-600" />
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-700">
                        Seleccion actual
                      </p>
                    </div>

                    {selectedTemplate ? (
                      <div className="mt-3 space-y-3">
                        <div>
                          <h3 className="text-lg font-semibold text-text-primary">{selectedTemplate.label}</h3>
                          <p className="mt-1 text-sm text-text-secondary">{selectedTemplate.description}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedTemplate.highlights.map((highlight) => (
                            <span
                              key={highlight}
                              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${getTemplateAccent(selectedTemplate.key).chip}`}
                            >
                              {highlight}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-text-tertiary">
                        Elige una plantilla para ver su enfoque antes de crear el agente.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-text-primary">
                      Nombre del agente
                    </label>
                    <input
                      type="text"
                      placeholder="Ej: Agente comercial principal"
                      className="w-full rounded-xl border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-all duration-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
                      {...register('name', { required: 'El nombre es requerido' })}
                    />
                    {errors.name && (
                      <p className="mt-1 text-xs text-danger-600">{errors.name.message}</p>
                    )}
                  </div>
                </div>

                <div className="mt-8 flex gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 rounded-xl bg-neutral-100 px-4 py-2.5 text-sm font-medium text-text-secondary transition-all duration-200 hover:bg-neutral-200 hover:text-text-primary"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating || loadingTemplates || templatesError}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-primary-700 hover:-translate-y-px shadow-sm disabled:opacity-60 disabled:hover:translate-y-0"
                  >
                    {isCreating && (
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    )}
                    Crear agente
                  </button>
                </div>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}


