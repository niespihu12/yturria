import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { ClipboardDocumentIcon, CheckIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { updateTextAgent } from '@/api/TextAgentsAPI'

type EmbedConfig = {
  agent_id: string
  embed_enabled: boolean
  embed_primary_color: string
  embed_position: string
  embed_logo_url: string
  iframe_url: string
  iframe_snippet: string
  script_snippet: string
}

type Props = {
  agentId: string
  config: EmbedConfig
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded-lg border border-[#e4e0f5] bg-white px-3 py-1.5 text-xs font-medium text-black/60 transition-colors hover:border-[#271173] hover:text-[#271173]"
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-500" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  )
}

function ChatPreview({
  color,
  logoUrl,
  position,
  agentName,
}: {
  color: string
  logoUrl: string
  position: string
  agentName: string
}) {
  const isLeft = position === 'bottom-left'
  return (
    <div className="relative h-[340px] w-full overflow-hidden rounded-2xl bg-gray-100">
      <div className="absolute inset-0 flex items-end justify-end p-4" style={{ flexDirection: isLeft ? 'row-reverse' : 'row' }}>
        <div className="flex flex-col items-end gap-2" style={{ alignItems: isLeft ? 'flex-start' : 'flex-end' }}>
          {/* Bubble chat preview */}
          <div className="w-56 overflow-hidden rounded-2xl shadow-lg">
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ backgroundColor: color }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/30 text-[10px] font-bold text-white">
                  S
                </div>
              )}
              <span className="text-xs font-semibold text-white">{agentName}</span>
            </div>
            <div className="bg-white p-3">
              <div className="mb-2 max-w-[80%] rounded-xl rounded-tl-none px-2.5 py-1.5 text-[10px] text-black"
                style={{ backgroundColor: `${color}18` }}>
                ¡Hola! ¿En qué te puedo ayudar?
              </div>
              <div className="ml-auto max-w-[80%] rounded-xl rounded-tr-none px-2.5 py-1.5 text-[10px] text-white"
                style={{ backgroundColor: color }}>
                Necesito un seguro
              </div>
            </div>
            <div className="flex gap-1.5 border-t border-gray-100 bg-white px-2 py-1.5">
              <div className="h-5 flex-1 rounded-lg bg-gray-100" />
              <div className="flex h-5 w-5 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: color }}>
                <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </div>
            </div>
          </div>
          {/* FAB button */}
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full shadow-lg"
            style={{ backgroundColor: color }}
          >
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
        </div>
      </div>
      <div className="absolute left-3 top-3 rounded-lg bg-white/80 px-2 py-1 text-[10px] text-black/40 backdrop-blur-sm">
        Preview en vivo
      </div>
    </div>
  )
}

const inputClass = 'w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black focus:border-[#271173] focus:outline-none'
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-black/50'

export default function EmbedCustomizer({ agentId, config }: Props) {
  const queryClient = useQueryClient()
  const [color, setColor] = useState(config.embed_primary_color || '#271173')
  const [position, setPosition] = useState(config.embed_position || 'bottom-right')
  const [logoUrl, setLogoUrl] = useState(config.embed_logo_url || '')
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    setColor(config.embed_primary_color || '#271173')
    setPosition(config.embed_position || 'bottom-right')
    setLogoUrl(config.embed_logo_url || '')
    setIsDirty(false)
  }, [config.agent_id])

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      updateTextAgent(agentId, {
        embed_primary_color: color,
        embed_position: position,
        embed_logo_url: logoUrl,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['text-agent-embed-config', agentId] })
      toast.success('Estilo del widget guardado')
      setIsDirty(false)
    },
    onError: () => toast.error('Error al guardar cambios'),
  })

  const handleChange = (setter: (v: string) => void) => (v: string) => {
    setter(v)
    setIsDirty(true)
  }

  const snippet = config.iframe_snippet
    .replace(config.embed_primary_color || '#271173', color)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Controls */}
      <div className="flex flex-col gap-4">
        <div>
          <label className={labelClass}>Color principal</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={e => handleChange(setColor)(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-xl border border-[#e4e0f5] p-1"
            />
            <input
              type="text"
              value={color}
              onChange={e => handleChange(setColor)(e.target.value)}
              className={`${inputClass} flex-1`}
              placeholder="#271173"
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Posición del widget</label>
          <div className="grid grid-cols-2 gap-2">
            {(['bottom-right', 'bottom-left'] as const).map(pos => (
              <button
                key={pos}
                onClick={() => handleChange(setPosition)(pos)}
                className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  position === pos
                    ? 'border-[#271173] bg-[#f3f0ff] text-[#271173]'
                    : 'border-[#e4e0f5] bg-white text-black/60 hover:border-[#271173]'
                }`}
              >
                {pos === 'bottom-right' ? 'Inferior derecha' : 'Inferior izquierda'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>URL del logo (PNG/SVG)</label>
          <input
            type="url"
            value={logoUrl}
            onChange={e => handleChange(setLogoUrl)(e.target.value)}
            className={inputClass}
            placeholder="https://tudominio.com/logo.png"
          />
          <p className="mt-1 text-xs text-black/40">
            Sube tu logo a tu servidor y pega la URL aquí.
          </p>
        </div>

        <button
          onClick={() => save()}
          disabled={!isDirty || isPending}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#271173] py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-40 hover:opacity-90"
        >
          {isPending && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
          Guardar estilo
        </button>

        {/* Snippet */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className={labelClass}>Snippet HTML</label>
            <CopyButton text={snippet} />
          </div>
          <pre className="max-h-32 overflow-auto rounded-xl bg-gray-50 p-3 text-[11px] text-black/60">
            {snippet}
          </pre>
        </div>
      </div>

      {/* Preview */}
      <div>
        <label className={labelClass}>Preview en vivo</label>
        <ChatPreview
          color={color}
          logoUrl={logoUrl}
          position={position}
          agentName="Sofía"
        />
      </div>
    </div>
  )
}
