import { useMemo, useState } from 'react'
import { ChatBubbleLeftRightIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline'
import { chatWithTextAgent } from '@/api/TextAgentsAPI'

type PreviewMessage = {
  role: 'user' | 'assistant'
  content: string
}

type Props = {
  agentId: string
  agentName: string
  welcomeMessage: string
  isDirty: boolean
  onSave: () => Promise<void>
}

export default function TextAgentPreview({
  agentId,
  agentName,
  welcomeMessage,
  isDirty,
  onSave,
}: Props) {
  const [messages, setMessages] = useState<PreviewMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')

  const visibleMessages = useMemo(() => {
    if (!messages.length && welcomeMessage.trim()) {
      return [{ role: 'assistant' as const, content: welcomeMessage.trim() }]
    }
    return messages
  }, [messages, welcomeMessage])

  const handleSend = async () => {
    if (!input.trim() || isSending) return

    const userMessage = input.trim()
    setInput('')
    setError('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setIsSending(true)

    try {
      if (isDirty) {
        await onSave()
      }

      const response = await chatWithTextAgent(agentId, {
        message: userMessage,
        conversation_id: conversationId ?? undefined,
      })

      setConversationId(response.conversation_id)
      setMessages((prev) => [...prev, { role: 'assistant', content: response.response }])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo enviar el mensaje'
      setError(message)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="w-80 shrink-0 border-l border-[#e4e0f5] bg-white">
      <div className="border-b border-[#e4e0f5] px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-black/60">Vista previa</p>
        <p className="mt-0.5 truncate text-sm text-black/85">{agentName}</p>
      </div>

      <div className="flex h-[calc(100%-70px)] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {visibleMessages.length === 0 ? (
            <div className="rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-4 text-sm text-black/60">
              Escribe un mensaje para probar el agente de texto.
            </div>
          ) : (
            visibleMessages.map((message, index) => {
              const isUser = message.role === 'user'
              return (
                <div key={`${message.role}-${index}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-[#271173] text-white'
                        : 'border border-[#271173]/20 bg-[#f6f4ff] text-black'
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="border-t border-[#e4e0f5] p-4">
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}

          <div className="space-y-2">
            <div className="relative">
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Escribe un mensaje..."
                className="w-full rounded-xl border border-[#271173]/20 bg-white py-2 pl-3 pr-10 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
              />
              <button
                type="button"
                disabled={isSending || !input.trim()}
                onClick={handleSend}
                className="absolute inset-y-1 right-1 inline-flex w-8 items-center justify-center rounded-lg bg-[#271173] text-white transition-colors hover:bg-[#1f0d5a] disabled:cursor-not-allowed disabled:opacity-60"
                title="Enviar"
              >
                {isSending ? (
                  <ChatBubbleLeftRightIcon className="h-4 w-4 animate-pulse" />
                ) : (
                  <PaperAirplaneIcon className="h-4 w-4" />
                )}
              </button>
            </div>

            <p className="text-center text-[11px] text-black/50">
              {isDirty ? 'Se guardaran cambios antes de enviar.' : 'Preview en tiempo real'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
