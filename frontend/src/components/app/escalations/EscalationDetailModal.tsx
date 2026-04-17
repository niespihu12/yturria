import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { XMarkIcon, CheckIcon } from '@heroicons/react/24/outline'
import { getTextConversationDetail, updateEscalation } from '@/api/TextAgentsAPI'
import type { EscalationStatus } from '@/types/textAgent'

type Props = {
  agentId: string
  conversationId: string
  onClose: () => void
}

export default function EscalationDetailModal({ agentId, conversationId, onClose }: Props) {
  const queryClient = useQueryClient()

  // Load conversation details
  const { data: detail, isLoading } = useQuery({
    queryKey: ['text-conversation-detail', conversationId],
    queryFn: () => getTextConversationDetail(conversationId),
  })

  // Mark as resolved
  const { mutate: resolve, isPending: isResolving } = useMutation({
    mutationFn: (status: EscalationStatus) => updateEscalation(agentId, conversationId, { status }),
    onSuccess: () => {
      toast.success('Escalamiento marcado como resuelto')
      queryClient.invalidateQueries({ queryKey: ['escalations', agentId] })
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e4e0f5] px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-black">Detalle de Conversación</h2>
            <p className="mt-1 text-sm text-black/60 font-mono text-xs">{conversationId}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl p-2 text-black/50 transition-colors hover:bg-[#f5f3ff] hover:text-black"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-2.5 text-black/60">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
                Cargando historial...
              </div>
            </div>
          ) : !detail ? (
            <div className="text-center text-black/60">No se encontraron detalles</div>
          ) : (
            <div className="space-y-4">
              {detail.transcript.length === 0 ? (
                <p className="text-center text-sm text-black/60">Vacio</p>
              ) : (
                detail.transcript.map((msg, idx) => {
                  const isSystem = msg.role === 'system'
                  const isAssistant = msg.role === 'assistant'
                  const isUser = msg.role === 'user'
                  
                  if (isSystem) return null

                  return (
                    <div
                      key={idx}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-5 py-3.5 text-sm shadow-sm ${
                          isUser
                            ? 'bg-[#271173] text-white'
                            : 'bg-white text-black border border-[#e4e0f5]'
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[#e4e0f5] bg-white px-6 py-4 flex items-center justify-between rounded-b-3xl">
          <p className="text-sm text-black/60">
            Una vez que atiendas la solicitud del cliente a través del canal correspondiente, marca este escalamiento como resuelto.
          </p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-xl bg-[#f5f3ff] px-5 py-2.5 text-sm font-semibold text-black/80 transition-colors hover:bg-[#ede9ff]"
            >
              Cerrar
            </button>
            <button
              onClick={() => resolve('resolved')}
              disabled={isResolving || isLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
            >
              {isResolving ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <CheckIcon className="h-4 w-4" />
              )}
              Marcar como resuelto
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
