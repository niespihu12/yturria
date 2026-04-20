import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PaperAirplaneIcon } from '@heroicons/react/24/solid'

import {
  chatWithPublicTextAgentEmbed,
  getPublicTextAgentEmbedInfo,
} from '@/api/TextAgentsAPI'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

function resolveSessionId(agentId: string) {
  const key = `text-agent-embed-session:${agentId}`
  const existing = localStorage.getItem(key)
  if (existing) return existing

  const generated = Math.random().toString(36).slice(2, 12)
  localStorage.setItem(key, generated)
  return generated
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
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    if (!agentId) return
    setSessionId(resolveSessionId(agentId))
  }, [agentId])

  const infoQuery = useQuery({
    queryKey: ['public-text-agent-embed-info', agentId, token],
    queryFn: () => getPublicTextAgentEmbedInfo(agentId, token),
    enabled: !!agentId && !!token,
  })

  useEffect(() => {
    const welcome = String(infoQuery.data?.welcome_message || '').trim()
    if (!welcome) return
    setMessages((prev) => {
      if (prev.length > 0) return prev
      return [{ role: 'assistant', content: welcome }]
    })
  }, [infoQuery.data?.welcome_message])

  async function handleSend() {
    const message = input.trim()
    if (!message || !agentId || !token || !sessionId || isSending) return

    setInput('')
    setSendError('')
    setIsSending(true)
    setMessages((prev) => [...prev, { role: 'user', content: message }])

    try {
      const result = await chatWithPublicTextAgentEmbed(agentId, {
        token,
        message,
        conversation_id: conversationId,
        session_id: sessionId,
      })

      setConversationId(result.conversation_id)
      setMessages((prev) => [...prev, { role: 'assistant', content: result.response }])
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'No se pudo enviar el mensaje'
      setSendError(detail)
    } finally {
      setIsSending(false)
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f3ff] p-6 text-center">
        <section className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-rose-700">Token inválido</h1>
          <p className="mt-2 text-sm text-black/65">
            Esta URL de integración no contiene un token válido.
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f5f3ff] p-4">
      <section className="mx-auto flex h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e4e0f5] bg-white shadow-sm">
        <header className="border-b border-[#e4e0f5] px-4 py-3">
          <p className="text-xs uppercase tracking-[0.14em] text-[#271173]/70">Asistente embebido</p>
          <h1 className="mt-1 text-base font-semibold text-[#1a1a2f]">
            {infoQuery.data?.name || 'Agente de texto'}
          </h1>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-[#fcfbff] px-4 py-4">
          {infoQuery.isLoading && (
            <div className="rounded-xl border border-[#ece8fb] bg-white p-3 text-sm text-black/65">
              Cargando agente...
            </div>
          )}

          {infoQuery.isError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              No se pudo inicializar el chat embebido.
            </div>
          )}

          {messages.map((message, index) => {
            const user = message.role === 'user'
            return (
              <div key={`${message.role}-${index}`} className={`flex ${user ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[86%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    user
                      ? 'bg-[#271173] text-white'
                      : 'border border-[#e4e0f5] bg-white text-[#1a1a2f]'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            )
          })}
        </div>

        <footer className="border-t border-[#e4e0f5] bg-white px-4 py-3">
          {sendError && <p className="mb-2 text-xs text-rose-600">{sendError}</p>}

          <div className="relative">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Escribe tu mensaje..."
              className="w-full rounded-xl border border-[#d8d3ee] py-2.5 pl-3 pr-11 text-sm text-[#1a1a2f] placeholder:text-black/45 focus:border-[#271173] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || !input.trim()}
              className="absolute inset-y-1 right-1 inline-flex w-9 items-center justify-center rounded-lg bg-[#271173] text-white transition-colors hover:bg-[#1f0d5a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PaperAirplaneIcon className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </section>
    </main>
  )
}
