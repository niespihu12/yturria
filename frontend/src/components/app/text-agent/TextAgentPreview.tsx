import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowPathIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline'
import { chatWithTextAgent } from '@/api/TextAgentsAPI'
import TypingIndicator from './TypingIndicator'

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
  const [hasError, setHasError] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const visibleMessages = useMemo(() => {
    if (!messages.length && welcomeMessage.trim()) {
      return [{ role: 'assistant' as const, content: welcomeMessage.trim() }]
    }
    return messages
  }, [messages, welcomeMessage])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [visibleMessages, isSending, hasError])

  const handleSend = async () => {
    if (!input.trim() || isSending) return

    const userMessage = input.trim()
    setInput('')
    setHasError(false)
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
    } catch {
      setHasError(true)
    } finally {
      setIsSending(false)
    }
  }

  const restart = () => {
    setMessages([])
    setConversationId(null)
    setHasError(false)
  }

  return (
    <aside
      aria-label="Vista previa del agente"
      className="flex h-[32rem] shrink-0 flex-col border-t border-border-default bg-surface lg:h-auto lg:w-80 lg:border-l lg:border-t-0"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-primary">Vista previa</h2>
          <p className="mt-0.5 truncate text-xs text-text-tertiary">Pruebe a {agentName} antes de publicarlo</p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={restart}
            aria-label="Reiniciar la conversación de prueba"
            title="Reiniciar"
            className="-mr-1.5 rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-neutral-100 hover:text-text-primary"
          >
            <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 space-y-3 overflow-y-auto bg-bg-secondary px-4 py-4"
      >
        {visibleMessages.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-text-tertiary">
            Escriba un mensaje como lo haría un cliente para ver cómo responde el agente.
          </p>
        ) : (
          visibleMessages.map((message, index) => {
            const isUser = message.role === 'user'
            return (
              <div key={`${message.role}-${index}`} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <p
                  className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    isUser
                      ? 'rounded-br-md bg-primary-700 text-text-inverse'
                      : 'rounded-bl-md border border-border-default bg-surface text-text-primary'
                  }`}
                >
                  <span className="sr-only">{isUser ? 'Usted: ' : 'Agente: '}</span>
                  {message.content}
                </p>
              </div>
            )
          })
        )}
        {isSending && (
          <div className="flex justify-start">
            <TypingIndicator label="El agente está escribiendo" />
          </div>
        )}
      </div>

      <div className="border-t border-border-default p-4">
        {hasError && (
          <p role="alert" className="mb-2 text-sm text-danger-700">
            El agente no pudo responder en este momento. Intente de nuevo en unos minutos.
          </p>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor={`preview-input-${agentId}`} className="sr-only">
            Mensaje de prueba
          </label>
          <input
            id={`preview-input-${agentId}`}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Escriba un mensaje…"
            autoComplete="off"
            className="h-10 min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-600"
          />
          <button
            type="button"
            disabled={isSending || !input.trim()}
            onClick={() => void handleSend()}
            aria-label="Enviar mensaje"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-700 text-text-inverse transition-colors hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PaperAirplaneIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-center text-xs text-text-tertiary">
          {isDirty
            ? 'Al enviar, se guardarán primero sus cambios.'
            : 'Las respuestas usan la configuración guardada.'}
        </p>
      </div>
    </aside>
  )
}
