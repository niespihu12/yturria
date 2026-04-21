import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline'
import { getTextAgents, getSofiaErrors, updateSofiaErrorLabel, getSofiaErrorsExportUrl } from '@/api/TextAgentsAPI'
import type { TextAgentSummary, SofiaError, SofiaErrorLabel } from '@/types/textAgent'

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const LABEL_CONFIG = {
  '': { label: 'Sin clasificar', color: 'bg-gray-100 text-gray-600' },
  true_positive: { label: 'Alucinación real', color: 'bg-red-100 text-red-700' },
  false_positive: { label: 'Falso positivo', color: 'bg-green-100 text-green-700' },
} as const

function TranscriptRow({ entry }: { entry: { role: string; message: string } }) {
  const isAI = entry.role === 'assistant'
  return (
    <div className={`flex gap-2 ${isAI ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
          isAI ? 'bg-[#f3f0ff] text-black' : 'bg-[#271173] text-white'
        }`}
      >
        <span className="mb-0.5 block text-[10px] font-semibold opacity-60">
          {isAI ? 'Sofía' : 'Usuario'}
        </span>
        {entry.message}
      </div>
    </div>
  )
}

function ErrorCard({
  error,
  agentId,
  onLabelChange,
}: {
  error: SofiaError
  agentId: string
  onLabelChange: (conversationId: string, label: SofiaErrorLabel) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const labelCfg = LABEL_CONFIG[error.sofia_error_label]

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e4e0f5] bg-white shadow-sm">
      <div
        className="flex cursor-pointer items-center gap-4 px-5 py-4"
        onClick={() => setExpanded(v => !v)}
      >
        <ExclamationTriangleIcon className="h-5 w-5 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-black">
            {error.title || error.conversation_id}
          </p>
          <p className="mt-0.5 text-xs text-black/50">
            {error.created_at_unix_secs ? formatDate(error.created_at_unix_secs) : '—'} · {error.channel}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${labelCfg.color}`}>
          {labelCfg.label}
        </span>
        {expanded ? (
          <ChevronUpIcon className="h-4 w-4 shrink-0 text-black/40" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-black/40" />
        )}
      </div>

      {expanded && (
        <div className="border-t border-[#e4e0f5] px-5 pb-5 pt-4">
          <div className="mb-4 flex max-h-72 flex-col gap-2 overflow-y-auto rounded-xl bg-gray-50 p-3">
            {error.transcript.length === 0 ? (
              <p className="text-center text-xs text-black/40">Sin mensajes</p>
            ) : (
              error.transcript.map((t, i) => <TranscriptRow key={i} entry={t} />)
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="self-center text-xs font-medium text-black/50">Clasificar:</span>
            <button
              onClick={() => onLabelChange(error.conversation_id, 'true_positive')}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                error.sofia_error_label === 'true_positive'
                  ? 'border-red-400 bg-red-50 text-red-700'
                  : 'border-[#e4e0f5] bg-white text-black/60 hover:border-red-300'
              }`}
            >
              <XCircleIcon className="h-3.5 w-3.5" />
              Alucinación real
            </button>
            <button
              onClick={() => onLabelChange(error.conversation_id, 'false_positive')}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                error.sofia_error_label === 'false_positive'
                  ? 'border-green-400 bg-green-50 text-green-700'
                  : 'border-[#e4e0f5] bg-white text-black/60 hover:border-green-300'
              }`}
            >
              <CheckCircleIcon className="h-3.5 w-3.5" />
              Falso positivo
            </button>
            {error.sofia_error_label !== '' && (
              <button
                onClick={() => onLabelChange(error.conversation_id, '')}
                className="rounded-lg border border-[#e4e0f5] px-3 py-1.5 text-xs text-black/40 hover:border-gray-300"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SofiaErrorsView() {
  const queryClient = useQueryClient()
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [labelFilter, setLabelFilter] = useState<SofiaErrorLabel | 'all'>('all')

  const { data: agentsData } = useQuery({
    queryKey: ['text-agents'],
    queryFn: () => getTextAgents({}),
  })
  const agents: TextAgentSummary[] = agentsData?.agents ?? []
  if (!selectedAgentId && agents.length > 0) setSelectedAgentId(agents[0].agent_id)

  const { data, isLoading } = useQuery({
    queryKey: ['sofia-errors', selectedAgentId, labelFilter],
    queryFn: () =>
      getSofiaErrors(selectedAgentId, labelFilter === 'all' ? undefined : labelFilter),
    enabled: !!selectedAgentId,
  })
  const errors: SofiaError[] = data?.sofia_errors ?? []

  const { mutate: setLabel } = useMutation({
    mutationFn: ({ conversationId, label }: { conversationId: string; label: SofiaErrorLabel }) =>
      updateSofiaErrorLabel(selectedAgentId, conversationId, label),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sofia-errors', selectedAgentId] })
      toast.success('Clasificación guardada')
    },
    onError: () => toast.error('Error al guardar clasificación'),
  })

  const handleExport = () => {
    window.open(getSofiaErrorsExportUrl(selectedAgentId), '_blank')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full p-8">
        {/* Header */}
        <section className="section-enter mb-8 overflow-hidden rounded-[28px] border border-[#e4e0f5] bg-white px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#271173]">
                Calidad de IA
              </p>
              <h1 className="mt-2 text-3xl font-bold text-black">Dashboard de Alucinaciones</h1>
              <p className="mt-2 max-w-2xl text-sm text-black/60">
                Conversaciones donde Sofía expresó incertidumbre repetida y fue escalada automáticamente.
                Clasifica cada caso para mejorar el modelo.
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={!selectedAgentId || errors.length === 0}
              className="flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Exportar CSV
            </button>
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

          {(['all', '', 'true_positive', 'false_positive'] as const).map(f => (
            <button
              key={f}
              onClick={() => setLabelFilter(f)}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                labelFilter === f
                  ? 'bg-[#271173] text-white'
                  : 'border border-[#e4e0f5] bg-white text-black/60 hover:border-[#271173]'
              }`}
            >
              {f === 'all' ? 'Todos' : LABEL_CONFIG[f].label}
            </button>
          ))}

          {data && (
            <span className="ml-auto text-sm text-black/40">
              {data.total} {data.total === 1 ? 'resultado' : 'resultados'}
            </span>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
          </div>
        ) : errors.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#e4e0f5]">
            <CheckCircleIcon className="h-8 w-8 text-green-400" />
            <p className="text-sm text-black/40">No hay alucinaciones detectadas</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {errors.map(e => (
              <ErrorCard
                key={e.conversation_id}
                error={e}
                agentId={selectedAgentId}
                onLabelChange={(conversationId, label) => setLabel({ conversationId, label })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
