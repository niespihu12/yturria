import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getTextConversationDetail,
  getTextConversations,
} from '@/api/TextAgentsAPI'
import Badge from '@/components/ui/Badge'

type Props = {
  agentId: string
}

type ChannelFilter = 'all' | 'web' | 'whatsapp' | 'embed'

const CHANNEL_LABELS: Record<Exclude<ChannelFilter, 'all'>, string> = {
  web: 'Prueba interna',
  whatsapp: 'WhatsApp',
  embed: 'Sitio web',
}

function formatDate(unix: number) {
  return new Date(unix * 1000).toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TextAgentAnalysisTab({ agentId }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['text-conversations', agentId],
    queryFn: () => getTextConversations(agentId),
  })

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['text-conversation-detail', selectedId],
    queryFn: () => getTextConversationDetail(selectedId!),
    enabled: !!selectedId,
  })

  const allConversations = data?.conversations ?? []
  const conversations =
    channelFilter === 'all'
      ? allConversations
      : allConversations.filter((c) => (c.channel ?? 'web') === channelFilter)

  const counts: Record<ChannelFilter, number> = {
    all: allConversations.length,
    web: allConversations.filter((c) => (c.channel ?? 'web') === 'web').length,
    whatsapp: allConversations.filter((c) => c.channel === 'whatsapp').length,
    embed: allConversations.filter((c) => c.channel === 'embed').length,
  }

  const filters: ChannelFilter[] = ['all', 'embed', 'whatsapp', 'web']

  return (
    <div className="@container space-y-5">
      <div
        role="group"
        aria-label="Filtrar por canal"
        className="no-visible-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-border-default bg-surface-muted p-1"
      >
        {filters.map((filter) => {
          const active = channelFilter === filter
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={active}
              onClick={() => setChannelFilter(filter)}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-surface text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {filter === 'all' ? 'Todas' : CHANNEL_LABELS[filter]}
              <span className="tabular-nums text-text-tertiary">{counts[filter]}</span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border border-border-default bg-surface">
          <h2 className="border-b border-border-default px-4 py-3 text-sm font-semibold text-text-primary">
            Conversaciones
          </h2>

          {isLoading ? (
            <div className="space-y-2 p-4">
              <div className="skeleton h-14" />
              <div className="skeleton h-14" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-tertiary">
              {channelFilter === 'all'
                ? 'Todavía no hay conversaciones con este agente.'
                : `No hay conversaciones por ${CHANNEL_LABELS[channelFilter].toLowerCase()}.`}
            </p>
          ) : (
            <ul className="max-h-130 divide-y divide-border-subtle overflow-y-auto">
              {conversations.map((conv) => {
                const selected = selectedId === conv.conversation_id
                const channel = (conv.channel ?? 'web') as Exclude<ChannelFilter, 'all'>
                return (
                  <li key={conv.conversation_id}>
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => setSelectedId(conv.conversation_id)}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        selected ? 'bg-primary-50' : 'hover:bg-surface-muted'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs tabular-nums text-text-tertiary">
                          {formatDate(conv.start_time_unix_secs)}
                        </span>
                        {channel !== 'web' && (
                          <Badge size="sm" variant={channel === 'whatsapp' ? 'success' : 'info'}>
                            {CHANNEL_LABELS[channel] ?? channel}
                          </Badge>
                        )}
                      </span>
                      <span className="mt-1 line-clamp-2 block text-sm text-text-primary">
                        {conv.last_message_preview || 'Sin mensajes'}
                      </span>
                      <span className="mt-1 block text-xs tabular-nums text-text-tertiary">
                        {conv.message_count} {conv.message_count === 1 ? 'mensaje' : 'mensajes'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-border-default bg-surface">
          <h2 className="border-b border-border-default px-4 py-3 text-sm font-semibold text-text-primary">
            Detalle
          </h2>

          {!selectedId ? (
            <p className="px-4 py-10 text-center text-sm text-text-tertiary">
              Elija una conversación para leerla completa.
            </p>
          ) : loadingDetail ? (
            <div className="space-y-2 p-4">
              <div className="skeleton h-10 w-2/3" />
              <div className="skeleton ml-auto h-10 w-1/2" />
            </div>
          ) : !detail ? (
            <p className="px-4 py-10 text-center text-sm text-text-tertiary">
              No pudimos cargar esta conversación. Intente de nuevo.
            </p>
          ) : (
            <div className="max-h-130 overflow-y-auto">
              {detail.analysis?.transcript_summary && (
                <div className="border-b border-border-subtle bg-surface-muted px-4 py-3">
                  <p className="text-xs font-semibold text-text-tertiary">Resumen</p>
                  <p className="mt-1 text-sm leading-relaxed text-text-primary">
                    {detail.analysis.transcript_summary}
                  </p>
                </div>
              )}

              <div className="space-y-2 px-4 py-4">
                {detail.transcript?.map((item, i) => {
                  const isUser = item.role === 'user'
                  return (
                    <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <p
                        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                          isUser
                            ? 'rounded-br-md bg-primary-700 text-text-inverse'
                            : 'rounded-bl-md border border-border-default bg-surface-muted text-text-primary'
                        }`}
                      >
                        <span className="sr-only">{isUser ? 'Cliente: ' : 'Agente: '}</span>
                        {item.message}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
