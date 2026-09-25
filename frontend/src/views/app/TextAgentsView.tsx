import { useCallback, useId, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form'
import { toast } from 'react-toastify'
import { ChevronRightIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
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
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import AdvancedSection from '@/components/ui/AdvancedSection'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { getTemplateCopy } from '@/components/app/text-agent/copy'

type CreateForm = {
  name: string
  provider: TextProvider
  template_key: TextAgentTemplateKey
}

const DEFAULT_VALUES: CreateForm = {
  provider: 'openai',
  name: '',
  template_key: 'sofia',
}

const inputClass =
  'h-11 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus:border-primary-600'

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function TemplateOption({
  template,
  registration,
  selected,
}: {
  template: TextAgentTemplate
  registration: UseFormRegisterReturn<'template_key'>
  selected: boolean
}) {
  const copy = getTemplateCopy(template.key, { label: template.label, summary: template.summary })
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-border-focus ${
        selected
          ? 'border-primary-600 bg-primary-50'
          : 'border-border-default bg-surface hover:border-primary-300 hover:bg-surface-muted'
      }`}
    >
      <input id={id} type="radio" value={template.key} className="sr-only" {...registration} />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-primary-600' : 'border-border-strong'
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-primary-600" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-text-primary">{copy.label}</span>
          {template.recommended && (
            <Badge variant="primary" size="sm">
              Recomendada
            </Badge>
          )}
        </span>
        <span className="mt-1 block text-sm leading-relaxed text-text-secondary">{copy.summary}</span>
      </span>
    </label>
  )
}

export default function TextAgentsView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { isSuperAdmin } = useCurrentUser()
  const [confirm, confirmDialog] = useConfirm()
  const nameId = useId()
  const providerId = useId()
  const nameErrorId = useId()

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
  const templates: TextAgentTemplate[] = useMemo(
    () => [...(templatesData?.templates ?? [])].sort((a, b) => Number(b.recommended) - Number(a.recommended)),
    [templatesData],
  )
  const clientAgentLimit = templatesData?.client_agent_limit ?? 3
  const canCreate = isSuperAdmin || agents.length < clientAgentLimit

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CreateForm>({ defaultValues: DEFAULT_VALUES })

  const selectedTemplateKey = useWatch({ control, name: 'template_key' }) ?? 'sofia'
  const templateRegistration = register('template_key', { required: 'Elija una plantilla' })

  const closeModal = useCallback(() => {
    setShowModal(false)
    reset(DEFAULT_VALUES)
  }, [reset])

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

  const handleDelete = async (agent: TextAgentSummary) => {
    const accepted = await confirm({
      title: `¿Eliminar «${agent.name}»?`,
      description:
        'Se borrarán su configuración, las conversaciones, las citas y la conexión con WhatsApp. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar agente',
      tone: 'danger',
    })
    if (!accepted) return
    setDeletingId(agent.agent_id)
    remove(agent.agent_id)
  }

  const headerActions = (
    <>
      {!isSuperAdmin && (
        <span className="text-sm tabular-nums text-text-secondary">
          {agents.length} de {clientAgentLimit} agentes
        </span>
      )}
      {canCreate && (
        <Button leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />} onClick={() => setShowModal(true)}>
          Nuevo agente de texto
        </Button>
      )}
    </>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <PageHeader
          title="Agentes de texto"
          description="Asistentes que atienden por chat en su sitio web y por WhatsApp. Cree uno a partir de una plantilla y ajústelo cuando quiera."
          actions={headerActions}
        />

        {(scopedUserId || (!canCreate && !isSuperAdmin)) && (
          <p className="mb-4 text-sm text-text-secondary">
            {scopedUserId
              ? 'Está viendo solo los agentes de un usuario.'
              : `Ya usa los ${clientAgentLimit} agentes disponibles en su cuenta. Elimine uno para crear otro.`}
          </p>
        )}

        <section
          aria-label="Listado de agentes de texto"
          className="section-enter overflow-hidden rounded-xl border border-border-default bg-surface"
        >
          {isLoading ? (
            <div className="space-y-3 p-5" aria-label="Cargando agentes de texto">
              <div className="skeleton h-5 w-1/3" />
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton mt-6 h-5 w-1/4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          ) : isError ? (
            <p className="px-6 py-12 text-center text-sm text-text-secondary">
              No pudimos cargar los agentes. Recargue la página o intente de nuevo en unos minutos.
            </p>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <p className="text-base font-semibold text-text-primary">Aún no tiene agentes de texto</p>
              <p className="max-w-md text-sm text-text-secondary">
                Empiece con una plantilla: el agente queda listo para atender y luego puede
                ajustar sus canales y documentos.
              </p>
              {canCreate && (
                <Button variant="secondary" className="mt-2" onClick={() => setShowModal(true)}>
                  Crear el primer agente
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {agents.map((agent) => {
                const copy = getTemplateCopy(agent.template_key, {
                  label: agent.template_label,
                  summary: agent.template_summary,
                })
                return (
                  <li
                    key={agent.agent_id}
                    onClick={() => navigate(`/agentes_texto/${agent.agent_id}`)}
                    className="group flex cursor-pointer items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-muted sm:px-6"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Link
                          to={`/agentes_texto/${agent.agent_id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="truncate text-sm font-semibold text-text-primary hover:text-primary-700 group-hover:text-primary-700"
                        >
                          {agent.name}
                        </Link>
                        <Badge size="sm">{copy.label}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-text-secondary sm:line-clamp-1">
                        {copy.summary}
                      </p>
                      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-tertiary">
                        <span>Actualizado el {formatDate(agent.updated_at_unix_secs)}</span>
                        {isSuperAdmin && agent.owner_email && <span>{agent.owner_email}</span>}
                        {isSuperAdmin && (
                          <span>
                            {TEXT_PROVIDER_OPTIONS.find((option) => option.value === agent.provider)?.label ??
                              agent.provider}
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleDelete(agent)
                        }}
                        disabled={deletingId === agent.agent_id}
                        aria-label={`Eliminar ${agent.name}`}
                        title="Eliminar"
                        className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50"
                      >
                        <TrashIcon className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="hidden h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5 sm:block"
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        title="Nuevo agente de texto"
        description="Elija una plantilla y póngale un nombre. Podrá ajustar todo después."
        size="lg"
        footer={
          <>
            <Button variant="ghost" type="button" onClick={closeModal}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="create-text-agent-form"
              isLoading={isCreating}
              disabled={loadingTemplates || templatesError}
            >
              Crear agente
            </Button>
          </>
        }
      >
        <form
          id="create-text-agent-form"
          onSubmit={handleSubmit((values) => create(values))}
          className="space-y-6"
          noValidate
        >
          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-text-primary">Plantilla</legend>
            {loadingTemplates ? (
              <div className="space-y-2" aria-label="Cargando plantillas">
                <div className="skeleton h-16" />
                <div className="skeleton h-16" />
                <div className="skeleton h-16" />
              </div>
            ) : templatesError ? (
              <p className="text-sm text-danger-700">
                No pudimos cargar las plantillas. Cierre esta ventana e intente de nuevo.
              </p>
            ) : (
              <div className="space-y-2">
                {templates.map((template) => (
                  <TemplateOption
                    key={template.key}
                    template={template}
                    registration={templateRegistration}
                    selected={selectedTemplateKey === template.key}
                  />
                ))}
              </div>
            )}
            {errors.template_key && (
              <p className="mt-2 text-sm text-danger-700">{errors.template_key.message}</p>
            )}
          </fieldset>

          <div>
            <label htmlFor={nameId} className="mb-1.5 block text-sm font-medium text-text-primary">
              Nombre del agente
            </label>
            <input
              id={nameId}
              type="text"
              placeholder="Ej: Agente comercial principal"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? nameErrorId : undefined}
              className={inputClass}
              {...register('name', {
                required: 'Escriba un nombre para el agente',
                validate: (value) => value.trim().length > 0 || 'Escriba un nombre para el agente',
              })}
            />
            {errors.name && (
              <p id={nameErrorId} className="mt-1.5 text-sm text-danger-700">
                {errors.name.message}
              </p>
            )}
          </div>

          <AdvancedSection
            key={isSuperAdmin ? 'admin' : 'client'}
            defaultOpen={isSuperAdmin}
            description="Motor de inteligencia artificial del agente. Normalmente no necesita cambiarlo."
          >
            <div>
              <label htmlFor={providerId} className="mb-1.5 block text-sm font-medium text-text-primary">
                Proveedor de IA
              </label>
              <select id={providerId} className={inputClass} {...register('provider')}>
                {TEXT_PROVIDER_OPTIONS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-text-tertiary">
                El modelo se elige automáticamente según el proveedor y la plantilla.
              </p>
            </div>
          </AdvancedSection>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  )
}
