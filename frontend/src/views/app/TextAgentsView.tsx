import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'react-toastify'
import {
  ChatBubbleLeftRightIcon,
  PencilSquareIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  createTextAgent,
  deleteTextAgent,
  getTextAgents,
  listTextAgentTemplates,
} from '@/api/TextAgentsAPI'
import {
  TEXT_PROVIDER_OPTIONS,
  type TextAgentSummary,
  type TextAgentTemplate,
  type TextAgentTemplateKey,
  type TextProvider,
} from '@/types/textAgent'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type CreateForm = {
  name: string
  provider: TextProvider
  template_key: TextAgentTemplateKey
}

const TEMPLATE_ACCENTS: Record<
  TextAgentTemplateKey,
  {
    surface: string
    border: string
    chip: string
    dot: string
  }
> = {
  sofia: {
    surface: 'bg-[#f7f2ff]',
    border: 'border-[#d9c9ff]',
    chip: 'bg-[#ece1ff] text-[#4b1fb8]',
    dot: 'bg-[#6d3ef3]',
  },
  recepcionista: {
    surface: 'bg-[#eefaf4]',
    border: 'border-[#c8ead8]',
    chip: 'bg-[#dcf4e6] text-[#15603c]',
    dot: 'bg-[#23a66a]',
  },
  faq_bot: {
    surface: 'bg-[#fff8ec]',
    border: 'border-[#f3deb7]',
    chip: 'bg-[#ffefcf] text-[#8f5a00]',
    dot: 'bg-[#f0a229]',
  },
  custom: {
    surface: 'bg-[#eef4ff]',
    border: 'border-[#cfe0ff]',
    chip: 'bg-[#dde9ff] text-[#2058b8]',
    dot: 'bg-[#3d7cff]',
  },
}

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getTemplateAccent(templateKey: TextAgentTemplateKey) {
  return TEMPLATE_ACCENTS[templateKey] ?? TEMPLATE_ACCENTS.sofia
}

export default function TextAgentsView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { isSuperAdmin } = useCurrentUser()

  const scopedUserId = searchParams.get('user_id') || undefined

  const { data, isLoading, isError } = useQuery({
    queryKey: ['text-agents', scopedUserId ?? 'all'],
    queryFn: () => getTextAgents({ userId: scopedUserId }),
  })

  const { data: templatesData, isLoading: loadingTemplates, isError: templatesError } = useQuery({
    queryKey: ['text-agent-templates'],
    queryFn: listTextAgentTemplates,
  })

  const agents: TextAgentSummary[] = data?.agents ?? []
  const templates: TextAgentTemplate[] = templatesData?.templates ?? []
  const clientAgentLimit = templatesData?.client_agent_limit ?? 3
  const canCreate = isSuperAdmin || agents.length < clientAgentLimit

  const defaultValues = useMemo<CreateForm>(
    () => ({
      provider: 'openai',
      name: '',
      template_key: 'sofia',
    }),
    [],
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
    mutationFn: (values: CreateForm) => createTextAgent(values),
    onSuccess: (newAgent) => {
      toast.success('Agente de texto creado')
      queryClient.invalidateQueries({ queryKey: ['text-agents'] })
      closeModal()
      navigate(`/agentes_texto/${newAgent.agent_id}`, {
        state: {
          openOnboarding: Boolean(newAgent.template_capabilities?.launches_onboarding),
        },
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: remove } = useMutation({
    mutationFn: deleteTextAgent,
    onSuccess: () => {
      toast.success('Agente eliminado')
      queryClient.invalidateQueries({ queryKey: ['text-agents'] })
      setDeletingId(null)
    },
    onError: (error: Error) => {
      toast.error(error.message)
      setDeletingId(null)
    },
  })

  const handleDelete = (agentId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (confirm('Eliminar este agente de texto?')) {
      setDeletingId(agentId)
      remove(agentId)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full p-8">
        <section className="section-enter mb-8 overflow-hidden rounded-[28px] border border-[#e4e0f5] bg-white px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#271173]">
                Workspace
              </p>
              <h1 className="mt-2 text-3xl font-bold text-black">Agentes de Texto</h1>
              <p className="mt-2 max-w-2xl text-sm text-black/60">
                Crea agentes de texto desde plantillas listas para negocio o arma uno custom con
                OpenAI o Gemini.
              </p>
            </div>

            <div className="flex flex-col items-start gap-2 sm:items-end">
              {!isSuperAdmin && (
                <div className="rounded-full border border-[#e0d5ff] bg-[#f6f1ff] px-3 py-1 text-xs font-semibold text-[#4b1fb8]">
                  {agents.length} / {clientAgentLimit} agentes usados
                </div>
              )}
              {canCreate && (
                <button
                  onClick={() => setShowModal(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a]"
                >
                  <PlusIcon className="h-4 w-4" />
                  Nuevo agente de texto
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
                ? 'Vista filtrada por usuario para supervision del super admin.'
                : 'Cada agente conserva su plantilla para ajustar tabs, permisos y onboarding.'}
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
                Cargando agentes de texto...
              </div>
            </div>
          ) : isError ? (
            <div className="flex h-48 items-center justify-center px-6 text-center text-text-secondary">
              Error al cargar agentes de texto. Verifica tu sesion e intenta nuevamente.
            </div>
          ) : agents.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50">
                <ChatBubbleLeftRightIcon className="h-6 w-6 text-primary-600" />
              </div>
              <p className="max-w-md text-sm text-text-secondary">
                Todavia no tienes agentes de texto. Empieza con una plantilla y luego ajusta los
                canales y el conocimiento segun tu negocio.
              </p>
              {canCreate && (
                <button
                  onClick={() => setShowModal(true)}
                  className="text-sm font-medium text-primary-600 transition-colors hover:text-primary-700"
                >
                  Crear tu primer agente
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
                    Provider
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    Propietario
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    Actualizado
                  </th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {agents.map((agent) => {
                  const accent = getTemplateAccent(agent.template_key)
                  return (
                    <tr
                      key={agent.agent_id}
                      onClick={() => navigate(`/agentes_texto/${agent.agent_id}`)}
                      className="group cursor-pointer transition-all duration-150 hover:bg-primary-50/60"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 ring-1 ring-primary-100">
                            <ChatBubbleLeftRightIcon className="h-4 w-4 text-primary-600" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-text-primary transition-colors group-hover:text-primary-700">
                                {agent.name}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${accent.surface} ${accent.border} ${accent.chip}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
                                {agent.template_label}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-xs text-text-tertiary">
                              {agent.template_summary}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">{agent.provider}</td>
                      <td className="px-6 py-4 text-sm text-text-secondary">{agent.owner_email ?? '-'}</td>
                      <td className="px-6 py-4 text-sm text-text-secondary">
                        {formatDate(agent.updated_at_unix_secs)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              navigate(`/agentes_texto/${agent.agent_id}`)
                            }}
                            className="rounded-lg p-2 text-text-tertiary transition-all duration-200 hover:bg-primary-50 hover:text-primary-700"
                            title="Editar"
                          >
                            <PencilSquareIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(event) => handleDelete(agent.agent_id, event)}
                            disabled={deletingId === agent.agent_id}
                            className="rounded-lg p-2 text-text-tertiary transition-all duration-200 hover:bg-danger-50 hover:text-danger-600 disabled:opacity-50"
                            title="Eliminar"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
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
                      Crear agente
                    </p>
                    <h2 className="mt-2 text-2xl font-bold text-text-primary">Elige una plantilla</h2>
                    <p className="mt-2 max-w-2xl text-sm text-text-secondary">
                      Cada plantilla define el comportamiento inicial del agente y tambien que
                      opciones veras despues en la configuracion.
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
              <form onSubmit={handleSubmit((values) => create(values))} className="grid gap-0 lg:grid-cols-[1.55fr_0.95fr]">
                <div className="border-b border-border-default p-6 lg:border-b-0 lg:border-r border-r-border-default">
                  <input
                    type="hidden"
                    {...register('template_key', { required: 'Selecciona una plantilla' })}
                  />

                  {loadingTemplates ? (
                    <div className="flex min-h-[260px] items-center justify-center text-sm text-text-tertiary">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                        Cargando plantillas...
                      </div>
                    </div>
                  ) : templatesError ? (
                    <div className="rounded-3xl border border-danger-200 bg-danger-50 px-5 py-4 text-sm text-danger-700">
                      No fue posible cargar las plantillas de agentes. Cierra el modal e intenta de nuevo.
                    </div>
                  ) : (
                    <div className="space-y-4">
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
                                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                                    {template.summary}
                                  </p>
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

                              <div className="mt-4 text-xs text-text-tertiary">
                                {template.description}
                              </div>
                            </button>
                          )
                        })}
                      </div>

                      {errors.template_key && (
                        <p className="text-xs text-danger-600">{errors.template_key.message}</p>
                      )}
                    </div>
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
                      <label className="mb-1.5 block text-sm font-medium text-text-primary">Nombre</label>
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

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-text-primary">Proveedor</label>
                      <select
                        className="w-full rounded-xl border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary transition-all duration-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none"
                        {...register('provider')}
                      >
                        {TEXT_PROVIDER_OPTIONS.map((provider) => (
                          <option key={provider.value} value={provider.value}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-text-tertiary">
                        El modelo inicial se ajusta automaticamente segun el proveedor y la plantilla.
                      </p>
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
