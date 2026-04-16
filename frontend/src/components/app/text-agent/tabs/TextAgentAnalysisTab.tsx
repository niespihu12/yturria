import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DevicePhoneMobileIcon } from '@heroicons/react/24/outline'
import {
  getTextConversationDetail,
  getTextConversations,
} from '@/api/TextAgentsAPI'

type Props = {
  agentId: string
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
  const [channelFilter, setChannelFilter] = useState<'all' | 'web' | 'whatsapp'>('all')

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

  const webCount = allConversations.filter((c) => (c.channel ?? 'web') === 'web').length
  const waCount = allConversations.filter((c) => c.channel === 'whatsapp').length

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-[#e4e0f5] bg-white px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Total</p>
          <p className="mt-1 text-2xl font-bold text-black">{allConversations.length}</p>
          <p className="text-xs text-black/40">Conversaciones</p>
        </div>
        <div className="rounded-2xl border border-[#e4e0f5] bg-white px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-black/40">Web</p>
          <p className="mt-1 text-2xl font-bold text-[#271173]">{webCount}</p>
          <p className="text-xs text-black/40">Chat interno</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4">
          <div className="flex items-center gap-1.5">
            <DevicePhoneMobileIcon className="h-3.5 w-3.5 text-emerald-600" />
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">WhatsApp</p>
          </div>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{waCount}</p>
          <p className="text-xs text-emerald-600/70">Mensajes recibidos</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-xl border border-[#e4e0f5] bg-[#fafafa] p-1">
        {(['all', 'web', 'whatsapp'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setChannelFilter(f)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              channelFilter === f
                ? 'bg-white text-black shadow-sm'
                : 'text-black/50 hover:text-black/70'
            }`}
          >
            {f === 'all' ? 'Todas' : f === 'web' ? 'Web' : 'WhatsApp'}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Conversations list */}
        <section className="overflow-hidden rounded-2xl border border-[#e4e0f5] bg-white">
          <div className="border-b border-[#e4e0f5] px-4 py-3">
            <h3 className="text-sm font-semibold text-black">Conversaciones</h3>
          </div>

          {isLoading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-black/50">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
              Cargando...
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-black/50">
              No hay conversaciones {channelFilter !== 'all' ? `de ${channelFilter}` : ''} todavía.
            </div>
          ) : (
            <div className="max-h-130 divide-y divide-[#e4e0f5] overflow-y-auto">
              {conversations.map((conv) => {
                const selected = selectedId === conv.conversation_id
                const isWa = conv.channel === 'whatsapp'
                return (
                  <button
                    key={conv.conversation_id}
                    type="button"
                    onClick={() => setSelectedId(conv.conversation_id)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      selected ? 'bg-[#ede9ff]' : 'hover:bg-[#f5f3ff]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] text-black/50">
                        {formatDate(conv.start_time_unix_secs)}
                      </p>
                      {isWa && (
                        <span className="flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                          <DevicePhoneMobileIcon className="h-2.5 w-2.5" />
                          WA
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-black">
                      {conv.last_message_preview || 'Sin preview'}
                    </p>
                    <p className="mt-1 text-[11px] text-black/40">
                      {conv.message_count} mensaje{conv.message_count !== 1 ? 's' : ''}
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {/* Conversation detail */}
        <section className="overflow-hidden rounded-2xl border border-[#e4e0f5] bg-white">
          <div className="border-b border-[#e4e0f5] px-4 py-3">
            <h3 className="text-sm font-semibold text-black">Detalle de conversación</h3>
          </div>

          {!selectedId ? (
            <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-black/50">
              Selecciona una conversación para ver su contenido.
            </div>
          ) : loadingDetail ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-black/50">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
              Cargando...
            </div>
          ) : !detail ? (
            <div className="flex h-40 items-center justify-center text-sm text-black/50">
              No se pudo cargar el detalle.
            </div>
          ) : (
            <div className="max-h-130 overflow-y-auto">
              {detail.analysis?.transcript_summary && (
                <div className="border-b border-[#e4e0f5] bg-[#f5f3ff] px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-black/50">
                    Resumen
                  </p>
                  <p className="mt-1 text-sm text-black">
                    {detail.analysis.transcript_summary}
                  </p>
                </div>
              )}

              <div className="space-y-2 px-4 py-4">
                {detail.transcript?.map((item, i) => {
                  const isUser = item.role === 'user'
                  return (
                    <div
                      key={i}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                          isUser
                            ? 'bg-[#271173] text-white'
                            : 'border border-[#271173]/15 bg-[#f6f4ff] text-black'
                        }`}
                      >
                        {item.message}
                      </div>
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
