import { useCallback, useId, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { ChevronRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { getTextAgents, getEscalations } from '@/api/TextAgentsAPI'
import type { TextAgentSummary } from '@/types/textAgent'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Skeleton from '@/components/ui/Skeleton'
import EscalationDetailModal from '@/components/app/escalations/EscalationDetailModal'
import EscalationStatusBadge from '@/components/app/escalations/EscalationStatusBadge'
import SegmentedFilter from '@/components/app/escalations/SegmentedFilter'
import {
  ESCALATION_QUERY_PARAMS,
  channelLabel,
  customerLabel,
  describeEscalationReason,
  formatDateTime,
  formatPhone,
  isOpenEscalation,
  phoneFromTitle,
  timeAgo,
  useNow,
  type EscalationRow,
} from '@/lib/escalations'

type StatusFilter = 'open' | 'resolved'

const GRID_COLUMNS = 'md:grid md:grid-cols-[minmax(0,1fr)_12rem_8rem_7rem_1rem] md:items-center md:gap-6'

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

function snippetOf(row: EscalationRow): string {
  const text = (row.last_user_message || row.title || '').trim()
  if (!text || /^whatsapp:/i.test(text)) return 'Sin mensajes del cliente'
  return `“${text}”`
}

export default function EscalationsView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const scopedUserId = searchParams.get('user_id') || undefined
  const requestedAgentId = searchParams.get(ESCALATION_QUERY_PARAMS.agent) || ''
  const requestedConversationId = searchParams.get(ESCALATION_QUERY_PARAMS.conversation)

  const [selectedAgentId, setSelectedAgentId] = useState<string>(requestedAgentId)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    requestedConversationId,
  )
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [search, setSearch] = useState('')
  const [syncedParams, setSyncedParams] = useState(searchParams.toString())
  const now = useNow()
  const agentSelectId = useId()
  const searchId = useId()

  // Un enlace nuevo a la bandeja (p. ej. desde el resumen) abre la conversación indicada.
  if (searchParams.toString() !== syncedParams) {
    setSyncedParams(searchParams.toString())
    if (requestedAgentId) setSelectedAgentId(requestedAgentId)
    setSelectedConversationId(requestedConversationId)
  }

  const { data: agentsData, isLoading: isLoadingAgents } = useQuery({
    queryKey: ['text-agents', scopedUserId ?? 'all'],
    queryFn: () => getTextAgents({ userId: scopedUserId }),
  })

  const agents: TextAgentSummary[] = agentsData?.agents ?? []

  // Pendientes por agente (comparten caché con la lista del agente seleccionado), para
  // abrir la bandeja en el agente que tiene personas esperando y mostrarlo en el selector.
  const countedAgents = agents.slice(0, 10)
  const pendingQueries = useQueries({
    queries: countedAgents.map((agent) => ({
      queryKey: ['escalations', agent.agent_id],
      queryFn: () => getEscalations(agent.agent_id),
      staleTime: 30_000,
    })),
  })
  const pendingByAgent = new Map(
    countedAgents.map((agent, index) => [
      agent.agent_id,
      ((pendingQueries[index]?.data?.escalations ?? []) as EscalationRow[]).filter((row) =>
        isOpenEscalation(row.escalation_status),
      ).length,
    ]),
  )
  const pendingCountsReady = pendingQueries.every((query) => !query.isLoading)

  if (!selectedAgentId && agents.length > 0 && pendingCountsReady) {
    const withPending = agents.find((agent) => (pendingByAgent.get(agent.agent_id) ?? 0) > 0)
    setSelectedAgentId((withPending ?? agents[0]).agent_id)
  }

  const {
    data: escalationsData,
    isLoading: isLoadingEscalations,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['escalations', selectedAgentId],
    queryFn: () => getEscalations(selectedAgentId),
    enabled: !!selectedAgentId,
  })

  const escalations = (escalationsData?.escalations ?? []) as EscalationRow[]
  const openRows = escalations
    .filter((row) => isOpenEscalation(row.escalation_status))
    .sort((a, b) => (a.escalated_at_unix_secs || 0) - (b.escalated_at_unix_secs || 0))
  const resolvedRows = escalations
    .filter((row) => !isOpenEscalation(row.escalation_status))
    .sort((a, b) => (b.escalated_at_unix_secs || 0) - (a.escalated_at_unix_secs || 0))

  const query = normalize(search.trim())
  const visibleRows = (statusFilter === 'open' ? openRows : resolvedRows).filter((row) => {
    if (!query) return true
    const phone = phoneFromTitle(row.title)
    const haystack = normalize(
      [
        row.title,
        row.last_user_message,
        describeEscalationReason(row.escalation_reason),
        channelLabel(row.channel),
        phone ?? '',
        phone ? formatPhone(phone) : '',
      ].join(' '),
    )
    return haystack.includes(query)
  })

  const selectedRow = escalations.find((row) => row.conversation_id === selectedConversationId)

  const closeDetail = useCallback(() => {
    setSelectedConversationId(null)
    setSearchParams(
      (previous) => {
        if (!previous.has(ESCALATION_QUERY_PARAMS.conversation)) return previous
        const next = new URLSearchParams(previous)
        next.delete(ESCALATION_QUERY_PARAMS.conversation)
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  const handleAgentChange = (agentId: string) => {
    setSelectedAgentId(agentId)
    if (searchParams.has(ESCALATION_QUERY_PARAMS.agent)) {
      const next = new URLSearchParams(searchParams)
      next.delete(ESCALATION_QUERY_PARAMS.agent)
      setSearchParams(next, { replace: true })
    }
  }

  const emptyMessage = query
    ? 'Ninguna conversación coincide con su búsqueda.'
    : statusFilter === 'open'
      ? 'Nadie está esperando. Cuando un agente pase una conversación a una persona del equipo, aparecerá aquí.'
      : 'Todavía no hay conversaciones resueltas.'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Bandeja de atención"
          description="Conversaciones que los agentes pasaron a una persona del equipo. Contacte al cliente y marque la conversación como resuelta."
          actions={
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <label htmlFor={agentSelectId} className="text-sm font-medium text-text-secondary">
                Agente
              </label>
              <select
                id={agentSelectId}
                value={selectedAgentId}
                onChange={(event) => handleAgentChange(event.target.value)}
                disabled={isLoadingAgents || agents.length === 0}
                className="h-10 min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary transition-colors focus-visible:border-primary-600 disabled:opacity-60 sm:w-64 sm:flex-none"
              >
                {isLoadingAgents && <option value="">Cargando agentes…</option>}
                {!isLoadingAgents && agents.length === 0 && <option value="">Sin agentes de texto</option>}
                {agents.map((agent) => {
                  const pending = pendingByAgent.get(agent.agent_id) ?? 0
                  return (
                    <option key={agent.agent_id} value={agent.agent_id}>
                      {pending > 0
                        ? `${agent.name} · ${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}`
                        : agent.name}
                    </option>
                  )
                })}
              </select>
            </div>
          }
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedFilter
            label="Estado de la conversación"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'open', label: 'Pendientes', count: openRows.length },
              { value: 'resolved', label: 'Resueltas', count: resolvedRows.length },
            ]}
          />
          <div className="relative w-full sm:max-w-xs">
            <label htmlFor={searchId} className="sr-only">
              Buscar en la bandeja
            </label>
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
            />
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por mensaje, motivo o teléfono"
              className="h-10 w-full rounded-lg border border-border-default bg-surface pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:border-primary-600"
            />
          </div>
        </div>

        <div className="mt-4">
          {!isLoadingAgents && agents.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center text-sm text-text-secondary">
              Todavía no tiene agentes de texto. Cuando cree uno, las conversaciones que pasen a una
              persona aparecerán aquí.
            </p>
          ) : isLoadingAgents || isLoadingEscalations ? (
            <div className="space-y-3 rounded-xl border border-border-default bg-surface p-5" aria-label="Cargando la bandeja">
              {[0, 1, 2].map((item) => (
                <div key={item} className="flex items-center gap-6">
                  <div className="flex-1 space-y-2">
                    <Skeleton height={14} width="40%" />
                    <Skeleton height={12} width="75%" />
                  </div>
                  <Skeleton height={20} width={88} />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-border-default bg-surface px-5 py-6">
              <p className="text-sm text-text-primary">No se pudo cargar la bandeja.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Reintentar
              </Button>
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-5 py-12 text-center">
              <p className="max-w-[48ch] text-sm text-text-secondary">{emptyMessage}</p>
              {query && (
                <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
                  Limpiar búsqueda
                </Button>
              )}
            </div>
          ) : (
            <div className="md:overflow-hidden md:rounded-xl md:border md:border-border-default md:bg-surface">
              <div
                aria-hidden="true"
                className={`hidden border-b border-border-default px-5 py-2.5 text-xs font-medium text-text-tertiary ${GRID_COLUMNS}`}
              >
                <span>Cliente</span>
                <span>Motivo</span>
                <span>Recibida</span>
                <span>Estado</span>
                <span />
              </div>
              <ul className="space-y-3 md:space-y-0 md:divide-y md:divide-border-subtle">
                {visibleRows.map((row) => {
                  const phone = phoneFromTitle(row.title)
                  const identity = phone
                    ? `${customerLabel(row.channel, phone)} · ${channelLabel(row.channel)}`
                    : customerLabel(row.channel, null)
                  const reason = describeEscalationReason(row.escalation_reason)
                  const waited = timeAgo(row.escalated_at_unix_secs, now)
                  return (
                    <li
                      key={row.conversation_id}
                      className="overflow-hidden rounded-xl border border-border-default bg-surface md:rounded-none md:border-0 md:bg-transparent"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedConversationId(row.conversation_id)}
                        className={`group w-full px-4 py-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-offset-[-2px] md:px-5 ${GRID_COLUMNS}`}
                      >
                        <span className="block min-w-0">
                          <span className="flex items-start justify-between gap-3">
                            <span className="block truncate text-sm font-semibold tabular-nums text-text-primary">
                              {identity}
                            </span>
                            <EscalationStatusBadge status={row.escalation_status} className="md:hidden" />
                          </span>
                          <span className="mt-0.5 line-clamp-2 text-sm text-text-secondary md:line-clamp-1">
                            {snippetOf(row)}
                          </span>
                          <span className="mt-2 block text-xs text-text-tertiary md:hidden">
                            {reason} · {waited}
                          </span>
                        </span>
                        <span className="hidden text-sm text-text-primary md:block">{reason}</span>
                        <span
                          className="hidden text-sm tabular-nums text-text-secondary md:block"
                          title={formatDateTime(row.escalated_at_unix_secs)}
                        >
                          {waited}
                        </span>
                        <span className="hidden md:block">
                          <EscalationStatusBadge status={row.escalation_status} />
                        </span>
                        <ChevronRightIcon
                          aria-hidden="true"
                          className="hidden h-4 w-4 text-text-muted transition-colors group-hover:text-text-secondary md:block"
                        />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        {selectedConversationId && selectedAgentId && (
          <EscalationDetailModal
            agentId={selectedAgentId}
            conversationId={selectedConversationId}
            escalation={selectedRow}
            onClose={closeDetail}
          />
        )}
      </div>
    </div>
  )
}
