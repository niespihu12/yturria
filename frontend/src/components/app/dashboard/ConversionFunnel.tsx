import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTextAgents } from '@/api/TextAgentsAPI'
import api from '@/lib/axios'
import type { TextAgentSummary } from '@/types/textAgent'
import Skeleton from '@/components/ui/Skeleton'

type FunnelMetrics = {
  agent_id: string
  period_days: number
  conversations_started: number
  leads_qualified: number
  appointments_scheduled: number
  appointments_completed: number
  escalations_total: number
  escalations_resolved: number
  conversion_rate_pct: number
  estimated_savings_cop: number
}

async function fetchFunnel(agentId: string, periodDays: number): Promise<FunnelMetrics> {
  const { data } = await api.get(`/text-agents/${agentId}/analytics/funnel`, {
    params: { period_days: periodDays },
  })
  return data
}

const SELECT_CLASS =
  'h-10 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary focus-visible:border-primary-600'

function FunnelStep({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-text-primary">{label}</span>
        <span className="tabular-nums text-text-secondary">
          <span className="font-semibold text-text-primary">{value.toLocaleString('es-CO')}</span> · {pct} %
        </span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
      </div>
    </li>
  )
}

export default function ConversionFunnel() {
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [periodDays, setPeriodDays] = useState(30)
  const agentSelectId = useId()
  const periodSelectId = useId()

  const { data: agentsData } = useQuery({
    queryKey: ['text-agents'],
    queryFn: () => getTextAgents({}),
  })
  const agents: TextAgentSummary[] = agentsData?.agents ?? []
  if (!selectedAgentId && agents.length > 0) setSelectedAgentId(agents[0].agent_id)

  const { data: metrics, isLoading } = useQuery({
    queryKey: ['analytics-funnel', selectedAgentId, periodDays],
    queryFn: () => fetchFunnel(selectedAgentId, periodDays),
    enabled: !!selectedAgentId,
  })

  return (
    <section className="rounded-xl border border-border-default bg-surface p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold text-text-primary">De la conversación a la cita</h2>
        <div className="flex flex-wrap gap-2">
          <label htmlFor={agentSelectId} className="sr-only">Agente</label>
          <select
            id={agentSelectId}
            value={selectedAgentId}
            onChange={e => setSelectedAgentId(e.target.value)}
            className={SELECT_CLASS}
          >
            {agents.map(a => (
              <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
            ))}
          </select>
          <label htmlFor={periodSelectId} className="sr-only">Periodo</label>
          <select
            id={periodSelectId}
            value={periodDays}
            onChange={e => setPeriodDays(Number(e.target.value))}
            className={SELECT_CLASS}
          >
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
        </div>
      </div>

      {isLoading || !metrics ? (
        <div className="space-y-3">
          <Skeleton height={16} width="60%" />
          <Skeleton height={16} width="45%" />
          <Skeleton height={16} width="50%" />
        </div>
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 border-b border-border-subtle pb-5 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-text-secondary">Conversión a cita</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">{metrics.conversion_rate_pct} %</dd>
            </div>
            <div>
              <dt className="text-sm text-text-secondary">Ahorro estimado</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
                ${metrics.estimated_savings_cop.toLocaleString('es-CO')}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-secondary">Pasaron a una persona</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
                {metrics.escalations_total}
                <span className="ml-1 text-sm font-normal text-text-secondary">{metrics.escalations_resolved} resueltas</span>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-secondary">Citas cumplidas</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
                {metrics.appointments_completed}
                <span className="ml-1 text-sm font-normal text-text-secondary">de {metrics.appointments_scheduled}</span>
              </dd>
            </div>
          </dl>

          <ol className="space-y-4">
            <FunnelStep label="Conversaciones iniciadas" value={metrics.conversations_started} total={metrics.conversations_started} />
            <FunnelStep label="Clientes interesados" value={metrics.leads_qualified} total={metrics.conversations_started} />
            <FunnelStep label="Citas agendadas" value={metrics.appointments_scheduled} total={metrics.conversations_started} />
            <FunnelStep label="Citas cumplidas" value={metrics.appointments_completed} total={metrics.conversations_started} />
          </ol>
        </>
      )}
    </section>
  )
}
