import { useId, useState } from 'react'
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
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-primary-700 hover:text-primary-700"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-success-600" aria-hidden="true" />
      ) : (
        <ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? 'Copiado' : 'Copiar código'}
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
    <div className="relative h-[340px] w-full overflow-hidden rounded-xl bg-surface-muted">
      <div className="absolute inset-0 flex items-end justify-end p-4" style={{ flexDirection: isLeft ? 'row-reverse' : 'row' }}>
        <div className="flex flex-col items-end gap-2" style={{ alignItems: isLeft ? 'flex-start' : 'flex-end' }}>
          {/* Bubble chat preview */}
          <div className="w-56 overflow-hidden rounded-2xl shadow-lg">
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ backgroundColor: color }}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface/30 text-xs font-bold text-text-inverse">
                  S
                </div>
              )}
              <span className="text-xs font-semibold text-text-inverse">{agentName}</span>
            </div>
            <div className="bg-surface p-3">
              <div className="mb-2 max-w-[80%] rounded-xl rounded-tl-none px-2.5 py-1.5 text-xs text-text-primary"
                style={{ backgroundColor: `${color}18` }}>
                Hola, ¿en qué le puedo ayudar?
              </div>
              <div className="ml-auto max-w-[80%] rounded-xl rounded-tr-none px-2.5 py-1.5 text-xs text-text-inverse"
                style={{ backgroundColor: color }}>
                Necesito un seguro
              </div>
            </div>
            <div className="flex gap-1.5 border-t border-border-subtle bg-surface px-2 py-1.5">
              <div className="h-5 flex-1 rounded-lg bg-surface-muted" />
              <div className="flex h-5 w-5 items-center justify-center rounded-lg text-text-inverse"
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
            <svg className="h-5 w-5 text-text-inverse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
        </div>
      </div>
      <div className="absolute left-3 top-3 rounded-lg bg-surface px-2 py-1 text-xs text-text-tertiary">
        Vista previa
      </div>
    </div>
  )
}

const inputClass = 'w-full rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary focus:border-primary-600'
const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'

export default function EmbedCustomizer({ agentId, config }: Props) {
  const queryClient = useQueryClient()
  const [color, setColor] = useState(config.embed_primary_color || '#271173')
  const [position, setPosition] = useState(config.embed_position || 'bottom-right')
  const [logoUrl, setLogoUrl] = useState(config.embed_logo_url || '')
  const [isDirty, setIsDirty] = useState(false)
  const baseId = useId()

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      updateTextAgent(agentId, {
        embed_primary_color: color,
        embed_position: position,
        embed_logo_url: logoUrl,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['text-agent-embed-config', agentId] })
      toast.success('Estilo del chat guardado')
      setIsDirty(false)
    },
    onError: () => toast.error('No pudimos guardar el estilo. Intente de nuevo.'),
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
          <label htmlFor={`${baseId}-color`} className={labelClass}>Color principal</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Elegir color"
              value={color}
              onChange={e => handleChange(setColor)(e.target.value)}
              className="h-10 w-14 cursor-pointer rounded-lg border border-border-default p-1"
            />
            <input
              id={`${baseId}-color`}
              type="text"
              value={color}
              onChange={e => handleChange(setColor)(e.target.value)}
              className={`${inputClass} flex-1`}
              placeholder="#271173"
            />
          </div>
        </div>

        <div>
          <p className={labelClass}>Posición del chat</p>
          <div className="grid grid-cols-2 gap-2">
            {(['bottom-right', 'bottom-left'] as const).map(pos => (
              <button
                key={pos}
                type="button"
                aria-pressed={position === pos}
                onClick={() => handleChange(setPosition)(pos)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  position === pos
                    ? 'border-primary-700 bg-primary-100 text-primary-700'
                    : 'border-border-default bg-surface text-text-secondary hover:border-primary-700'
                }`}
              >
                {pos === 'bottom-right' ? 'Inferior derecha' : 'Inferior izquierda'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor={`${baseId}-logo`} className={labelClass}>Dirección del logo (PNG o SVG)</label>
          <input
            id={`${baseId}-logo`}
            type="url"
            value={logoUrl}
            onChange={e => handleChange(setLogoUrl)(e.target.value)}
            className={inputClass}
            placeholder="https://tudominio.com/logo.png"
          />
          <p className="mt-1 text-xs text-text-tertiary">
            Publique su logo en su sitio web y pegue aquí la dirección de la imagen.
          </p>
        </div>

        <button
          type="button"
          onClick={() => save()}
          disabled={!isDirty || isPending}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary-700 py-2.5 text-sm font-semibold text-text-inverse transition-colors hover:bg-primary-800 disabled:opacity-50"
        >
          {isPending && <ArrowPathIcon className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Guardar estilo
        </button>

        {/* Snippet */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className={labelClass}>Código para su sitio web</p>
            <CopyButton text={snippet} />
          </div>
          <pre className="max-h-32 overflow-auto rounded-lg bg-surface-muted p-3 text-xs text-text-secondary">
            {snippet}
          </pre>
        </div>
      </div>

      {/* Preview */}
      <div>
        <p className={labelClass}>Vista previa</p>
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
