import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ArrowDownTrayIcon,
  FaceSmileIcon,
  FaceFrownIcon,
  MinusCircleIcon,
} from '@heroicons/react/24/outline'
import { getAgents, getConversations } from '@/api/VoiceRuntimeAPI'
import type { Conversation } from '@/types/agent'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Skeleton from '@/components/ui/Skeleton'
import SegmentedFilter from '@/components/app/escalations/SegmentedFilter'
import { cn } from '@/lib/utils'

// ── Detección de temas ──────────────────────────────────────────────────────────
const KEYWORD_GROUPS = {
  venta: ['contratar', 'quiero el seguro', 'me interesa', 'quiero comprar', 'adquirir', 'cotizar'],
  siniestro: ['accidente', 'siniestro', 'choque', 'robo', 'daño', 'pérdida total'],
  queja: ['queja', 'molesto', 'mal servicio', 'inconformidad', 'reclamo', 'insatisfecho', 'terrible'],
} as const

type KeywordCategory = keyof typeof KEYWORD_GROUPS

const TOPIC_LABELS: Record<KeywordCategory, string> = {
  venta: 'Interés de compra',
  siniestro: 'Siniestro',
  queja: 'Queja',
}

function detectKeywords(transcript: string): KeywordCategory[] {
  const lower = transcript.toLowerCase()
  return (Object.keys(KEYWORD_GROUPS) as KeywordCategory[]).filter(cat =>
    KEYWORD_GROUPS[cat].some(kw => lower.includes(kw))
  )
}

function detectSentiment(conv: Conversation): 'positive' | 'neutral' | 'negative' {
  const summary = (conv.analysis?.transcript_summary || '').toLowerCase()
  const success = conv.analysis?.call_successful

  if (success === 'true' || success === 'success') return 'positive'
  if (success === 'false' || success === 'failure') return 'negative'

  const positiveWords = ['satisfecho', 'gracias', 'excelente', 'perfecto', 'interesado', 'contrató']
  const negativeWords = ['molesto', 'queja', 'insatisfecho', 'problema', 'mal', 'terrible']

  const posCount = positiveWords.filter(w => summary.includes(w)).length
  const negCount = negativeWords.filter(w => summary.includes(w)).length

  if (posCount > negCount) return 'positive'
  if (negCount > posCount) return 'negative'
  return 'neutral'
}

const SENTIMENT_CONFIG = {
  positive: { label: 'Positiva', filterLabel: 'Positivas', icon: FaceSmileIcon, color: 'text-success-700' },
  neutral: { label: 'Neutra', filterLabel: 'Neutras', icon: MinusCircleIcon, color: 'text-text-tertiary' },
  negative: { label: 'Negativa', filterLabel: 'Negativas', icon: FaceFrownIcon, color: 'text-warning-700' },
}

function formatDuration(secs?: number) {
  if (!secs) return 'Sin duración'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')} min`
}

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function ConversationItem({ conv }: { conv: Conversation }) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const sentiment = detectSentiment(conv)
  const { icon: SentimentIcon, color, label } = SENTIMENT_CONFIG[sentiment]
  const transcript = conv.transcript ?? []
  const fullText = transcript.map(t => t.message).join(' ')
  const keywords = detectKeywords(fullText)
  const summary = conv.analysis?.transcript_summary?.trim()

  const handleExportTxt = () => {
    const content = transcript.map(t => `[${t.role}] ${t.message}`).join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transcripcion_${conv.conversation_id}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(v => !v)}
        className="flex w-full flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-offset-[-2px] sm:flex-nowrap"
      >
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <span className="block text-sm font-semibold tabular-nums text-text-primary">
            Llamada del {formatDate(conv.start_time_unix_secs)}
          </span>
          <span className="mt-0.5 block truncate text-sm text-text-secondary">
            {summary || 'Sin resumen de la llamada'}
          </span>
          <span className="mt-1 block text-xs tabular-nums text-text-tertiary">
            {formatDuration(conv.call_duration_secs)}
          </span>
        </span>

        {keywords.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {keywords.map(k => (
              <span
                key={k}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-text-secondary"
              >
                {TOPIC_LABELS[k]}
              </span>
            ))}
          </span>
        )}

        <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-medium', color)}>
          <SentimentIcon className="h-4 w-4" aria-hidden="true" />
          {label}
        </span>

        <ChevronDownIcon
          aria-hidden="true"
          className={cn('mt-0.5 h-4 w-4 shrink-0 text-text-muted transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border-subtle bg-surface-muted px-5 pb-5 pt-4">
          {transcript.length === 0 ? (
            <p className="text-sm text-text-secondary">Esta llamada no tiene transcripción.</p>
          ) : (
            <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {transcript.map((t, i) => {
                const isAgent = t.role === 'agent'
                return (
                  <li key={i} className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[85%] rounded-xl border px-3.5 py-2 text-sm leading-relaxed sm:max-w-[75%]',
                        isAgent
                          ? 'border-primary-100 bg-primary-50 text-text-primary'
                          : 'border-border-default bg-surface text-text-primary',
                      )}
                    >
                      <span className="mb-0.5 block text-xs font-medium text-text-tertiary">
                        {isAgent ? 'Agente' : 'Cliente'}
                      </span>
                      {t.message}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}

          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={handleExportTxt}
            disabled={transcript.length === 0}
            leftIcon={<ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />}
          >
            Descargar transcripción
          </Button>
        </div>
      )}
    </li>
  )
}

const FILTER_SENTIMENTS = ['all', 'positive', 'neutral', 'negative'] as const
type SentimentFilter = (typeof FILTER_SENTIMENTS)[number]

export default function VoiceAnalyticsView() {
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [search, setSearch] = useState('')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [keywordFilter, setKeywordFilter] = useState<KeywordCategory | 'all'>('all')
  const agentSelectId = useId()
  const searchId = useId()

  const { data: agentsData, isLoading: isLoadingAgents } = useQuery({
    queryKey: ['voice-agents'],
    queryFn: () => getAgents(),
  })
  const agents = agentsData?.agents ?? []
  if (!selectedAgentId && agents.length > 0) setSelectedAgentId(agents[0].agent_id)

  const { data: convData, isLoading } = useQuery({
    queryKey: ['voice-conversations', selectedAgentId],
    queryFn: () => getConversations(selectedAgentId, { page_size: 100 }),
    enabled: !!selectedAgentId,
  })
  const allConversations: Conversation[] = convData?.conversations ?? []

  const filtered = allConversations.filter(conv => {
    const fullText = (conv.transcript ?? []).map(t => t.message).join(' ').toLowerCase()
    const sentiment = detectSentiment(conv)
    const keywords = detectKeywords(fullText + ' ' + (conv.analysis?.transcript_summary || ''))

    if (sentimentFilter !== 'all' && sentiment !== sentimentFilter) return false
    if (keywordFilter !== 'all' && !keywords.includes(keywordFilter)) return false
    if (search && !fullText.includes(search.toLowerCase()) &&
        !conv.conversation_id.includes(search)) return false
    return true
  })

  const hasFilters = search !== '' || sentimentFilter !== 'all' || keywordFilter !== 'all'
  const clearFilters = () => {
    setSearch('')
    setSentimentFilter('all')
    setKeywordFilter('all')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Análisis de llamadas"
          description="Transcripciones de las llamadas de sus agentes de voz, con el tono de cada conversación y los temas que mencionó el cliente."
        />

        <div className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <label htmlFor={agentSelectId} className="text-sm font-medium text-text-secondary">
                Agente
              </label>
              <select
                id={agentSelectId}
                value={selectedAgentId}
                onChange={e => setSelectedAgentId(e.target.value)}
                disabled={isLoadingAgents || agents.length === 0}
                className="h-10 min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary focus-visible:border-primary-600 disabled:opacity-60 sm:w-60 sm:flex-none"
              >
                {isLoadingAgents && <option value="">Cargando agentes…</option>}
                {!isLoadingAgents && agents.length === 0 && <option value="">Sin agentes de voz</option>}
                {agents.map(a => (
                  <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div className="relative w-full sm:max-w-sm sm:flex-1">
              <label htmlFor={searchId} className="sr-only">Buscar en las transcripciones</label>
              <MagnifyingGlassIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              />
              <input
                id={searchId}
                type="search"
                placeholder="Buscar en las transcripciones"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-10 w-full rounded-lg border border-border-default bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-primary-600"
              />
            </div>

            {convData && (
              <span className="text-sm tabular-nums text-text-tertiary sm:ml-auto">
                {filtered.length} de {allConversations.length} llamadas
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <SegmentedFilter
              label="Tono de la llamada"
              value={sentimentFilter}
              onChange={setSentimentFilter}
              options={FILTER_SENTIMENTS.map(s => ({
                value: s,
                label: s === 'all' ? 'Todas' : SENTIMENT_CONFIG[s].filterLabel,
              }))}
            />
            <SegmentedFilter
              label="Tema"
              value={keywordFilter}
              onChange={setKeywordFilter}
              options={[
                { value: 'all' as const, label: 'Todos los temas' },
                ...(Object.keys(TOPIC_LABELS) as KeywordCategory[]).map(k => ({ value: k, label: TOPIC_LABELS[k] })),
              ]}
            />
          </div>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="space-y-4 rounded-xl border border-border-default bg-surface p-5" aria-label="Cargando llamadas">
              <Skeleton height={16} width="50%" />
              <Skeleton height={16} width="40%" />
              <Skeleton height={16} width="45%" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-5 py-12 text-center">
              <p className="max-w-[52ch] text-sm text-text-secondary">
                {!isLoadingAgents && agents.length === 0
                  ? 'Todavía no tiene agentes de voz. Cuando cree uno, sus llamadas aparecerán aquí.'
                  : allConversations.length === 0
                    ? 'Este agente aún no tiene llamadas registradas.'
                    : 'Ninguna llamada coincide con los filtros.'}
              </p>
              {hasFilters && allConversations.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Quitar filtros
                </Button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-default bg-surface">
              {filtered.map(conv => (
                <ConversationItem key={conv.conversation_id} conv={conv} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
