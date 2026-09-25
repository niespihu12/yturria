import { useId, useState } from 'react'
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'

type ChannelChoice = 'web_only' | 'web_and_whatsapp'

type Props = {
  embedSnippet: string
  onChoiceChange?: (choice: ChannelChoice) => void
  defaultChoice?: ChannelChoice
}

const CHOICES: Array<{ value: ChannelChoice; title: string; description: string; badge: string }> = [
  {
    value: 'web_only',
    title: 'Empezar con el chat web',
    description: 'Disponible de inmediato: copie un código y el chat aparece en su sitio.',
    badge: 'Disponible ahora',
  },
  {
    value: 'web_and_whatsapp',
    title: 'Chat web y WhatsApp',
    description: 'El chat web funciona desde hoy; WhatsApp se activa cuando Meta apruebe su cuenta.',
    badge: 'Requiere aprobación de Meta',
  },
]

const META_REQUIREMENTS = [
  'Meta debe aprobar su cuenta de WhatsApp Business. La revisión puede tardar desde unos días hasta tres semanas.',
  'Necesita una cuenta de Meta Business verificada y un número de teléfono dedicado.',
  'Meta puede restringir números que incumplan sus políticas: evite mensajes masivos no solicitados y textos en mayúsculas sostenidas.',
]

const META_APPROVAL_STEPS = [
  'Crear una cuenta de Business Manager en Meta.',
  'Verificar su empresa con documentos oficiales.',
  'Solicitar acceso a WhatsApp Business.',
  'Configurar el número de teléfono dedicado.',
  'Esperar la revisión de Meta.',
  'Conectar el número en la pestaña WhatsApp de este agente.',
]

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      leftIcon={
        copied ? (
          <CheckIcon className="h-3.5 w-3.5 text-success-600" aria-hidden="true" />
        ) : (
          <ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden="true" />
        )
      }
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      {copied ? 'Copiado' : 'Copiar código'}
    </Button>
  )
}

export default function ChannelSelectionStep({ embedSnippet, onChoiceChange, defaultChoice = 'web_only' }: Props) {
  const [choice, setChoice] = useState<ChannelChoice>(defaultChoice)
  const groupName = useId()
  const codeId = useId()

  const handleChoice = (c: ChannelChoice) => {
    setChoice(c)
    onChoiceChange?.(c)
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="sr-only">Canales de atención</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHOICES.map((option) => {
            const selected = choice === option.value
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-border-focus ${
                  selected ? 'border-primary-600 bg-primary-50' : 'border-border-default bg-surface hover:border-primary-300'
                }`}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={option.value}
                  checked={selected}
                  onChange={() => handleChoice(option.value)}
                  className="sr-only"
                />
                <span className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-text-primary">{option.title}</span>
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                      selected ? 'border-primary-600' : 'border-border-strong'
                    }`}
                  >
                    {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary-600" />}
                  </span>
                </span>
                <span className="text-xs leading-relaxed text-text-secondary">{option.description}</span>
                <span>
                  <Badge size="sm" variant={option.value === 'web_only' ? 'success' : 'default'}>
                    {option.badge}
                  </Badge>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={codeId} className="text-sm font-medium text-text-primary">
            Código para su sitio web
          </label>
          <CopyButton text={embedSnippet} />
        </div>
        <textarea
          id={codeId}
          readOnly
          rows={4}
          value={embedSnippet}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full resize-none rounded-lg border border-border-default bg-surface-muted p-3 font-mono text-xs leading-relaxed text-text-secondary"
        />
        <p className="mt-1.5 text-xs text-text-tertiary">
          Péguelo en la página de su sitio donde quiera mostrar el chat. También lo encuentra después
          en la pestaña Sitio web.
        </p>
      </div>

      {choice === 'web_and_whatsapp' && (
        <section aria-labelledby={`${codeId}-meta`} className="rounded-lg bg-info-50 px-4 py-3">
          <h3 id={`${codeId}-meta`} className="text-sm font-semibold text-info-700">
            Antes de conectar WhatsApp
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-info-700">
            {META_REQUIREMENTS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <details className="group mt-2 text-xs text-info-700">
            <summary className="cursor-pointer font-semibold underline-offset-2 hover:underline">
              Ver los pasos de aprobación
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-4 leading-relaxed">
              {META_APPROVAL_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
          <p className="mt-2 text-xs leading-relaxed text-info-700">
            Mientras tanto, el chat web ya puede atender a sus clientes.
          </p>
        </section>
      )}
    </div>
  )
}
