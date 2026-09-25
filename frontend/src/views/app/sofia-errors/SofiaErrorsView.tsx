import { useId, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { ArrowDownTrayIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { getTextAgents, getSofiaErrors, updateSofiaErrorLabel, downloadSofiaErrorsCsv } from '@/api/TextAgentsAPI'
import type { TextAgentSummary, SofiaError, SofiaErrorLabel } from '@/types/textAgent'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Skeleton from '@/components/ui/Skeleton'
import SegmentedFilter from '@/components/app/escalations/SegmentedFilter'
import { cn } from '@/lib/utils'
import { channelLabel, formatPhone, phoneFromTitle } from '@/lib/escalations'

type LabelFilter = SofiaErrorLabel | 'all'

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const LABEL_CONFIG: Record<SofiaErrorLabel, { label: string; badge: string }> = {
  '': { label: 'Sin revisar', badge: 'bg-neutral-100 text-text-secondary ring-border-default' },
  true_positive: { label: 'Error confirmado', badge: 'bg-warning-50 text-warning-700 ring-warning-500/30' },
  false_positive: { label: 'Respuesta correcta', badge: 'bg-success-50 text-success-700 ring-success-500/25' },
}

const FILTER_OPTIONS: Array<{ value: LabelFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: '', label: 'Sin revisar' },
  { value: 'true_positive', label: 'Error confirmado' },
  { value: 'false_positive', label: 'Respuesta correcta' },
]

function conversationTitle(error: SofiaError): string {
  const phone = phoneFromTitle(error.title)
  if (phone) return `${formatPhone(phone)} · WhatsApp`
  return error.title?.trim() || 'Conversación sin título'
}

function TranscriptRow({ entry }: { entry: { role: string; message: string } }) {
  const isAI = entry.role === 'assistant'
  return (
    <li className={cn('flex', isAI ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-xl border px-3.5 py-2 text-sm leading-relaxed sm:max-w-[75%]',
          isAI ? 'border-primary-100 bg-primary-50 text-text-primary' : 'border-border-default bg-surface text-text-primary',
        )}
      >
        <span className="mb-0.5 block text-xs font-medium text-text-tertiary">{isAI ? 'Sofía' : 'Cliente'}</span>
        <span className="whitespace-pre-wrap">{entry.message}</span>
      </div>
    </li>
  )
}

function ErrorItem({
  error,
  onLabelChange,
}: {
  error: SofiaError
  onLabelChange: (conversationId: string, label: SofiaErrorLabel) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const labelCfg = LABEL_CONFIG[error.sofia_error_label] ?? LABEL_CONFIG['']
  const when = error.escalated_at_unix_secs || error.created_at_unix_secs

  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-offset-[-2px]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text-primary">{conversationTitle(error)}</span>
          <span className="mt-0.5 block text-xs text-text-tertiary">
            {when ? formatDate(when) : 'Sin fecha'} · {channelLabel(error.channel)}
          </span>
        </span>
        <span className={cn('inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', labelCfg.badge)}>
          {labelCfg.label}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('mt-0.5 h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border-subtle bg-surface-muted px-5 pb-5 pt-4">
          {error.transcript.length === 0 ? (
            <p className="text-sm text-text-secondary">Esta conversación no tiene mensajes.</p>
          ) : (
            <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {error.transcript.map((entry, index) => (
                <TranscriptRow key={index} entry={entry} />
              ))}
            </ol>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-secondary">¿La respuesta de Sofía fue correcta?</span>
            <Button
              size="sm"
              variant={error.sofia_error_label === 'false_positive' ? 'secondary' : 'outline'}
              aria-pressed={error.sofia_error_label === 'false_positive'}
              onClick={() => onLabelChange(error.conversation_id, 'false_positive')}
            >
              Sí, era correcta
            </Button>
            <Button
              size="sm"
              variant={error.sofia_error_label === 'true_positive' ? 'secondary' : 'outline'}
              aria-pressed={error.sofia_error_label === 'true_positive'}
              onClick={() => onLabelChange(error.conversation_id, 'true_positive')}
            >
              No, tenía un error
            </Button>
            {error.sofia_error_label !== '' && (
              <Button size="sm" variant="ghost" onClick={() => onLabelChange(error.conversation_id, '')}>
                Quitar clasificación
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export default function SofiaErrorsView() {
  const queryClient = useQueryClient()
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [labelFilter, setLabelFilter] = useState<LabelFilter>('all')
  const agentSelectId = useId()

  const { data: agentsData, isLoading: isLoadingAgents } = useQuery({
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
    onError: () => toast.error('No se pudo guardar la clasificación. Intente de nuevo.'),
  })

  const handleExport = () => {
    downloadSofiaErrorsCsv(selectedAgentId).catch((error: Error) => toast.error(error.message))
  }

  const emptyMessage =
    labelFilter === 'all'
      ? 'No hay respuestas por revisar. Cuando Sofía no esté segura de una respuesta y pase la conversación a una persona, aparecerá aquí.'
      : `No hay conversaciones con la clasificación “${LABEL_CONFIG[labelFilter].label}”.`

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Respuestas por revisar"
          description="Conversaciones en las que Sofía no estaba segura de la respuesta y pasó el caso a una persona. Revise cada una e indique si la respuesta fue correcta; así sabrá qué información reforzar."
          actions={
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={!selectedAgentId}
              leftIcon={<ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />}
            >
              Exportar CSV
            </Button>
          }
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-2">
            <label htmlFor={agentSelectId} className="text-sm font-medium text-text-secondary">
              Agente
            </label>
            <select
              id={agentSelectId}
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              disabled={isLoadingAgents || agents.length === 0}
              className="h-10 min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary focus-visible:border-primary-600 disabled:opacity-60 sm:w-60 sm:flex-none"
            >
              {isLoadingAgents && <option value="">Cargando agentes…</option>}
              {!isLoadingAgents && agents.length === 0 && <option value="">Sin agentes de texto</option>}
              {agents.map((agent) => (
                <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>
              ))}
            </select>
          </div>

          <SegmentedFilter
            label="Clasificación"
            value={labelFilter}
            onChange={setLabelFilter}
            options={FILTER_OPTIONS}
          />

          {data && (
            <span className="text-sm tabular-nums text-text-tertiary sm:ml-auto">
              {data.total} {data.total === 1 ? 'conversación' : 'conversaciones'}
            </span>
          )}
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="space-y-4 rounded-xl border border-border-default bg-surface p-5" aria-label="Cargando conversaciones">
              <Skeleton height={16} width="55%" />
              <Skeleton height={16} width="45%" />
              <Skeleton height={16} width="50%" />
            </div>
          ) : errors.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong px-5 py-12 text-center text-sm text-text-secondary">
              {!isLoadingAgents && agents.length === 0
                ? 'Todavía no tiene agentes de texto.'
                : emptyMessage}
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-default bg-surface">
              {errors.map((error) => (
                <ErrorItem
                  key={error.conversation_id}
                  error={error}
                  onLabelChange={(conversationId, label) => setLabel({ conversationId, label })}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
