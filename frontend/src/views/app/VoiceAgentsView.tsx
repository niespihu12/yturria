import { useId, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { useForm, useWatch } from 'react-hook-form'
import { PlusIcon, TrashIcon, PencilSquareIcon, PhoneIcon } from '@heroicons/react/24/outline'
import { createAgent, deleteAgent, getAgents } from '@/api/VoiceRuntimeAPI'
import { listTextAgentTemplates } from '@/api/TextAgentsAPI'
import type { AgentListItem } from '@/types/agent'
import type { TextAgentTemplate, TextAgentTemplateKey } from '@/types/textAgent'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import Skeleton from '@/components/ui/Skeleton'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { describeError, errorClass, inputClass, labelClass } from '@/components/app/agent/agentUi'

type CreateForm = {
  name: string
  template_key: TextAgentTemplateKey
}

type TemplateCopy = Pick<TextAgentTemplate, 'label' | 'summary' | 'description' | 'highlights'>

// Textos de negocio (con tildes) para las plantillas conocidas; las demás usan el texto del servidor.
const TEMPLATE_COPY: Partial<Record<TextAgentTemplateKey, TemplateCopy>> = {
  sofia: {
    label: 'Sofía',
    summary: 'Asesora comercial para seguros que pasa la llamada a una persona del equipo cuando hace falta.',
    description:
      'Ideal para ventas y atención de seguros. Recoge el contexto comercial de cada llamada y puede transferir la conversación a un asesor.',
    highlights: ['Flujo comercial para seguros', 'Transferencia a un asesor', 'Lista para empezar'],
  },
  recepcionista: {
    label: 'Recepcionista',
    summary: 'Agenda citas, toma mensajes y responde dudas operativas.',
    description:
      'Pensada para la recepción y el primer contacto: horarios, disponibilidad, mensajes y solicitudes de cita.',
    highlights: ['Agenda y mensajes', 'Sirve para distintos negocios', 'Conversaciones cortas'],
  },
  faq_bot: {
    label: 'Preguntas frecuentes',
    summary: 'Responde preguntas frecuentes con su base de conocimiento, sin transferir llamadas.',
    description:
      'Hecha para el autoservicio: responde con base en sus documentos, sin inventar respuestas ni transferir a una persona.',
    highlights: ['Basada en sus documentos', 'Evita inventar respuestas', 'Sin transferencias automáticas'],
  },
  custom: {
    label: 'Personalizada',
    summary: 'Empieza en blanco para configurar el agente desde cero.',
    description:
      'Para casos especiales: usted define las instrucciones, el saludo y el comportamiento del agente.',
    highlights: ['Instrucciones a su medida', 'Configuración completa', 'Para casos especiales'],
  },
}

function getTemplateCopy(template: TextAgentTemplate): TemplateCopy {
  return TEMPLATE_COPY[template.key] ?? template
}

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const LIST_COLUMNS = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]'

export default function VoiceAgentsView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { isSuperAdmin } = useCurrentUser()
  const [confirm, confirmDialog] = useConfirm()
  const formId = useId()
  const nameId = useId()
  const templatesId = useId()

  const scopedUserId = searchParams.get('user_id') || undefined

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
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
  const isEmpty = !isLoading && !isError && agents.length === 0

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
            first_message: 'Hola, ¿en qué puedo ayudarle?',
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
    onError: (err: Error) =>
      toast.error(describeError(err, 'No pudimos crear el agente. Intente de nuevo.')),
  })

  const { mutate: remove } = useMutation({
    mutationFn: deleteAgent,
    onSuccess: () => {
      toast.success('Agente eliminado')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setDeletingId(null)
    },
    onError: (err: Error) => {
      toast.error(describeError(err, 'No pudimos eliminar el agente. Intente de nuevo.'))
      setDeletingId(null)
    },
  })

  const handleDelete = async (agent: AgentListItem) => {
    const accepted = await confirm({
      title: `¿Eliminar el agente «${agent.name}»?`,
      description:
        'El agente dejará de atender llamadas y se perderá su configuración: saludo, voz, instrucciones y herramientas. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar agente',
      tone: 'danger',
    })
    if (!accepted) return
    setDeletingId(agent.agent_id)
    remove(agent.agent_id)
  }

  const createButton = (
    <Button leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />} onClick={() => setShowModal(true)}>
      Nuevo agente
    </Button>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <PageHeader
          title="Agentes de voz"
          description="Atienden las llamadas de sus clientes con el saludo, la voz y la información que usted defina."
          actions={
            <>
              {!isSuperAdmin && !isLoading && (
                <span className="text-sm text-text-secondary tabular-nums">
                  {agents.length} de {clientAgentLimit} agentes en uso
                </span>
              )}
              {canCreate && !isEmpty && !isError && createButton}
            </>
          }
        />

        {(scopedUserId || (!canCreate && !isSuperAdmin)) && (
          <div className="mb-4 space-y-1 text-sm text-text-secondary">
            {scopedUserId && <p>Está viendo los agentes de un solo usuario.</p>}
            {!canCreate && !isSuperAdmin && (
              <p>
                Alcanzó el límite de {clientAgentLimit} agentes de su cuenta. Para crear otro,
                elimine uno que ya no use.
              </p>
            )}
          </div>
        )}

        <section
          aria-label="Listado de agentes de voz"
          aria-busy={isLoading}
          className="overflow-hidden rounded-xl border border-border-default bg-surface"
        >
          {isLoading ? (
            <div className="divide-y divide-border-subtle px-5">
              {[0, 1, 2].map((row) => (
                <Skeleton.TableRow key={row} columns={3} />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-start gap-3 px-6 py-10 sm:items-center sm:text-center">
              <p className="text-base font-semibold text-text-primary">
                No pudimos cargar sus agentes de voz
              </p>
              <p className="max-w-[60ch] text-sm text-text-secondary">
                {describeError(error, 'Intente de nuevo en unos minutos.')}
              </p>
              <Button variant="outline" size="sm" isLoading={isFetching} onClick={() => refetch()}>
                Reintentar
              </Button>
            </div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-start gap-3 px-6 py-12 sm:items-center sm:text-center">
              <PhoneIcon className="h-6 w-6 text-primary-600" aria-hidden="true" />
              <p className="text-base font-semibold text-text-primary">Aún no hay agentes de voz</p>
              <p className="max-w-[55ch] text-sm text-text-secondary">
                Cree un agente para atender llamadas con el saludo, la voz y la información de su
                operación. Podrá probarlo desde el navegador antes de conectarlo a un número.
              </p>
              {canCreate && <div className="pt-1">{createButton}</div>}
            </div>
          ) : (
            <>
              <div
                aria-hidden="true"
                className={`${LIST_COLUMNS} hidden border-b border-border-default bg-surface-muted px-5 py-3 text-xs font-medium text-text-tertiary md:grid`}
              >
                <span>Nombre</span>
                <span>Creado por</span>
                <span>Fecha de creación</span>
                <span className="w-20" />
              </div>
              <ul className="divide-y divide-border-subtle">
                {agents.map((agent) => {
                  const createdAt = agent.created_at_unix_secs
                    ? formatDate(agent.created_at_unix_secs)
                    : null
                  const creator = agent.access_info?.creator_email ?? null

                  return (
                    <li
                      key={agent.agent_id}
                      className={`${LIST_COLUMNS} relative px-5 py-4 transition-colors hover:bg-primary-50/60`}
                    >
                      <div className="min-w-0">
                        <Link
                          to={`/agentes_voz/${agent.agent_id}`}
                          className="block truncate text-sm font-semibold text-text-primary after:absolute after:inset-0 after:content-[''] hover:text-primary-700 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-primary-500"
                        >
                          {agent.name}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-text-tertiary md:hidden">
                          {[creator, createdAt].filter(Boolean).join(' · ') || 'Sin datos de creación'}
                        </p>
                      </div>
                      <span className="hidden truncate text-sm text-text-secondary md:block">
                        {creator ?? '—'}
                      </span>
                      <span className="hidden text-sm text-text-secondary tabular-nums md:block">
                        {createdAt ?? '—'}
                      </span>
                      <div className="relative z-10 flex w-20 items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => navigate(`/agentes_voz/${agent.agent_id}`)}
                          aria-label={`Editar ${agent.name}`}
                          className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-primary-50 hover:text-primary-700"
                        >
                          <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(agent)}
                          disabled={deletingId === agent.agent_id}
                          aria-label={`Eliminar ${agent.name}`}
                          className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50"
                        >
                          <TrashIcon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        size="xl"
        dismissOnBackdrop={false}
        title="Nuevo agente de voz"
        description="Elija una plantilla como punto de partida. Después podrá ajustar el saludo, la voz y las instrucciones."
        footer={
          <>
            <Button variant="ghost" onClick={closeModal}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form={formId}
              isLoading={isCreating}
              disabled={loadingTemplates || templatesError}
            >
              Crear agente
            </Button>
          </>
        }
      >
        <form
          id={formId}
          onSubmit={handleSubmit((values) => create(values))}
          className="space-y-6"
          noValidate
        >
          <div>
            <label htmlFor={nameId} className={labelClass}>
              Nombre del agente
            </label>
            <input
              id={nameId}
              type="text"
              placeholder="Ej.: Atención de siniestros"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${nameId}-error` : undefined}
              className={`mt-2 ${inputClass}`}
              {...register('name', { required: 'Escriba un nombre para el agente.' })}
            />
            {errors.name && (
              <p id={`${nameId}-error`} className={errorClass}>
                {errors.name.message}
              </p>
            )}
          </div>

          <fieldset>
            <legend className={labelClass}>Plantilla</legend>
            {loadingTemplates ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Skeleton height={112} className="rounded-xl" />
                <Skeleton height={112} className="rounded-xl" />
              </div>
            ) : templatesError ? (
              <p className="mt-3 rounded-lg bg-surface-muted px-4 py-3 text-sm text-text-secondary">
                No pudimos cargar las plantillas. Cierre esta ventana e intente de nuevo en unos
                minutos.
              </p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {templates.map((template) => {
                  const copy = getTemplateCopy(template)
                  const optionId = `${templatesId}-${template.key}`
                  return (
                    <label
                      key={template.key}
                      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-border-default bg-surface p-4 transition-colors hover:border-primary-300 has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-500 has-[:focus-visible]:ring-offset-2"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="flex items-center gap-2.5">
                          <input
                            type="radio"
                            value={template.key}
                            aria-labelledby={`${optionId}-name`}
                            aria-describedby={`${optionId}-summary`}
                            className="h-4 w-4 accent-primary-600"
                            {...register('template_key', { required: 'Elija una plantilla.' })}
                          />
                          <span id={`${optionId}-name`} className="text-sm font-semibold text-text-primary">
                            {copy.label}
                          </span>
                        </span>
                        {template.recommended && (
                          <Badge variant="primary" size="sm">
                            Recomendada
                          </Badge>
                        )}
                      </span>
                      <span id={`${optionId}-summary`} className="text-sm leading-relaxed text-text-secondary">
                        {copy.summary}
                      </span>
                      {copy.highlights.length > 0 && (
                        <span className="text-xs text-text-tertiary">{copy.highlights.join(' · ')}</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
            {errors.template_key && <p className={errorClass}>{errors.template_key.message}</p>}
            {selectedTemplate && !loadingTemplates && !templatesError && (
              <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-text-secondary">
                {getTemplateCopy(selectedTemplate).description}
              </p>
            )}
          </fieldset>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  )
}
