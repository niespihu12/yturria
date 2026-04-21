import { useState } from 'react'
import {
  GlobeAltIcon,
  DevicePhoneMobileIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

type ChannelChoice = 'web_only' | 'web_and_whatsapp'

type Props = {
  embedSnippet: string
  onChoiceChange?: (choice: ChannelChoice) => void
  defaultChoice?: ChannelChoice
}

const META_APPROVAL_STEPS = [
  'Crear cuenta de Business Manager en Facebook',
  'Verificar tu negocio con documentos oficiales',
  'Solicitar acceso a la WhatsApp Business API',
  'Configurar el número de teléfono dedicado',
  'Esperar revisión de Meta (2-7 días hábiles)',
  'Conectar el número en el panel de Yturria',
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
      className="flex items-center gap-1.5 rounded-lg border border-[#e4e0f5] px-3 py-1.5 text-xs font-medium text-black/60 transition-colors hover:border-[#271173] hover:text-[#271173]"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <ClipboardDocumentIcon className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copiado' : 'Copiar snippet'}
    </button>
  )
}

export default function ChannelSelectionStep({ embedSnippet, onChoiceChange, defaultChoice = 'web_only' }: Props) {
  const [choice, setChoice] = useState<ChannelChoice>(defaultChoice)
  const [showMetaSteps, setShowMetaSteps] = useState(false)

  const handleChoice = (c: ChannelChoice) => {
    setChoice(c)
    onChoiceChange?.(c)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Web Only */}
        <button
          type="button"
          onClick={() => handleChoice('web_only')}
          className={`relative flex flex-col gap-3 rounded-2xl border-2 p-5 text-left transition-all ${
            choice === 'web_only'
              ? 'border-[#271173] bg-[#f3f0ff]'
              : 'border-[#e4e0f5] bg-white hover:border-[#271173]/40'
          }`}
        >
          {choice === 'web_only' && (
            <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#271173]">
              <CheckIcon className="h-3 w-3 text-white" />
            </div>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#271173]/10">
            <GlobeAltIcon className="h-5 w-5 text-[#271173]" />
          </div>
          <div>
            <p className="font-semibold text-black">Empezar solo con web</p>
            <p className="mt-1 text-xs text-black/50">
              Disponible de inmediato. Embed el chat en tu sitio web con un simple snippet HTML.
              Sin aprobación de Meta.
            </p>
          </div>
          <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">
            Disponible ahora
          </span>
        </button>

        {/* Web + WhatsApp */}
        <button
          type="button"
          onClick={() => handleChoice('web_and_whatsapp')}
          className={`relative flex flex-col gap-3 rounded-2xl border-2 p-5 text-left transition-all ${
            choice === 'web_and_whatsapp'
              ? 'border-[#271173] bg-[#f3f0ff]'
              : 'border-[#e4e0f5] bg-white hover:border-[#271173]/40'
          }`}
        >
          {choice === 'web_and_whatsapp' && (
            <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#271173]">
              <CheckIcon className="h-3 w-3 text-white" />
            </div>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-50">
            <DevicePhoneMobileIcon className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="font-semibold text-black">Web + WhatsApp</p>
            <p className="mt-1 text-xs text-black/50">
              Web inmediato, más WhatsApp cuando obtengas aprobación de Meta (2-7 días hábiles).
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700">
            <ExclamationTriangleIcon className="h-3 w-3" />
            Requiere aprobación Meta
          </span>
        </button>
      </div>

      {/* Embed snippet */}
      {(choice === 'web_only' || choice === 'web_and_whatsapp') && (
        <div className="rounded-2xl border border-[#e4e0f5] bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-black">Snippet para tu sitio web</p>
            <CopyButton text={embedSnippet} />
          </div>
          <pre className="overflow-x-auto rounded-xl bg-gray-50 p-3 text-[11px] text-black/60 whitespace-pre-wrap">
            {embedSnippet}
          </pre>
          <p className="mt-2 text-xs text-black/40">
            Pega este código en el <code className="rounded bg-gray-100 px-1">&lt;body&gt;</code> de tu sitio.
            El chat aparecerá automáticamente.
          </p>
        </div>
      )}

      {/* Meta approval guide */}
      {choice === 'web_and_whatsapp' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <button
            type="button"
            onClick={() => setShowMetaSteps(v => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <DevicePhoneMobileIcon className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-semibold text-amber-800">
                Guía de aprobación Meta / WhatsApp Business
              </span>
            </div>
            <span className="text-xs text-amber-600">{showMetaSteps ? 'Ocultar' : 'Ver pasos'}</span>
          </button>

          {showMetaSteps && (
            <ol className="mt-3 space-y-2">
              {META_APPROVAL_STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-amber-800">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[10px] font-bold text-amber-800">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          )}

          <p className="mt-3 text-xs text-amber-700">
            Mientras esperas la aprobación, tu chat web ya está activo y capturando leads.
          </p>
        </div>
      )}
    </div>
  )
}
