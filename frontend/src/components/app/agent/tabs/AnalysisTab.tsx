import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  PhoneIcon,
  PlusIcon,
  SpeakerWaveIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
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

const cardClass = 'rounded-xl border border-[#e4e0f5] bg-white'
const inputClass =
  'w-full rounded-lg border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/50 transition-colors focus:border-[#271173] focus:outline-none'
const textareaClass = `${inputClass} resize-none`

type ConfigTab = 'criteria' | 'data' | 'language'

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
  if (!secs) return '-'
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    done: 'border-green-200 bg-green-50 text-green-700',
    processing: 'border-amber-200 bg-amber-50 text-amber-700',
    failed: 'border-red-200 bg-red-50 text-red-600',
    'in-progress': 'border-[#e4e0f5] bg-[#ede9ff] text-[#271173]',
  }
  const cls = map[status] ?? 'border-[#e4e0f5] bg-[#f5f3ff] text-black/70'

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {status}
    </span>
  )
}

function CriteriaResultBadge({ result }: { result: string }) {
  const normalized = result.toLowerCase()

  let cls = 'border-gray-200 bg-gray-50 text-gray-600'
  if (['success', 'passed', 'pass', 'done'].includes(normalized)) {
    cls = 'border-green-200 bg-green-50 text-green-700'
  } else if (['failure', 'failed', 'fail', 'error'].includes(normalized)) {
    cls = 'border-red-200 bg-red-50 text-red-700'
  }

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {result}
    </span>
  )
}

function TogglePill({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-5 w-10 cursor-pointer rounded-full transition-colors duration-200 ${
        enabled ? 'bg-[#271173]' : 'bg-black/20'
      }`}
      aria-pressed={enabled}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
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
    <div className="space-y-4">
      <div className="rounded-xl border border-[#e4e0f5] bg-linear-to-br from-[#ede9ff] to-[#f5f3ff] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-black">
          <SparklesIcon className="h-4 w-4 text-[#271173]" />
          Resumen del analisis
        </div>
        {analysis?.transcript_summary ? (
          <p className="text-sm leading-relaxed text-black/85">
            {analysis.transcript_summary}
          </p>
        ) : (
          <p className="text-sm text-black/60">
            Esta conversacion aun no tiene resumen disponible.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-4">
          <p className="mb-3 text-sm font-medium text-black">
            Criterios evaluados
          </p>
          <div className="space-y-3">
            {criteriaResults.length > 0 ? (
              criteriaResults.map((result, index) => (
                <div
                  key={`${result.criteria_id ?? 'criterion'}-${index}`}
                  className="rounded-lg border border-[#e4e0f5] bg-white p-3"
                >
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-black">
                      {result.criteria_id ?? `criterio_${index + 1}`}
                    </p>
                    <CriteriaResultBadge result={result.result ?? 'unknown'} />
                  </div>
                  <p className="text-xs leading-relaxed text-black/70">
                    {result.rationale ?? 'Sin justificacion disponible.'}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-black/60">
                Sin resultados de evaluacion todavia.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-4">
          <p className="mb-3 text-sm font-medium text-black">
            Datos extraidos
          </p>
          <div className="space-y-3">
            {dataResults.length > 0 ? (
              dataResults.map(([key, result]) => (
                <div
                  key={key}
                  className="rounded-lg border border-[#e4e0f5] bg-white p-3"
                >
                  <p className="text-xs uppercase tracking-wide text-black/60">
                    {key}
                  </p>
                  <p className="mt-1 text-sm text-black">
                    {result.value === null || result.value === undefined
                      ? '-'
                      : String(result.value)}
                  </p>
                  {result.rationale && (
                    <p className="mt-1 text-xs leading-relaxed text-black/70">
                      {result.rationale}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-black/60">
                No hay datos extraidos para esta llamada.
              </p>
            )}
          </div>
        </div>
      </div>
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

  const { data, isLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversationDetail(conversationId),
  })

  const detailAudioUrl = getConversationAudioUrl(data)

  const {
    data: proxyAudioBlob,
    isLoading: isLoadingProxyAudio,
  } = useQuery({
    queryKey: ['conversation-audio', conversationId],
    queryFn: () => getConversationAudioBlob(conversationId),
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
  const audioSourceLabel = detailAudioUrl ? 'Directo' : proxyAudioBlob ? 'Proxy' : null

  const { mutate: rerunAnalysis, isPending: isReanalyzing } = useMutation({
    mutationFn: () => runConversationAnalysis(conversationId),
    onSuccess: () => {
      toast.success('Analisis relanzado')
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 flex max-h-[85vh] w-full max-w-5xl flex-col rounded-xl border border-[#e4e0f5] bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-[#e4e0f5] px-5 py-4">
          <div>
            <h3 className="text-sm font-medium text-black">
              Conversacion
            </h3>
            <p className="font-mono text-xs text-black/60">
              {conversationId}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => rerunAnalysis()}
              disabled={isReanalyzing}
              className="inline-flex items-center gap-2 rounded-lg border border-[#271173]/30 px-3 py-2 text-xs font-medium text-[#271173] transition-colors hover:border-[#271173]/50 hover:bg-[#ede9ff] disabled:opacity-60"
            >
              <ArrowPathIcon
                className={`h-4 w-4 ${isReanalyzing ? 'animate-spin' : ''}`}
              />
              {isReanalyzing ? 'Recalculando...' : 'Recalcular analisis'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-black/60 transition-colors hover:text-[#271173]"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[1.2fr_1fr]">
          <div className="overflow-y-auto border-b border-[#e4e0f5] p-5 lg:border-b-0 lg:border-r">
            {isLoading ? (
              <div className="flex h-32 items-center justify-center text-sm text-black/70">
                Cargando conversacion...
              </div>
            ) : (
              <div className="space-y-3">
                {conversationAudioUrl ? (
                  <div className="overflow-hidden rounded-2xl border border-[#dcd7f0] bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ece8f9] bg-linear-to-r from-[#f8f5ff] to-[#f1ecff] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#271173]/10 text-[#271173]">
                          <SpeakerWaveIcon className="h-5 w-5" />
                        </span>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#271173]">
                            Audio de la llamada
                          </p>
                          <p className="text-xs text-black/60">
                            Reproduce y valida esta conversacion sin salir del analisis.
                          </p>
                        </div>
                      </div>

                      <div className="inline-flex flex-wrap items-center gap-2">
                        {callDurationSecs !== undefined && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#d9d3ef] bg-white px-2.5 py-1 text-[11px] font-medium text-black/70">
                            <ClockIcon className="h-3.5 w-3.5 text-[#271173]" />
                            {formatDuration(callDurationSecs)}
                          </span>
                        )}
                        {audioSourceLabel && (
                          <span className="inline-flex items-center rounded-full border border-[#d9d3ef] bg-white px-2.5 py-1 text-[11px] font-medium text-black/70">
                            Fuente: {audioSourceLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 p-4">
                      <audio controls preload="none" className="w-full">
                        <source src={conversationAudioUrl} />
                        Tu navegador no soporta audio HTML5.
                      </audio>

                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={conversationAudioUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#271173]/30 bg-white px-3 py-1.5 text-xs font-medium text-[#271173] transition-colors hover:bg-[#f5f3ff]"
                        >
                          Abrir en pestana
                        </a>
                        <a
                          href={conversationAudioUrl}
                          download={`conversation-${conversationId}.audio`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#271173]/30 bg-white px-3 py-1.5 text-xs font-medium text-[#271173] transition-colors hover:bg-[#f5f3ff]"
                        >
                          <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                          Descargar
                        </a>
                      </div>
                    </div>
                  </div>
                ) : isLoadingProxyAudio ? (
                  <div className="rounded-2xl border border-[#dcd7f0] bg-[#f8f5ff] p-4">
                    <div className="animate-pulse space-y-3">
                      <div className="h-3.5 w-48 rounded-full bg-[#dcd7f0]" />
                      <div className="h-11 w-full rounded-xl bg-[#e8e3f8]" />
                      <div className="h-7 w-36 rounded-lg bg-[#e8e3f8]" />
                    </div>
                    <p className="mt-3 text-xs text-black/60">
                      Cargando audio de la conversacion...
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-[#dcd7f0] bg-[#faf9ff] p-4 text-xs text-black/60">
                    <p className="font-medium text-black/70">Audio no disponible</p>
                    <p className="mt-1">
                      Esta conversacion no incluye archivo de audio o no fue posible recuperarlo.
                    </p>
                  </div>
                )}

                {data?.transcript?.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 ${msg.role === 'agent' ? '' : 'flex-row-reverse'}`}
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                        msg.role === 'agent'
                          ? 'bg-[#271173] text-white'
                          : 'bg-gray-100 text-black/70'
                      }`}
                    >
                      {msg.role === 'agent' ? 'A' : 'U'}
                    </div>
                    <div
                      className={`max-w-[78%] rounded-xl px-3.5 py-2.5 text-sm ${
                        msg.role === 'agent'
                          ? 'bg-[#f5f3ff] text-black'
                          : 'border border-gray-200 bg-gray-50 text-black/85'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-black/45">
                          {msg.role === 'agent' ? 'Agente' : 'Usuario'}
                        </span>
                        {msg.time_in_call_secs !== undefined && (
                          <span className="rounded-full border border-[#e4e0f5] bg-white px-2 py-0.5 text-[11px] font-medium text-black/60">
                            {formatDuration(msg.time_in_call_secs)}
                          </span>
                        )}
                      </div>
                      <p>{msg.message}</p>
                    </div>
                  </div>
                ))}
                {!data?.transcript?.length && (
                  <p className="py-8 text-center text-sm text-black/60">
                    Sin transcripcion disponible.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="overflow-y-auto p-5">
            {isLoading || !data ? (
              <div className="flex h-32 items-center justify-center text-sm text-black/70">
                Cargando analisis...
              </div>
            ) : (
              <AnalysisSummary detail={data} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AnalysisTab({ agentId, agent, onUpdate, isClient = false }: Props) {
  const queryClient = useQueryClient()
  const [selectedConv, setSelectedConv] = useState<string | null>(null)
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [conversationCursorHistory, setConversationCursorHistory] = useState<string[]>([])
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigTab>('criteria')
  const [analysisLanguage, setAnalysisLanguage] = useState('es')
  const [criteria, setCriteria] = useState<EditableCriterion[]>([createEmptyCriterion()])
  const [dataCollection, setDataCollection] = useState<EditableDataField[]>([
    createEmptyDataField(),
  ])
  const [animatingTypeFieldId, setAnimatingTypeFieldId] = useState<string | null>(null)

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

  const { data, isLoading, isFetching } = useQuery({
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

  const maxCallDurationSecs = Math.max(
    1,
    ...conversations.map((conversation) => conversation.call_duration_secs ?? 0)
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

  const handleDataFieldTypeChange = (fieldId: string, nextType: string) => {
    setDataCollection((prev) =>
      prev.map((item) =>
        item.localId === fieldId ? { ...item, type: nextType } : item
      )
    )

    setAnimatingTypeFieldId(fieldId)
    setTimeout(() => {
      setAnimatingTypeFieldId((current) => (current === fieldId ? null : current))
    }, 140)
  }

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
      toast.success('Analisis guardado')
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] })
      onUpdate()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="space-y-6">
      {!isClient && (
      <div className={`${cardClass} p-5`}>
        <div className="mb-5 flex flex-col gap-3 border-b border-[#e4e0f5] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-medium text-black">
              Configuracion de analisis
            </h3>
            <p className="mt-1 text-xs text-black/60">
              Guarda criterios de evaluacion, campos de extraccion y el idioma
              de los resumentes post-llamada usando la configuracion actual de
              la plataforma.
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveAnalysis()}
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
          >
            {isSaving && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {isSaving ? 'Guardando...' : 'Guardar analisis'}
          </button>
        </div>

        <div className="space-y-6">
          <div className="inline-flex rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-1">
            {([
              { id: 'criteria', label: 'Criterios' },
              { id: 'data', label: 'Datos' },
              { id: 'language', label: 'Idioma' },
            ] as { id: ConfigTab; label: string }[]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveConfigTab(tab.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeConfigTab === tab.id
                    ? 'bg-[#271173] text-white'
                    : 'text-black/60 hover:text-[#271173]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeConfigTab === 'criteria' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-black">
                    Criterios de evaluacion
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    Cada criterio se guarda en
                    <span className="mx-1 rounded bg-[#f0edff] px-1.5 py-0.5 font-mono text-[11px] text-black/70">
                      platform_settings.evaluation.criteria
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCriteria((prev) => [...prev, createEmptyCriterion()])
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-[#271173]/30 px-3 py-2 text-xs font-medium text-[#271173] transition-colors hover:border-[#271173]/50 hover:bg-[#ede9ff]"
                >
                  <PlusIcon className="h-4 w-4" />
                  Agregar criterio
                </button>
              </div>

              <div className="space-y-3">
                {criteria.map((criterion, index) => {
                  const isConversationScope = criterion.scope === 'conversation'

                  return (
                    <div key={criterion.localId} className="rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#271173] text-xs font-bold text-white">
                            {index + 1}
                          </span>
                          <p className="text-sm font-medium text-black">Criterio</p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCriteria((prev) =>
                              prev.length === 1
                                ? [createEmptyCriterion()]
                                : prev.filter((item) => item.localId !== criterion.localId)
                            )
                          }
                          className="rounded-md p-1.5 text-black/60 transition-colors hover:bg-rose-50 hover:text-rose-600"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-black/70">
                            Identificador
                          </label>
                          <input
                            type="text"
                            value={criterion.identifier}
                            onChange={(event) =>
                              setCriteria((prev) =>
                                prev.map((item) =>
                                  item.localId === criterion.localId
                                    ? { ...item, identifier: event.target.value }
                                    : item
                                )
                              )
                            }
                            placeholder="resolvio_objetivo"
                            className={inputClass}
                          />
                        </div>

                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-black/70">
                            Scope
                          </label>
                          <div className="inline-flex rounded-xl border border-[#e4e0f5] bg-white p-1">
                            <button
                              type="button"
                              onClick={() =>
                                setCriteria((prev) =>
                                  prev.map((item) =>
                                    item.localId === criterion.localId
                                      ? { ...item, scope: 'conversation' }
                                      : item
                                  )
                                )
                              }
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                isConversationScope
                                  ? 'bg-[#271173] text-white'
                                  : 'text-black/60 hover:text-[#271173]'
                              }`}
                            >
                              conversation
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setCriteria((prev) =>
                                  prev.map((item) =>
                                    item.localId === criterion.localId
                                      ? { ...item, scope: secondaryScopeValue }
                                      : item
                                  )
                                )
                              }
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                !isConversationScope
                                  ? 'bg-[#271173] text-white'
                                  : 'text-black/60 hover:text-[#271173]'
                              }`}
                            >
                              turn
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="mb-1.5 block text-xs font-medium text-black/70">
                          Instruccion de evaluacion
                        </label>
                        <textarea
                          rows={3}
                          value={criterion.prompt}
                          onChange={(event) =>
                            setCriteria((prev) =>
                              prev.map((item) =>
                                item.localId === criterion.localId
                                  ? { ...item, prompt: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="Define exactamente que debe revisar la plataforma en la conversacion."
                          className={textareaClass}
                        />
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#e4e0f5] bg-white px-3 py-2.5">
                        <p className="text-xs text-black/70">
                          Usar knowledge base durante esta evaluacion
                        </p>
                        <TogglePill
                          enabled={criterion.useKnowledgeBase}
                          onToggle={() =>
                            setCriteria((prev) =>
                              prev.map((item) =>
                                item.localId === criterion.localId
                                  ? {
                                      ...item,
                                      useKnowledgeBase: !item.useKnowledgeBase,
                                    }
                                  : item
                              )
                            )
                          }
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {activeConfigTab === 'data' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-black">
                    Recopilacion de datos
                  </p>
                  <p className="mt-1 text-xs text-black/60">
                    la plataforma soporta tipos string, boolean, integer y number
                    para la extraccion estructurada.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDataCollection((prev) => [...prev, createEmptyDataField()])
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-[#271173]/30 px-3 py-2 text-xs font-medium text-[#271173] transition-colors hover:border-[#271173]/50 hover:bg-[#ede9ff]"
                >
                  <PlusIcon className="h-4 w-4" />
                  Agregar campo
                </button>
              </div>

              <div className="space-y-3">
                {dataCollection.map((field, index) => (
                  <div key={field.localId} className="rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-black">
                        Campo {index + 1}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setDataCollection((prev) =>
                            prev.length === 1
                              ? [createEmptyDataField()]
                              : prev.filter((item) => item.localId !== field.localId)
                          )
                        }
                        className="rounded-md p-1.5 text-black/60 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[1fr_260px]">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-black/70">
                          Identificador
                        </label>
                        <input
                          type="text"
                          value={field.identifier}
                          onChange={(event) =>
                            setDataCollection((prev) =>
                              prev.map((item) =>
                                item.localId === field.localId
                                  ? { ...item, identifier: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="email_cliente"
                          className={inputClass}
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-black/70">
                          Tipo
                        </label>
                        <div className="inline-flex flex-wrap rounded-xl border border-[#e4e0f5] bg-white p-1">
                          {DATA_COLLECTION_TYPES.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() =>
                                handleDataFieldTypeChange(field.localId, option.value)
                              }
                              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                                field.type === option.value
                                  ? 'bg-[#271173] text-white'
                                  : 'bg-[#f5f3ff] text-black/60'
                              } ${
                                animatingTypeFieldId === field.localId && field.type === option.value
                                  ? 'scale-95'
                                  : 'scale-100'
                              }`}
                            >
                              {option.value}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="mb-1.5 block text-xs font-medium text-black/70">
                        Descripcion
                      </label>
                      <textarea
                        rows={3}
                        value={field.description}
                        onChange={(event) =>
                          setDataCollection((prev) =>
                            prev.map((item) =>
                              item.localId === field.localId
                                ? { ...item, description: event.target.value }
                                : item
                            )
                          )
                        }
                        placeholder="Indica exactamente que debe extraerse y como debe formatearse."
                        className={textareaClass}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeConfigTab === 'language' && (
            <div className="max-w-sm">
              <label className="mb-1.5 block text-sm font-medium text-black">
                Idioma del analisis
              </label>
              <p className="mb-3 text-xs text-black/60">
                Se guarda en
                <span className="mx-1 rounded bg-[#f0edff] px-1.5 py-0.5 font-mono text-[11px] text-black/70">
                  platform_settings.summary_language
                </span>
                para definir el idioma del resumen post-conversacion.
              </p>
              <select
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
            </div>
          )}
        </div>
      </div>

      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-black/85">
            Historial de llamadas
          </h3>
          <div className="inline-flex items-center gap-2">
            <span className="text-xs text-black/60">
              Pagina {currentPage}
            </span>
            <button
              type="button"
              onClick={goToPreviousPage}
              disabled={!hasPreviousPage || isFetching}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#e4e0f5] text-black/60 transition-colors hover:bg-[#f5f3ff] hover:text-[#271173] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Pagina anterior"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToNextPage}
              disabled={!hasNextPage || isFetching}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#e4e0f5] text-black/60 transition-colors hover:bg-[#f5f3ff] hover:text-[#271173] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Pagina siguiente"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className={`${cardClass} overflow-hidden`}>
          {isLoading ? (
            <div className="flex h-32 items-center justify-center gap-2 text-sm text-black/70">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
              Cargando llamadas...
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <ChatBubbleLeftRightIcon className="h-7 w-7 text-black/50" />
              <p className="text-sm text-black/60">Sin llamadas registradas</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e4e0f5]">
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-black/60">
                    ID
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-black/60">
                    Inicio
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-black/60">
                    Duracion
                  </th>
                  {hasMessagesColumn && (
                    <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-black/60">
                      Mensajes
                    </th>
                  )}
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-black/60">
                    Estado
                  </th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e0f5]">
                {conversations.map((conv) => (
                  <tr
                    key={conv.conversation_id}
                    className="cursor-pointer transition-colors hover:bg-[#f5f3ff]"
                    onClick={() => setSelectedConv(conv.conversation_id)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <PhoneIcon className="h-3.5 w-3.5 text-black/60" />
                        <span className="font-mono text-xs text-black/70" title={conv.conversation_id}>
                          {conv.conversation_id.slice(0, 8)}...
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-black/70">
                      {formatDate(conv.start_time_unix_secs)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-sm text-black/70">
                          <ClockIcon className="h-3.5 w-3.5" />
                          {formatDuration(conv.call_duration_secs)}
                        </div>
                        <div className="h-0.5 w-full max-w-30 rounded-full bg-[#271173]/30">
                          <div
                            className="h-full rounded-full bg-[#271173]"
                            style={{
                              width: `${Math.max(
                                4,
                                Math.round(
                                  (((conv.call_duration_secs ?? 0) / maxCallDurationSecs) * 100)
                                )
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    {hasMessagesColumn && (
                      <td className="px-5 py-3.5 text-sm text-black/70">
                        {getConversationMessageCount(conv) ?? '-'}
                      </td>
                    )}
                    <td className="px-5 py-3.5">
                      <StatusBadge status={conv.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <ChevronRightIcon className="inline h-4 w-4 text-black/60" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedConv && (
        <ConversationDetailModal
          conversationId={selectedConv}
          onClose={() => setSelectedConv(null)}
        />
      )}
    </div>
  )
}


