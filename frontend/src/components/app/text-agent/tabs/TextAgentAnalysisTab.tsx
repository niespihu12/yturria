import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['text-conversations', agentId],
    queryFn: () => getTextConversations(agentId),
  })

  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['text-conversation-detail', selectedConversationId],
    queryFn: () => getTextConversationDetail(selectedConversationId!),
    enabled: !!selectedConversationId,
  })

  const conversations = data?.conversations ?? []

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <section className="overflow-hidden rounded-xl border border-[#e4e0f5] bg-white">
        <div className="border-b border-[#e4e0f5] px-4 py-3">
          <h3 className="text-sm font-semibold text-black">Conversaciones</h3>
        </div>

        {isLoading ? (
          <div className="px-4 py-6 text-sm text-black/60">Cargando conversaciones...</div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-6 text-sm text-black/60">Aun no hay conversaciones.</div>
        ) : (
          <div className="divide-y divide-[#e4e0f5]">
            {conversations.map((conversation) => {
              const selected = selectedConversationId === conversation.conversation_id
              return (
                <button
                  key={conversation.conversation_id}
                  type="button"
                  onClick={() => setSelectedConversationId(conversation.conversation_id)}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    selected ? 'bg-[#ede9ff]' : 'hover:bg-[#f5f3ff]'
                  }`}
                >
                  <p className="text-xs text-black/60">{formatDate(conversation.start_time_unix_secs)}</p>
                  <p className="mt-1 text-sm text-black">{conversation.last_message_preview || 'Sin preview'}</p>
                  <p className="mt-1 text-xs text-black/60">
                    Mensajes: {conversation.message_count}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e4e0f5] bg-white">
        <div className="border-b border-[#e4e0f5] px-4 py-3">
          <h3 className="text-sm font-semibold text-black">Detalle</h3>
        </div>

        {!selectedConversationId ? (
          <div className="px-4 py-6 text-sm text-black/60">
            Selecciona una conversación para ver su contenido.
          </div>
        ) : loadingDetail ? (
          <div className="px-4 py-6 text-sm text-black/60">Cargando detalle...</div>
        ) : !detail ? (
          <div className="px-4 py-6 text-sm text-black/60">No se pudo cargar el detalle.</div>
        ) : (
          <div className="space-y-4 px-4 py-4">
            <div className="rounded-lg border border-[#e4e0f5] bg-[#f5f3ff] p-3">
              <p className="text-xs uppercase tracking-wide text-black/60">Resumen</p>
              <p className="mt-2 text-sm text-black">
                {detail.analysis?.transcript_summary || 'Sin resumen disponible.'}
              </p>
            </div>

            <div className="space-y-2">
              {detail.transcript?.map((item, index) => {
                const isUser = item.role === 'user'
                return (
                  <div key={index} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                        isUser
                          ? 'bg-[#271173] text-white'
                          : 'border border-[#271173]/20 bg-[#f6f4ff] text-black'
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
  )
}
