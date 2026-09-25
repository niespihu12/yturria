import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import { getTextAgents, getEscalations } from '@/api/TextAgentsAPI'
import type { TextAgentSummary, EscalatedConversation } from '@/types/textAgent'
import EscalationDetailModal from '@/components/app/escalations/EscalationDetailModal'

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function EscalationsView() {
  const [searchParams] = useSearchParams()
  const scopedUserId = searchParams.get('user_id') || undefined

  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  // Load agents first
  const { data: agentsData, isLoading: isLoadingAgents } = useQuery({
    queryKey: ['text-agents', scopedUserId ?? 'all'],
    queryFn: () => getTextAgents({ userId: scopedUserId }),
  })

  const agents: TextAgentSummary[] = agentsData?.agents ?? []

  // Default select first agent if none selected but agents are loaded
  if (!selectedAgentId && agents.length > 0) {
    setSelectedAgentId(agents[0].agent_id)
  }

  // Load escalations for selected agent
  const { data: escalationsData, isLoading: isLoadingEscalations } = useQuery({
    queryKey: ['escalations', selectedAgentId],
    queryFn: () => getEscalations(selectedAgentId),
    enabled: !!selectedAgentId,
  })

  const escalations: EscalatedConversation[] = escalationsData?.escalations ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full p-8">
        <section className="section-enter mb-8 overflow-hidden rounded-3xl border border-border-default bg-surface px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-600">
                Atención al Cliente
              </p>
              <h1 className="mt-2 text-3xl font-bold text-text-primary">Bandeja de Escalamientos</h1>
              <p className="mt-2 max-w-2xl text-sm text-text-secondary">
                Gestiona las conversaciones que la IA de Sofía no pudo resolver y requieren atención humana.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-text-secondary">Agente de Texto</label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                disabled={isLoadingAgents || agents.length === 0}
                className="min-w-50 rounded-xl border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary transition-colors focus:border-primary-500 focus:outline-none"
              >
                {isLoadingAgents && <option value="">Cargando agentes...</option>}
                {!isLoadingAgents && agents.length === 0 && <option value="">No hay agentes disponibles</option>}
                {agents.map((agent) => (
                  <option key={agent.agent_id} value={agent.agent_id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <div className="mb-5">
          <h2 className="text-lg font-semibold text-text-primary">Notificaciones Pendientes y Resueltas</h2>
        </div>

        <div className="overflow-hidden rounded-3xl border border-border-default bg-surface shadow-sm">
          {!selectedAgentId ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3">
              <p className="text-sm text-text-secondary">Selecciona un agente para ver sus escalamientos</p>
            </div>
          ) : isLoadingEscalations ? (
            <div className="flex h-48 items-center justify-center text-text-secondary">
              <div className="flex items-center gap-2.5">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
                Cargando escalamientos...
              </div>
            </div>
          ) : escalations.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#effcfa]">
                <CheckCircleIcon className="h-6 w-6 text-teal-600" />
              </div>
              <p className="text-sm font-medium text-text-primary">Todo al día</p>
              <p className="text-xs text-text-tertiary">No hay escalamientos pendientes para este agente.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Estado
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Canal
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Razón de Escalamiento
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Fecha de Escalamiento
                  </th>
                  <th className="px-6 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e0f5]">
                {escalations.map((esc) => (
                  <tr
                    key={esc.conversation_id}
                    onClick={() => setSelectedConversationId(esc.conversation_id)}
                    className="group cursor-pointer transition-colors duration-100 hover:bg-primary-50/60"
                  >
                    <td className="px-6 py-4">
                      {esc.escalation_status === 'resolved' ? (
                        <div className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
                          <CheckCircleIcon className="h-3.5 w-3.5" />
                          Resuelto
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                          <ExclamationCircleIcon className="h-3.5 w-3.5" />
                          Pendiente
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex rounded-md bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-600/20">
                        {esc.channel}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-text-primary">
                      {esc.escalation_reason || 'Solicitud de hablar con humano'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-secondary">
                      {esc.escalated_at_unix_secs ? formatDate(esc.escalated_at_unix_secs) : '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedConversationId(esc.conversation_id)
                        }}
                        className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-primary-600 shadow-sm ring-1 ring-inset ring-[#e4e0f5] transition-all hover:bg-primary-50/60"
                      >
                        Ver detalles
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selectedConversationId && selectedAgentId && (
          <EscalationDetailModal
            agentId={selectedAgentId}
            conversationId={selectedConversationId}
            onClose={() => setSelectedConversationId(null)}
          />
        )}
      </div>
    </div>
  )
}
