import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PhoneIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  XCircleIcon,
  MinusCircleIcon,
} from '@heroicons/react/24/outline'
import { getAgents, getConversations } from '@/api/VoiceRuntimeAPI'
import type { Conversation } from '@/types/agent'

// ── Keyword detection ──────────────────────────────────────────────────────────
const KEYWORD_GROUPS = {
  venta: ['contratar', 'quiero el seguro', 'me interesa', 'quiero comprar', 'adquirir', 'cotizar'],
  siniestro: ['accidente', 'siniestro', 'choque', 'robo', 'daño', 'pérdida total'],
  queja: ['queja', 'molesto', 'mal servicio', 'inconformidad', 'reclamo', 'insatisfecho', 'terrible'],
} as const

type KeywordCategory = keyof typeof KEYWORD_GROUPS

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
  positive: { label: 'Positivo', icon: CheckCircleIcon, color: 'text-green-600', bg: 'bg-green-50' },
  neutral: { label: 'Neutral', icon: MinusCircleIcon, color: 'text-gray-500', bg: 'bg-gray-50' },
  negative: { label: 'Negativo', icon: XCircleIcon, color: 'text-red-600', bg: 'bg-red-50' },
}

function formatDuration(secs?: number) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function ConversationRow({ conv }: { conv: Conversation }) {
  const [expanded, setExpanded] = useState(false)
  const sentiment = detectSentiment(conv)
  const { icon: SentimentIcon, color, bg, label } = SENTIMENT_CONFIG[sentiment]
  const transcript = conv.transcript ?? []
  const fullText = transcript.map(t => t.message).join(' ')
  const keywords = detectKeywords(fullText)

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
    <div className="overflow-hidden rounded-2xl border border-[#e4e0f5] bg-white shadow-sm">
      <div
        className="flex cursor-pointer items-center gap-4 px-5 py-4"
        onClick={() => setExpanded(v => !v)}
      >
        <PhoneIcon className="h-5 w-5 shrink-0 text-[#271173]/60" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-black">
            {conv.conversation_id}
          </p>
          <p className="mt-0.5 text-xs text-black/40">
            {formatDate(conv.start_time_unix_secs)} · {formatDuration(conv.call_duration_secs)}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {keywords.map(k => (
            <span
              key={k}
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                k === 'venta' ? 'bg-blue-50 text-blue-700' :
                k === 'siniestro' ? 'bg-amber-50 text-amber-700' :
                'bg-red-50 text-red-700'
              }`}
            >
              {k}
            </span>
          ))}
        </div>

        <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${bg}`}>
          <SentimentIcon className={`h-3.5 w-3.5 ${color}`} />
          <span className={`text-xs font-medium ${color}`}>{label}</span>
        </div>

        {expanded ? (
          <ChevronUpIcon className="h-4 w-4 shrink-0 text-black/30" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-black/30" />
        )}
      </div>

      {expanded && (
        <div className="border-t border-[#e4e0f5] px-5 pb-5 pt-4">
          {conv.analysis?.transcript_summary && (
            <div className="mb-3 rounded-xl bg-[#f8f7ff] p-3">
              <p className="text-xs font-semibold text-[#271173]">Resumen</p>
              <p className="mt-1 text-sm text-black/70">{conv.analysis.transcript_summary}</p>
            </div>
          )}

          <div className="mb-3 max-h-60 overflow-y-auto rounded-xl bg-gray-50 p-3">
            {transcript.length === 0 ? (
              <p className="text-center text-xs text-black/40">Sin transcripción disponible</p>
            ) : (
              <div className="flex flex-col gap-2">
                {transcript.map((t, i) => {
                  const isAgent = t.role === 'agent'
                  return (
                    <div key={i} className={`flex ${isAgent ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-xl px-3 py-1.5 text-xs ${
                        isAgent ? 'bg-[#f3f0ff] text-black' : 'bg-[#271173] text-white'
                      }`}>
                        <span className="mb-0.5 block text-[10px] opacity-60">
                          {isAgent ? 'Agente' : 'Cliente'}
                        </span>
                        {t.message}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <button
            onClick={handleExportTxt}
            className="flex items-center gap-1.5 rounded-lg border border-[#e4e0f5] px-3 py-1.5 text-xs font-medium text-black/60 hover:border-[#271173] hover:text-[#271173]"
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            Exportar TXT
          </button>
        </div>
      )}
    </div>
  )
}

const FILTER_SENTIMENTS = ['all', 'positive', 'neutral', 'negative'] as const
type SentimentFilter = (typeof FILTER_SENTIMENTS)[number]

export default function VoiceAnalyticsView() {
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [search, setSearch] = useState('')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [keywordFilter, setKeywordFilter] = useState<KeywordCategory | 'all'>('all')

  const { data: agentsData } = useQuery({
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full p-8">
        {/* Header */}
        <section className="section-enter mb-8 overflow-hidden rounded-[28px] border border-[#e4e0f5] bg-white px-6 py-6 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#271173]">
              Agentes de Voz
            </p>
            <h1 className="mt-2 text-3xl font-bold text-black">Voice Analytics</h1>
            <p className="mt-2 max-w-2xl text-sm text-black/60">
              Transcripciones de llamadas con análisis de sentimiento y detección de palabras clave.
            </p>
          </div>
        </section>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <select
            value={selectedAgentId}
            onChange={e => setSelectedAgentId(e.target.value)}
            className="rounded-xl border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black focus:border-[#271173] focus:outline-none"
          >
            {agents.map(a => (
              <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
            ))}
          </select>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30" />
            <input
              type="text"
              placeholder="Buscar en transcripciones..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-xl border border-[#e4e0f5] bg-white py-2 pl-9 pr-3 text-sm text-black focus:border-[#271173] focus:outline-none"
            />
          </div>

          <div className="flex gap-1.5">
            {FILTER_SENTIMENTS.map(s => {
              const cfg = s === 'all' ? null : SENTIMENT_CONFIG[s]
              return (
                <button
                  key={s}
                  onClick={() => setSentimentFilter(s)}
                  className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                    sentimentFilter === s
                      ? 'bg-[#271173] text-white'
                      : 'border border-[#e4e0f5] bg-white text-black/60 hover:border-[#271173]'
                  }`}
                >
                  {s === 'all' ? 'Todos' : cfg!.label}
                </button>
              )
            })}
          </div>

          <div className="flex gap-1.5">
            {(['all', 'venta', 'siniestro', 'queja'] as const).map(k => (
              <button
                key={k}
                onClick={() => setKeywordFilter(k)}
                className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors ${
                  keywordFilter === k
                    ? 'bg-[#271173] text-white'
                    : 'border border-[#e4e0f5] bg-white text-black/60 hover:border-[#271173]'
                }`}
              >
                {k === 'all' ? 'Todas' : k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>

          {convData && (
            <span className="ml-auto text-sm text-black/40">
              {filtered.length} de {allConversations.length} llamadas
            </span>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#e4e0f5]">
            <PhoneIcon className="h-8 w-8 text-black/20" />
            <p className="text-sm text-black/40">
              {allConversations.length === 0 ? 'Sin llamadas registradas' : 'No hay resultados para los filtros aplicados'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map(conv => (
              <ConversationRow key={conv.conversation_id} conv={conv} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
