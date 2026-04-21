import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { getTextAgents } from '@/api/TextAgentsAPI'
import api from '@/lib/axios'
import type { TextAgentSummary } from '@/types/textAgent'

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

function FunnelStep({
  label,
  value,
  total,
  color,
  isLast,
}: {
  label: string
  value: number
  total: number
  color: string
  isLast?: boolean
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-black/60">{label}</span>
          <span className="text-sm font-bold text-black">{value.toLocaleString('es-CO')}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${color}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-0.5 text-right text-[10px] text-black/30">{pct}% del total</p>
      </div>
      {!isLast && <ArrowRightIcon className="h-4 w-4 shrink-0 text-black/20" />}
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#e4e0f5] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-black/40">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#271173]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-black/40">{sub}</p>}
    </div>
  )
}

export default function ConversionFunnel() {
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [periodDays, setPeriodDays] = useState(30)

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

  const savingsFormatted = metrics
    ? `$${metrics.estimated_savings_cop.toLocaleString('es-CO')}`
    : '—'

  return (
    <div className="rounded-[28px] border border-[#e4e0f5] bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#271173]">
            Analytics
          </p>
          <h2 className="mt-1 text-xl font-bold text-black">Embudo de Conversión</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedAgentId}
            onChange={e => setSelectedAgentId(e.target.value)}
            className="rounded-xl border border-[#e4e0f5] px-3 py-1.5 text-sm text-black focus:border-[#271173] focus:outline-none"
          >
            {agents.map(a => (
              <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
            ))}
          </select>
          <select
            value={periodDays}
            onChange={e => setPeriodDays(Number(e.target.value))}
            className="rounded-xl border border-[#e4e0f5] px-3 py-1.5 text-sm text-black focus:border-[#271173] focus:outline-none"
          >
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
        </div>
      </div>

      {isLoading || !metrics ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Conversión"
              value={`${metrics.conversion_rate_pct}%`}
              sub="conv → cita"
            />
            <MetricCard
              label="Ahorro est."
              value={savingsFormatted}
              sub={`${periodDays} días vs secretaria`}
            />
            <MetricCard
              label="Escalaciones"
              value={String(metrics.escalations_total)}
              sub={`${metrics.escalations_resolved} resueltas`}
            />
            <MetricCard
              label="Citas completadas"
              value={String(metrics.appointments_completed)}
              sub={`de ${metrics.appointments_scheduled} agendadas`}
            />
          </div>

          {/* Funnel steps */}
          <div className="flex flex-col gap-4">
            <FunnelStep
              label="Conversaciones iniciadas"
              value={metrics.conversations_started}
              total={metrics.conversations_started}
              color="bg-[#271173]"
            />
            <FunnelStep
              label="Leads calificados"
              value={metrics.leads_qualified}
              total={metrics.conversations_started}
              color="bg-[#4f3cba]"
            />
            <FunnelStep
              label="Citas agendadas"
              value={metrics.appointments_scheduled}
              total={metrics.conversations_started}
              color="bg-[#7b68d4]"
            />
            <FunnelStep
              label="Citas completadas"
              value={metrics.appointments_completed}
              total={metrics.conversations_started}
              color="bg-emerald-500"
              isLast
            />
          </div>
        </>
      )}
    </div>
  )
}
