import { useEffect, useId, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import {
  getConversationAudioBlob,
  getConversationDetail,
  getConversations,
  runConversationAnalysis,
  updateAgent,
} from '@/api/VoiceRuntimeAPI'
import type {
  AgentDetail,
  AnalysisCriterion,
  Conversation,
  ConversationDetail,
  DataCollectionField,
} from '@/types/agent'
import {
  ANALYSIS_SCOPES,
  DATA_COLLECTION_TYPES,
  SUPPORTED_LANGUAGES,
} from '@/types/agent'
import AdvancedSection from '@/components/ui/AdvancedSection'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { Field, SectionHeading, SwitchField } from '../fields'
import { describeError, inputClass, subsectionTitleClass, textareaClass } from '../agentUi'

type Props = {
  agentId: string
  agent: AgentDetail
  onUpdate: () => void
  isClient?: boolean
}

type EditableCriterion = {
  localId: string
  identifier: string
  prompt: string
  scope: string
  useKnowledgeBase: boolean
}

type EditableDataField = {
  localId: string
  identifier: string
  type: string
  description: string
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info'

type ConfigTab = 'criteria' | 'data' | 'language'

const CONFIG_TABS: Array<{ id: ConfigTab; label: string }> = [
  { id: 'criteria', label: 'Criterios' },
  { id: 'data', label: 'Datos a extraer' },
  { id: 'language', label: 'Idioma del resumen' },
]

const DATA_TYPE_LABELS: Record<string, string> = {
  string: 'Texto',
  boolean: 'Sí o no',
  integer: 'Número entero',
  number: 'Número',
}

const CONVERSATIONS_PAGE_SIZE = 10

function createLocalId() {
  return Math.random().toString(36).slice(2, 10)
}

function createEmptyCriterion(): EditableCriterion {
  return {
    localId: createLocalId(),
    identifier: '',
    prompt: '',
    scope: 'conversation',
    useKnowledgeBase: false,
  }
}

function createEmptyDataField(): EditableDataField {
  return {
    localId: createLocalId(),
    identifier: '',
    type: 'string',
    description: '',
  }
}

function mapCriteria(criteria?: AnalysisCriterion[]): EditableCriterion[] {
  if (!criteria?.length) return [createEmptyCriterion()]

  return criteria.map((criterion) => ({
    localId: createLocalId(),
    identifier: criterion.id ?? criterion.name ?? '',
    prompt: criterion.conversation_goal_prompt ?? '',
    scope: criterion.scope ?? 'conversation',
    useKnowledgeBase: Boolean(criterion.use_knowledge_base),
  }))
}

function mapDataCollection(
  dataCollection?: Record<string, DataCollectionField>
): EditableDataField[] {
  const entries = Object.entries(dataCollection ?? {})
  if (!entries.length) return [createEmptyDataField()]

  return entries.map(([identifier, field]) => ({
    localId: createLocalId(),
    identifier,
    type: field.type ?? 'string',
    description: field.description ?? '',
  }))
}

function formatDuration(secs?: number) {
  if (!secs) return '—'
  const minutes = Math.floor(secs / 60)
  const seconds = secs % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleString('es-CO', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  return null
}

function getConversationAudioUrl(detail: ConversationDetail | undefined): string | null {
  if (!detail) return null

  const metadata = (detail.metadata ?? {}) as Record<string, unknown>
  const signedUrls = ((detail as Record<string, unknown>).signed_urls ?? {}) as Record<
    string,
    unknown
  >
  const recording = ((detail as Record<string, unknown>).recording ?? {}) as Record<
    string,
    unknown
  >

  return firstNonEmptyString(
    detail.audio_url,
    detail.recording_url,
    detail.signed_audio_url,
    metadata.audio_url,
    metadata.recording_url,
    metadata.call_recording_url,
    metadata.signed_audio_url,
    signedUrls.audio,
    signedUrls.recording,
    signedUrls.call_recording,
    recording.url,
    recording.audio_url
  )
}

function describeCallStatus(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case 'done':
      return { label: 'Completada', variant: 'success' }
    case 'processing':
      return { label: 'Procesando', variant: 'info' }
    case 'in-progress':
      return { label: 'En curso', variant: 'info' }
    case 'failed':
      return { label: 'Fallida', variant: 'danger' }
    default:
      return { label: status, variant: 'default' }
  }
}

function describeCriteriaResult(result: string): { label: string; variant: BadgeVariant } {
  const normalized = result.toLowerCase()
  if (['success', 'passed', 'pass', 'done'].includes(normalized)) {
    return { label: 'Cumplido', variant: 'success' }
  }
  if (['failure', 'failed', 'fail', 'error'].includes(normalized)) {
    return { label: 'No cumplido', variant: 'danger' }
  }
  return { label: 'Sin determinar', variant: 'default' }
}

function AnalysisSummary({ detail }: { detail: ConversationDetail }) {
  const analysis = detail.analysis
  const criteriaResults = analysis?.evaluation_criteria_results
    ? Object.values(analysis.evaluation_criteria_results)
    : []
  const dataResults = analysis?.data_collection_results
    ? Object.entries(analysis.data_collection_results)
    : []

  return (
    <div className="space-y-6">
      <section>
        <h3 className={subsectionTitleClass}>Resumen</h3>
        {analysis?.transcript_summary ? (
          <p className="mt-2 text-sm leading-relaxed text-text-primary">
            {analysis.transcript_summary}
          </p>
        ) : (
          <p className="mt-2 text-sm text-text-secondary">
            Esta llamada aún no tiene resumen.
          </p>
        )}
      </section>

      <section>
        <h3 className={subsectionTitleClass}>Criterios evaluados</h3>
        {criteriaResults.length > 0 ? (
          <ul className="mt-2 divide-y divide-border-subtle">
            {criteriaResults.map((result, index) => {
              const outcome = describeCriteriaResult(result.result ?? 'unknown')
              return (
                <li key={`${result.criteria_id ?? 'criterion'}-${index}`} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-text-primary">
                      {result.criteria_id ?? `Criterio ${index + 1}`}
                    </p>
                    <Badge variant={outcome.variant} size="sm">
                      {outcome.label}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                    {result.rationale ?? 'Sin justificación disponible.'}
                  </p>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-text-secondary">Aún no hay resultados de evaluación.</p>
        )}
      </section>

      <section>
        <h3 className={subsectionTitleClass}>Datos extraídos</h3>
        {dataResults.length > 0 ? (
          <dl className="mt-2 divide-y divide-border-subtle">
            {dataResults.map(([key, result]) => (
              <div key={key} className="py-3">
                <dt className="text-xs font-medium text-text-tertiary">{key}</dt>
                <dd className="mt-0.5 text-sm text-text-primary">
                  {result.value === null || result.value === undefined ? '—' : String(result.value)}
                </dd>
                {result.rationale && (
                  <dd className="mt-1 text-sm leading-relaxed text-text-secondary">{result.rationale}</dd>
                )}
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-sm text-text-secondary">No se extrajeron datos de esta llamada.</p>
        )}
      </section>
    </div>
  )
}

function ConversationDetailModal({
  conversationId,
  onClose,
}: {
  conversationId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [proxyAudioUrl, setProxyAudioUrl] = useState<string | null>(null)
  const safeId = conversationId

  const { data, isLoading } = useQuery({
    queryKey: ['conversation', safeId],
    queryFn: () => getConversationDetail(safeId),
  })

  const detailAudioUrl = getConversationAudioUrl(data)

  const {
    data: proxyAudioBlob,
    isLoading: isLoadingProxyAudio,
  } = useQuery({
    queryKey: ['conversation-audio', safeId],
    queryFn: () => getConversationAudioBlob(safeId),
    enabled: !isLoading && !detailAudioUrl,
    retry: false,
  })

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!proxyAudioBlob) {
      setProxyAudioUrl(null)
      return
    }

    const objectUrl = URL.createObjectURL(proxyAudioBlob)
    setProxyAudioUrl(objectUrl)

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [proxyAudioBlob])
  /* eslint-enable react-hooks/set-state-in-effect */

  const conversationAudioUrl = detailAudioUrl ?? proxyAudioUrl
  const callDurationSecs = data?.metadata?.call_duration_secs

  const { mutate: rerunAnalysis, isPending: isReanalyzing } = useMutation({
    mutationFn: () => runConversationAnalysis(safeId),
    onSuccess: () => {
      toast.success('Análisis en proceso. Los resultados se actualizarán en unos segundos.')
      queryClient.invalidateQueries({ queryKey: ['conversation', safeId] })
    },
    onError: (error: Error) =>
      toast.error(describeError(error, 'No pudimos volver a analizar la llamada.')),
  })

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Detalle de la llamada"
      description={
        callDurationSecs !== undefined ? (
          <span className="tabular-nums">Duración {formatDuration(callDurationSecs)}</span>
        ) : undefined
      }
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => rerunAnalysis()}
            isLoading={isReanalyzing}
            leftIcon={<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />}
          >
            {isReanalyzing ? 'Analizando…' : 'Volver a analizar'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {isLoading ? (
            <p role="status" className="py-8 text-sm text-text-secondary">
              Cargando la llamada…
            </p>
          ) : (
            <>
              <section className="space-y-3">
                <h3 className={subsectionTitleClass}>Audio</h3>
                {conversationAudioUrl ? (
                  <>
                    <audio controls preload="none" className="w-full" aria-label="Audio de la llamada">
                      <source src={conversationAudioUrl} />
                      Su navegador no puede reproducir este audio.
                    </audio>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={conversationAudioUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50"
                      >
                        <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
                        Abrir en otra pestaña
                      </a>
                      <a
                        href={conversationAudioUrl}
                        download={`llamada-${safeId}.audio`}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50"
                      >
                        <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
                        Descargar
                      </a>
                    </div>
                  </>
                ) : isLoadingProxyAudio ? (
                  <p role="status" className="text-sm text-text-secondary">
                    Cargando el audio…
                  </p>
                ) : (
                  <p className="text-sm text-text-secondary">
                    Esta llamada no tiene audio disponible. Revise que la grabación de llamadas
                    esté activa para este agente.
                  </p>
                )}
              </section>

              <section className="space-y-3">
                <h3 className={subsectionTitleClass}>Transcripción</h3>
                {data?.transcript?.length ? (
                  <ol className="space-y-3">
                    {data.transcript.map((msg, idx) => {
                      const isAgent = msg.role === 'agent'
                      return (
                        <li key={idx} className={cn('flex', isAgent ? 'justify-start' : 'justify-end')}>
                          <div
                            className={cn(
                              'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm',
                              isAgent
                                ? 'bg-primary-50 text-text-primary'
                                : 'border border-border-default bg-surface-muted text-text-primary',
                            )}
                          >
                            <div className="mb-1 flex items-center justify-between gap-3 text-xs text-text-tertiary">
                              <span className="font-medium">{isAgent ? 'Agente' : 'Cliente'}</span>
                              {msg.time_in_call_secs !== undefined && (
                                <span className="tabular-nums">{formatDuration(msg.time_in_call_secs)}</span>
                              )}
                            </div>
                            <p className="leading-relaxed">{msg.message}</p>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className="text-sm text-text-secondary">Esta llamada no tiene transcripción.</p>
                )}
              </section>
            </>
          )}
        </div>

        <div className="lg:border-l lg:border-border-subtle lg:pl-8">
          {isLoading || !data ? (
            <p role="status" className="py-8 text-sm text-text-secondary">
              Cargando el análisis…
            </p>
          ) : (
            <AnalysisSummary detail={data} />
          )}
        </div>
      </div>
    </Modal>
  )
}

export default function AnalysisTab({ agentId, agent, onUpdate, isClient = false }: Props) {
  const queryClient = useQueryClient()
  const baseId = useId()
  const [selectedConv, setSelectedConv] = useState<string | null>(null)
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [conversationCursorHistory, setConversationCursorHistory] = useState<string[]>([])
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigTab>('criteria')
  const [analysisLanguage, setAnalysisLanguage] = useState('es')
  const [criteria, setCriteria] = useState<EditableCriterion[]>([createEmptyCriterion()])
  const [dataCollection, setDataCollection] = useState<EditableDataField[]>([
    createEmptyDataField(),
  ])

  // Sync agent config to state (setState-during-render pattern)
  const [lastAgent, setLastAgent] = useState(agent)
  if (agent !== lastAgent) {
    setLastAgent(agent)
    setCriteria(mapCriteria(agent.platform_settings?.evaluation?.criteria))
    setDataCollection(mapDataCollection(agent.platform_settings?.data_collection))
    setAnalysisLanguage(
      agent.platform_settings?.summary_language ??
        agent.conversation_config.agent.language ??
        'es'
    )
  }

  // Reset pagination when agentId changes (setState-during-render pattern)
  const [lastAgentId, setLastAgentId] = useState(agentId)
  if (agentId !== lastAgentId) {
    setLastAgentId(agentId)
    setConversationCursor(null)
    setConversationCursorHistory([])
  }

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['conversations', agentId, conversationCursor, CONVERSATIONS_PAGE_SIZE],
    queryFn: () =>
      getConversations(agentId, {
        cursor: conversationCursor,
        page_size: CONVERSATIONS_PAGE_SIZE,
      }),
    placeholderData: (previousData) => previousData,
  })

  const conversations: Conversation[] = data?.conversations ?? []
  const nextCursor = data?.next_cursor ?? null
  const hasPreviousPage = conversationCursorHistory.length > 0
  const hasNextPage = Boolean(nextCursor)
  const currentPage = conversationCursorHistory.length + 1

  const secondaryScopeValue =
    ANALYSIS_SCOPES.find((scope) => scope.value !== 'conversation')?.value ?? 'turn'

  const getConversationMessageCount = (conversation: Conversation) => {
    const conversationWithCount = conversation as Conversation & {
      message_count?: number
    }

    if (typeof conversationWithCount.message_count === 'number') {
      return conversationWithCount.message_count
    }

    if (Array.isArray(conversation.transcript)) {
      return conversation.transcript.length
    }

    return undefined
  }

  const hasMessagesColumn = conversations.some(
    (conversation) => getConversationMessageCount(conversation) !== undefined
  )

  const goToNextPage = () => {
    if (!nextCursor || isFetching) return
    setConversationCursorHistory((prev) => [...prev, conversationCursor ?? ''])
    setConversationCursor(nextCursor)
  }

  const goToPreviousPage = () => {
    if (!hasPreviousPage || isFetching) return

    const nextHistory = [...conversationCursorHistory]
    const previousCursor = nextHistory.pop() ?? ''

    setConversationCursorHistory(nextHistory)
    setConversationCursor(previousCursor || null)
  }

  const updateCriterion = (localId: string, patch: Partial<EditableCriterion>) =>
    setCriteria((prev) => prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item)))

  const updateDataField = (localId: string, patch: Partial<EditableDataField>) =>
    setDataCollection((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, ...patch } : item))
    )

  const serializedCriteria = useMemo(
    () =>
      criteria
        .map((criterion) => ({
          identifier: criterion.identifier.trim(),
          prompt: criterion.prompt.trim(),
          scope: criterion.scope,
          useKnowledgeBase: criterion.useKnowledgeBase,
        }))
        .filter((criterion) => criterion.identifier && criterion.prompt)
        .map((criterion) => ({
          id: criterion.identifier,
          name: criterion.identifier,
          conversation_goal_prompt: criterion.prompt,
          use_knowledge_base: criterion.useKnowledgeBase,
          scope: criterion.scope,
        })),
    [criteria]
  )

  const serializedDataCollection = useMemo(
    () =>
      Object.fromEntries(
        dataCollection
          .map((item) => ({
            identifier: item.identifier.trim(),
            type: item.type,
            description: item.description.trim(),
          }))
          .filter((item) => item.identifier && item.description)
          .map((item) => [
            item.identifier,
            { type: item.type, description: item.description },
          ])
      ),
    [dataCollection]
  )

  const { mutate: saveAnalysis, isPending: isSaving } = useMutation({
    mutationFn: () =>
      updateAgent(agentId, {
        platform_settings: {
          ...(agent.platform_settings ?? {}),
          evaluation: {
            ...(agent.platform_settings?.evaluation ?? {}),
            criteria: serializedCriteria,
          },
          data_collection: serializedDataCollection,
          summary_language: analysisLanguage,
        },
      }),
    onSuccess: () => {
      toast.success('Configuración del análisis guardada')
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] })
      onUpdate()
    },
    onError: (err: Error) =>
      toast.error(describeError(err, 'No pudimos guardar el análisis. Intente de nuevo.')),
  })

  const segmentClass = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      active ? 'bg-surface text-primary-700 shadow-sm' : 'text-text-secondary hover:text-text-primary',
    )

  return (
    <div className="space-y-10">
      <section aria-labelledby={`${baseId}-history`} className="space-y-4">
        <SectionHeading
          id={`${baseId}-history`}
          title="Historial de llamadas"
          description="Abra una llamada para escuchar el audio, leer la transcripción y ver su resumen."
          action={
            (conversations.length > 0 || hasPreviousPage) && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary tabular-nums">Página {currentPage}</span>
                <button
                  type="button"
                  onClick={goToPreviousPage}
                  disabled={!hasPreviousPage || isFetching}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-default text-text-secondary transition-colors hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Página anterior"
                >
                  <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={goToNextPage}
                  disabled={!hasNextPage || isFetching}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-default text-text-secondary transition-colors hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Página siguiente"
                >
                  <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )
          }
        />

        <div className="overflow-hidden rounded-xl border border-border-default bg-surface">
          {isLoading ? (
            <p role="status" className="flex h-32 items-center justify-center gap-2 text-sm text-text-secondary">
              <span
                aria-hidden="true"
                className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent"
              />
              Cargando llamadas…
            </p>
          ) : isError ? (
            <div className="flex flex-col items-start gap-3 px-6 py-8">
              <p className="text-sm font-medium text-text-primary">El historial no está disponible</p>
              <p className="max-w-[60ch] text-sm text-text-secondary">
                {describeError(error, 'Intente de nuevo en unos minutos.')}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()} isLoading={isFetching}>
                Reintentar
              </Button>
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-medium text-text-primary">Aún no hay llamadas registradas</p>
              <p className="mx-auto mt-1 max-w-[50ch] text-sm text-text-secondary">
                Cuando el agente atienda su primera llamada, la verá aquí con su resumen.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead>
                  <tr className="border-b border-border-default bg-surface-muted text-xs font-medium text-text-tertiary">
                    <th scope="col" className="px-5 py-3 font-medium">Inicio</th>
                    <th scope="col" className="px-5 py-3 font-medium">Duración</th>
                    {hasMessagesColumn && (
                      <th scope="col" className="px-5 py-3 font-medium">Mensajes</th>
                    )}
                    <th scope="col" className="px-5 py-3 font-medium">Estado</th>
                    <th scope="col" className="px-5 py-3">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {conversations.map((conv) => {
                    const status = describeCallStatus(conv.status)
                    const startedAt = formatDate(conv.start_time_unix_secs)
                    return (
                      <tr
                        key={conv.conversation_id}
                        className="cursor-pointer transition-colors hover:bg-primary-50/60"
                        onClick={() => setSelectedConv(conv.conversation_id)}
                      >
                        <td className="px-5 py-3.5 text-sm text-text-primary">{startedAt}</td>
                        <td className="px-5 py-3.5 text-sm text-text-secondary">
                          {formatDuration(conv.call_duration_secs)}
                        </td>
                        {hasMessagesColumn && (
                          <td className="px-5 py-3.5 text-sm text-text-secondary">
                            {getConversationMessageCount(conv) ?? '—'}
                          </td>
                        )}
                        <td className="px-5 py-3.5">
                          <Badge variant={status.variant} size="sm">
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedConv(conv.conversation_id)
                            }}
                            aria-label={`Ver la llamada del ${startedAt}`}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-primary-700 hover:bg-primary-50"
                          >
                            Ver
                            <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {!isClient && (
        <AdvancedSection
          defaultOpen
          title="Configuración del análisis"
          description="Qué evalúa la plataforma y qué datos extrae después de cada llamada."
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label="Parte del análisis" className="inline-flex flex-wrap rounded-lg border border-border-default bg-surface-muted p-1">
              {CONFIG_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={activeConfigTab === tab.id}
                  onClick={() => setActiveConfigTab(tab.id)}
                  className={segmentClass(activeConfigTab === tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <Button type="button" variant="secondary" onClick={() => saveAnalysis()} isLoading={isSaving}>
              {isSaving ? 'Guardando…' : 'Guardar análisis'}
            </Button>
          </div>

          {activeConfigTab === 'criteria' && (
            <div className="space-y-4">
              <SectionHeading
                as="h3"
                title="Criterios de evaluación"
                description="Cada criterio indica si la llamada cumplió un objetivo, por ejemplo «resolvió la consulta»."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCriteria((prev) => [...prev, createEmptyCriterion()])}
                    leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
                  >
                    Agregar criterio
                  </Button>
                }
              />

              <ol className="divide-y divide-border-default rounded-xl border border-border-default bg-surface">
                {criteria.map((criterion, index) => {
                  const isConversationScope = criterion.scope === 'conversation'
                  const scopeLabelId = `${baseId}-scope-${criterion.localId}`

                  return (
                    <li key={criterion.localId} className="space-y-4 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-text-primary tabular-nums">
                          Criterio {index + 1}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            setCriteria((prev) =>
                              prev.length === 1
                                ? [createEmptyCriterion()]
                                : prev.filter((item) => item.localId !== criterion.localId)
                            )
                          }
                          aria-label={`Eliminar criterio ${index + 1}`}
                          className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700"
                        >
                          <TrashIcon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                        <Field label="Nombre del criterio" help="Sin espacios; se usa como identificador.">
                          {(control) => (
                            <input
                              {...control}
                              type="text"
                              value={criterion.identifier}
                              onChange={(event) =>
                                updateCriterion(criterion.localId, { identifier: event.target.value })
                              }
                              placeholder="resolvio_consulta"
                              className={inputClass}
                            />
                          )}
                        </Field>

                        <div>
                          <p id={scopeLabelId} className="text-sm font-medium text-text-primary">
                            Alcance
                          </p>
                          <p className="mt-0.5 text-xs text-text-tertiary">Qué parte de la llamada se evalúa.</p>
                          <div
                            role="group"
                            aria-labelledby={scopeLabelId}
                            className="mt-2 inline-flex rounded-lg border border-border-default bg-surface-muted p-1"
                          >
                            <button
                              type="button"
                              aria-pressed={isConversationScope}
                              onClick={() => updateCriterion(criterion.localId, { scope: 'conversation' })}
                              className={segmentClass(isConversationScope)}
                            >
                              Toda la conversación
                            </button>
                            <button
                              type="button"
                              aria-pressed={!isConversationScope}
                              onClick={() => updateCriterion(criterion.localId, { scope: secondaryScopeValue })}
                              className={segmentClass(!isConversationScope)}
                            >
                              Respuestas del agente
                            </button>
                          </div>
                        </div>
                      </div>

                      <Field label="Qué debe evaluar">
                        {(control) => (
                          <textarea
                            {...control}
                            rows={3}
                            value={criterion.prompt}
                            onChange={(event) =>
                              updateCriterion(criterion.localId, { prompt: event.target.value })
                            }
                            placeholder="Describa con precisión qué se debe revisar en la llamada."
                            className={textareaClass}
                          />
                        )}
                      </Field>

                      <SwitchField
                        label="Usar la base de conocimiento al evaluar"
                        checked={criterion.useKnowledgeBase}
                        onChange={(next) => updateCriterion(criterion.localId, { useKnowledgeBase: next })}
                      />
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {activeConfigTab === 'data' && (
            <div className="space-y-4">
              <SectionHeading
                as="h3"
                title="Datos a extraer"
                description="Información que la plataforma toma de cada llamada, como el correo o el motivo de contacto."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDataCollection((prev) => [...prev, createEmptyDataField()])}
                    leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
                  >
                    Agregar dato
                  </Button>
                }
              />

              <ol className="divide-y divide-border-default rounded-xl border border-border-default bg-surface">
                {dataCollection.map((field, index) => {
                  const typeLabelId = `${baseId}-type-${field.localId}`
                  return (
                    <li key={field.localId} className="space-y-4 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-text-primary tabular-nums">Dato {index + 1}</p>
                        <button
                          type="button"
                          onClick={() =>
                            setDataCollection((prev) =>
                              prev.length === 1
                                ? [createEmptyDataField()]
                                : prev.filter((item) => item.localId !== field.localId)
                            )
                          }
                          aria-label={`Eliminar dato ${index + 1}`}
                          className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700"
                        >
                          <TrashIcon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                        <Field label="Nombre del dato" help="Sin espacios; se usa como identificador.">
                          {(control) => (
                            <input
                              {...control}
                              type="text"
                              value={field.identifier}
                              onChange={(event) =>
                                updateDataField(field.localId, { identifier: event.target.value })
                              }
                              placeholder="correo_cliente"
                              className={inputClass}
                            />
                          )}
                        </Field>

                        <div>
                          <p id={typeLabelId} className="text-sm font-medium text-text-primary">
                            Tipo
                          </p>
                          <p className="mt-0.5 text-xs text-text-tertiary">Formato del valor extraído.</p>
                          <div
                            role="group"
                            aria-labelledby={typeLabelId}
                            className="mt-2 inline-flex flex-wrap rounded-lg border border-border-default bg-surface-muted p-1"
                          >
                            {DATA_COLLECTION_TYPES.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                aria-pressed={field.type === option.value}
                                onClick={() => updateDataField(field.localId, { type: option.value })}
                                className={segmentClass(field.type === option.value)}
                              >
                                {DATA_TYPE_LABELS[option.value] ?? option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <Field label="Descripción">
                        {(control) => (
                          <textarea
                            {...control}
                            rows={3}
                            value={field.description}
                            onChange={(event) =>
                              updateDataField(field.localId, { description: event.target.value })
                            }
                            placeholder="Indique qué se debe extraer y en qué formato."
                            className={textareaClass}
                          />
                        )}
                      </Field>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}

          {activeConfigTab === 'language' && (
            <Field
              label="Idioma del resumen"
              help="Idioma en que se escribe el resumen de cada llamada."
              className="max-w-sm"
            >
              {(control) => (
                <select
                  {...control}
                  value={analysisLanguage}
                  onChange={(event) => setAnalysisLanguage(event.target.value)}
                  className={inputClass}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
        </AdvancedSection>
      )}

      {selectedConv && (
        <ConversationDetailModal conversationId={selectedConv} onClose={() => setSelectedConv(null)} />
      )}
    </div>
  )
}
