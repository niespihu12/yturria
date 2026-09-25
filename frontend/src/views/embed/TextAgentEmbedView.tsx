import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PaperAirplaneIcon } from '@heroicons/react/24/solid'

import {
  chatWithPublicTextAgentEmbed,
  getPublicTextAgentEmbedInfo,
} from '@/api/TextAgentsAPI'
import Logo from '@/components/Logo'
import TypingIndicator from '@/components/app/text-agent/TypingIndicator'
import { brand } from '@/brand'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

const SEND_ERROR =
  'No pudimos responder en este momento. Por favor, intente de nuevo en unos minutos.'

function generateSessionId() {
  return Math.random().toString(36).slice(2, 12)
}

/** En iframes de terceros el almacenamiento puede estar bloqueado: nunca debe romper el chat. */
function resolveSessionId(agentId: string) {
  const key = `text-agent-embed-session:${agentId}`
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const generated = generateSessionId()
    localStorage.setItem(key, generated)
    return generated
  } catch {
    return generateSessionId()
  }
}

function ChatShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex h-dvh bg-bg-secondary sm:p-4">
      <section className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden bg-surface sm:rounded-2xl sm:border sm:border-border-default sm:shadow-sm">
        {children}
      </section>
    </main>
  )
}

export default function TextAgentEmbedView() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()

  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams])
  const agentId = String(id || '').trim()

  const [sessionId, setSessionId] = useState('')
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [failedMessage, setFailedMessage] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!agentId) return
    setSessionId(resolveSessionId(agentId))
  }, [agentId])

  const infoQuery = useQuery({
    queryKey: ['public-text-agent-embed-info', agentId, token],
    queryFn: () => getPublicTextAgentEmbedInfo(agentId, token),
    enabled: !!agentId && !!token,
    retry: 1,
  })

  useEffect(() => {
    const welcome = String(infoQuery.data?.welcome_message || '').trim()
    if (!welcome) return
    setMessages((prev) => {
      if (prev.length > 0) return prev
      return [{ role: 'assistant', content: welcome }]
    })
  }, [infoQuery.data?.welcome_message])

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, isSending, failedMessage])

  async function send(message: string, { retry = false } = {}) {
    if (!message || !agentId || !token || !sessionId || isSending) return

    setFailedMessage(null)
    setIsSending(true)
    if (!retry) setMessages((prev) => [...prev, { role: 'user', content: message }])

    try {
      const result = await chatWithPublicTextAgentEmbed(agentId, {
        token,
        message,
        conversation_id: conversationId,
        session_id: sessionId,
      })

      setConversationId(result.conversation_id)
      setMessages((prev) => [...prev, { role: 'assistant', content: result.response }])
    } catch {
      setFailedMessage(message)
    } finally {
      setIsSending(false)
      inputRef.current?.focus()
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const message = input.trim()
    if (!message || isSending) return
    setInput('')
    void send(message)
  }

  const agentName = infoQuery.data?.name || 'Asistente virtual'
  const showBrandMark = brand.key === 'bolivar'

  if (!token) {
    return (
      <ChatShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          {showBrandMark && <Logo variant="mark" className="mb-2 h-10 w-10 rounded-lg" />}
          <h1 className="text-base font-semibold text-text-primary">El chat no está disponible</h1>
          <p className="max-w-sm text-sm text-text-secondary">
            Este enlace no es válido. Si administra este sitio, copie de nuevo el código del chat
            desde la consola.
          </p>
        </div>
      </ChatShell>
    )
  }

  return (
    <ChatShell>
      <header className="flex items-center gap-3 border-b border-border-default px-4 py-3 sm:px-5">
        {showBrandMark && <Logo variant="mark" className="h-9 w-9 shrink-0 rounded-lg" />}
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-text-primary">
            {infoQuery.isLoading ? 'Cargando…' : agentName}
          </h1>
          <p className="text-xs text-text-tertiary">Asistente virtual</p>
        </div>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={`Conversación con ${agentName}`}
        className="flex-1 space-y-3 overflow-y-auto bg-bg-secondary px-4 py-5 sm:px-5"
      >
        {infoQuery.isLoading && (
          <div className="space-y-2" aria-hidden="true">
            <div className="skeleton h-10 w-2/3 rounded-2xl" />
            <div className="skeleton h-10 w-1/2 rounded-2xl" />
          </div>
        )}

        {infoQuery.isError && (
          <p className="mx-auto max-w-sm py-6 text-center text-sm text-text-secondary">
            No pudimos abrir el chat en este momento. Por favor, recargue la página o intente más
            tarde.
          </p>
        )}

        {messages.map((message, index) => {
          const fromUser = message.role === 'user'
          return (
            <div key={`${message.role}-${index}`} className={`flex ${fromUser ? 'justify-end' : 'justify-start'}`}>
              <p
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed sm:text-sm ${
                  fromUser
                    ? 'rounded-br-md bg-primary-700 text-text-inverse'
                    : 'rounded-bl-md border border-border-default bg-surface text-text-primary'
                }`}
              >
                <span className="sr-only">{fromUser ? 'Usted: ' : 'Asistente: '}</span>
                {message.content}
              </p>
            </div>
          )
        })}

        {isSending && (
          <div className="flex justify-start">
            <TypingIndicator />
          </div>
        )}
      </div>

      <footer className="border-t border-border-default bg-surface px-4 pb-3 pt-3 sm:px-5">
        {failedMessage && (
          <div
            role="alert"
            className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-danger-50 px-3 py-2"
          >
            <p data-testid="embed-send-error" className="text-sm text-danger-700">
              {SEND_ERROR}
            </p>
            <button
              type="button"
              onClick={() => void send(failedMessage, { retry: true })}
              disabled={isSending}
              className="text-sm font-semibold text-primary-700 underline-offset-2 hover:underline disabled:opacity-60"
            >
              Reintentar
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <label htmlFor="embed-chat-input" className="sr-only">
            Mensaje
          </label>
          <input
            ref={inputRef}
            id="embed-chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Escriba su mensaje…"
            autoComplete="off"
            disabled={infoQuery.isError}
            className="h-11 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface px-3.5 text-base text-text-primary placeholder:text-text-tertiary focus:border-primary-600 focus-visible:outline-none disabled:bg-surface-muted sm:text-sm"
          />
          <button
            type="submit"
            aria-label="Enviar mensaje"
            disabled={isSending || !input.trim()}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-700 text-text-inverse transition-colors hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PaperAirplaneIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-text-tertiary">
          Las respuestas las da un asistente virtual; un asesor puede confirmarle cualquier dato.
        </p>
      </footer>
    </ChatShell>
  )
}
