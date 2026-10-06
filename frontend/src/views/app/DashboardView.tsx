import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import {
  getAgents,
  getConversations,
  getPhoneNumbers,
} from '@/api/VoiceRuntimeAPI'
import { getTextAgents, getTextConversations, getUpcomingRenewals } from '@/api/TextAgentsAPI'
import type { AgentListItem, Conversation, PhoneNumber } from '@/types/agent'
import type { TextAgentSummary } from '@/types/textAgent'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Skeleton from '@/components/ui/Skeleton'
import SecretaryDashboard, { type DashboardDataset } from '@/components/app/dashboard/SecretaryDashboard'
import SegmentedFilter from '@/components/app/escalations/SegmentedFilter'
import {
  DEFAULT_PERIOD,
  PERIOD_OPTIONS,
  PERIOD_PARAM,
  periodFromParam,
  type DashboardPeriod,
} from '@/lib/dashboardPeriod'

const VOICE_PAGE_SIZE = 100
const VOICE_PAGES_LIMIT = 5

async function getAllVoiceConversations(agentId: string): Promise<Conversation[]> {
  const all: Conversation[] = []
  let cursor: string | null = null

  for (let page = 0; page < VOICE_PAGES_LIMIT; page += 1) {
    const response = await getConversations(agentId, {
      cursor,
      page_size: VOICE_PAGE_SIZE,
    })
    const conversations = Array.isArray(response.conversations)
      ? response.conversations
      : []

    all.push(...conversations)

    const nextCursor = response.next_cursor ?? response.cursor ?? null
    const hasMore =
      typeof response.has_more === 'boolean' ? response.has_more : Boolean(nextCursor)

    if (!hasMore || !nextCursor) {
      break
    }

    cursor = nextCursor
  }

  return all
}

async function fetchDashboardData(): Promise<DashboardDataset> {
  const [voiceAgentsResult, textAgentsResult, phoneNumbersResult] =
    await Promise.allSettled([getAgents(), getTextAgents(), getPhoneNumbers()])

  // Solo es un error si ninguna fuente respondió; una cuenta nueva sin agentes ve el resumen vacío.
  if ([voiceAgentsResult, textAgentsResult, phoneNumbersResult].every((r) => r.status === 'rejected')) {
    throw new Error('No fue posible cargar el resumen')
  }

  const voiceAgents: AgentListItem[] =
    voiceAgentsResult.status === 'fulfilled' &&
    Array.isArray(voiceAgentsResult.value?.agents)
      ? (voiceAgentsResult.value.agents as AgentListItem[])
      : []

  const textAgents: TextAgentSummary[] =
    textAgentsResult.status === 'fulfilled' && Array.isArray(textAgentsResult.value?.agents)
      ? textAgentsResult.value.agents
      : []

  const phoneNumbers: PhoneNumber[] =
    phoneNumbersResult.status === 'fulfilled' && Array.isArray(phoneNumbersResult.value)
      ? phoneNumbersResult.value
      : []

  const [voiceConversationResults, textConversationResults] = await Promise.all([
    Promise.allSettled(
      voiceAgents.map((agent) => getAllVoiceConversations(agent.agent_id))
    ),
    Promise.allSettled(
      textAgents.map((agent) => getTextConversations(agent.agent_id))
    ),
  ])

  const upcomingRenewalsResult = await Promise.allSettled([getUpcomingRenewals(30)])

  const voiceConversations = voiceConversationResults.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )

  const textConversations = textConversationResults.flatMap((result) =>
    result.status === 'fulfilled' && Array.isArray(result.value.conversations)
      ? result.value.conversations
      : []
  )

  const upcomingRenewals = upcomingRenewalsResult.flatMap((result) =>
    result.status === 'fulfilled' && Array.isArray(result.value.renewals)
      ? result.value.renewals
      : []
  )

  return {
    voiceAgents,
    textAgents,
    phoneNumbers,
    voiceConversations,
    textConversations,
    upcomingRenewals,
    loadedAt: Date.now(),
  }
}

function describeLoadTime(loadedAt: number): string {
  const date = new Date(loadedAt)
  const day = date.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  const time = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · Actualizado a las ${time}`
}

function DashboardSkeleton() {
  return (
    <div className="space-y-10" aria-label="Cargando el resumen">
      <div className="rounded-xl border border-border-default bg-surface px-6 py-6">
        <Skeleton height={20} width="45%" />
        <Skeleton className="mt-3" height={14} width="30%" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Skeleton height={220} />
        <Skeleton height={220} />
      </div>
    </div>
  )
}

export default function DashboardView() {
  const { isSuperAdmin } = useCurrentUser()
  const [searchParams, setSearchParams] = useSearchParams()
  const period = periodFromParam(searchParams.get('periodo'))

  const changePeriod = (next: DashboardPeriod) => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        if (next === DEFAULT_PERIOD) params.delete('periodo')
        else params.set('periodo', PERIOD_PARAM[next])
        return params
      },
      { replace: true },
    )
  }

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['dashboard-real-data'],
    queryFn: fetchDashboardData,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Resumen"
          description={
            data
              ? describeLoadTime(data.loadedAt)
              : 'Lo que resolvieron sus agentes y lo que necesita a una persona del equipo.'
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedFilter label="Periodo" options={PERIOD_OPTIONS} value={period} onChange={changePeriod} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                aria-busy={isFetching}
                leftIcon={
                  <ArrowPathIcon
                    aria-hidden="true"
                    className={cn('h-4 w-4', isFetching && 'animate-spin')}
                  />
                }
              >
                Actualizar
              </Button>
            </div>
          }
        />

        {data ? (
          <SecretaryDashboard data={data} isSuperAdmin={isSuperAdmin} period={period} />
        ) : isLoading ? (
          <DashboardSkeleton />
        ) : isError ? (
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border-default bg-surface px-6 py-6">
            <p className="text-sm text-text-primary">
              No pudimos cargar el resumen. Revise su conexión e intente de nuevo.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
