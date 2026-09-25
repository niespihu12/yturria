import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { getEscalations } from '@/api/TextAgentsAPI'
import type { SofiaConfig } from '@/types/textAgent'
import AdvancedSection from '@/components/ui/AdvancedSection'
import Button from '@/components/ui/Button'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type Props = {
  agentId: string
  sofiaMode: boolean
  sofiaConfigJson: string
  onSofiaChange: (mode: boolean, configJson: string) => void
}

const inputClass =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus:border-primary-600'

const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'
const hintClass = 'mt-1.5 text-xs leading-relaxed text-text-tertiary'

const sliderClass =
  'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-primary-100 accent-primary-700 ' +
  '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none ' +
  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface ' +
  '[&::-webkit-slider-thumb]:bg-primary-700 [&::-webkit-slider-thumb]:shadow'

const DEFAULT_CONFIG: SofiaConfig = {
  advisor_phone: '',
  advisor_whatsapp_config_id: '',
  business_hours: '',
  extra_escalation_phrases: [
    'quiero hablar con alguien',
    'necesito un asesor',
    'quiero cotizar',
    'hablar con una persona',
  ],
  max_response_lines: 3,
  escalation_threshold: 4,
  company_name: '',
  company_years: '',
  carriers: '',
  company_context: '',
}

function parseSofiaConfig(json: string): SofiaConfig {
  try {
    const parsed = JSON.parse(json || '{}')
    const merged = { ...DEFAULT_CONFIG, ...parsed }
    if (!merged.company_name && parsed.business_name) merged.company_name = parsed.business_name
    if (!merged.extra_escalation_phrases?.length && parsed.escalation_phrases?.length)
      merged.extra_escalation_phrases = parsed.escalation_phrases
    return merged
  } catch {
    return DEFAULT_CONFIG
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-4 border-t border-border-subtle pt-6">
      <div>
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {description && <p className="mt-1 max-w-[65ch] text-sm text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  )
}

export default function TextAgentSofiaTab({ agentId, sofiaMode, sofiaConfigJson, onSofiaChange }: Props) {
  const { isSuperAdmin } = useCurrentUser()
  const id = useId()
  const fieldId = (name: string) => `${id}-${name}`

  const [config, setConfig] = useState<SofiaConfig>(() => parseSofiaConfig(sofiaConfigJson))
  const [lastSofiaJson, setLastSofiaJson] = useState(sofiaConfigJson)
  if (sofiaConfigJson !== lastSofiaJson) {
    setLastSofiaJson(sofiaConfigJson)
    setConfig(parseSofiaConfig(sofiaConfigJson))
  }

  const [newPhrase, setNewPhrase] = useState('')

  const updateConfig = (partial: Partial<SofiaConfig>) => {
    const next = { ...config, ...partial }
    setConfig(next)
    onSofiaChange(sofiaMode, JSON.stringify(next))
  }

  const handleToggle = () => {
    onSofiaChange(!sofiaMode, JSON.stringify(config))
  }

  const addPhrase = () => {
    const trimmed = newPhrase.trim()
    if (!trimmed || config.extra_escalation_phrases.includes(trimmed)) return
    updateConfig({ extra_escalation_phrases: [...config.extra_escalation_phrases, trimmed] })
    setNewPhrase('')
  }

  const removePhrase = (idx: number) => {
    updateConfig({ extra_escalation_phrases: config.extra_escalation_phrases.filter((_: string, i: number) => i !== idx) })
  }

  const { data: escalationsData } = useQuery({
    queryKey: ['escalations', agentId],
    queryFn: () => getEscalations(agentId),
    enabled: sofiaMode,
  })
  const pendingCount = (escalationsData?.escalations ?? []).filter(
    (escalation) => escalation.escalation_status === 'pending',
  ).length

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={fieldId('toggle-label')} className="text-base font-semibold text-text-primary">
            Sofía, asistente de seguros
          </h2>
          <p id={fieldId('toggle-hint')} className="mt-1 max-w-[60ch] text-sm text-text-secondary">
            Atiende a sus clientes con los datos de su empresa y pasa la conversación a un asesor
            cuando el cliente lo pide o la consulta lo requiere.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={sofiaMode}
          aria-labelledby={fieldId('toggle-label')}
          aria-describedby={fieldId('toggle-hint')}
          onClick={handleToggle}
          className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
            sofiaMode ? 'bg-primary-600' : 'bg-neutral-300'
          }`}
        >
          <span className="sr-only">{sofiaMode ? 'Activada' : 'Desactivada'}</span>
          <span
            aria-hidden="true"
            className={`absolute left-0.5 h-6 w-6 rounded-full bg-surface shadow transition-transform duration-200 ${
              sofiaMode ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {!sofiaMode ? (
        <p className="rounded-lg bg-surface-muted px-4 py-3 text-sm text-text-secondary">
          Sofía está desactivada. Actívela para configurar los datos de su empresa, el asesor que
          recibe los casos y cuándo pasar una conversación a una persona.
        </p>
      ) : (
        <>
          <Section
            title="Datos de la empresa"
            description="Sofía los usa para presentarse y responder en nombre de su empresa. Si deja un campo vacío, usa los datos generales de la cuenta."
          >
            <div className="grid gap-4 @lg:grid-cols-2">
              <div>
                <label htmlFor={fieldId('company')} className={labelClass}>
                  Nombre de la empresa
                </label>
                <input
                  id={fieldId('company')}
                  type="text"
                  className={inputClass}
                  value={config.company_name}
                  onChange={(e) => updateConfig({ company_name: e.target.value })}
                  placeholder="Ej: Seguros del Norte"
                />
              </div>
              <div>
                <label htmlFor={fieldId('years')} className={labelClass}>
                  Años en el mercado
                </label>
                <input
                  id={fieldId('years')}
                  type="text"
                  inputMode="numeric"
                  className={inputClass}
                  value={config.company_years ?? ''}
                  onChange={(e) => updateConfig({ company_years: e.target.value })}
                  placeholder="Ej: 75"
                />
              </div>
              <div>
                <label htmlFor={fieldId('hours')} className={labelClass}>
                  Horario de atención
                </label>
                <input
                  id={fieldId('hours')}
                  type="text"
                  className={inputClass}
                  value={config.business_hours}
                  onChange={(e) => updateConfig({ business_hours: e.target.value })}
                  placeholder="Ej: lunes a viernes, 8:00 a. m. a 6:00 p. m."
                />
              </div>
              <div>
                <label htmlFor={fieldId('carriers')} className={labelClass}>
                  Aseguradoras con las que trabaja
                </label>
                <input
                  id={fieldId('carriers')}
                  type="text"
                  className={inputClass}
                  value={config.carriers}
                  onChange={(e) => updateConfig({ carriers: e.target.value })}
                  placeholder="Separe los nombres con comas"
                />
              </div>
            </div>

            <div>
              <label htmlFor={fieldId('context')} className={labelClass}>
                Sobre la empresa
              </label>
              <textarea
                id={fieldId('context')}
                rows={3}
                className={`${inputClass} resize-y`}
                value={config.company_context}
                onChange={(e) => updateConfig({ company_context: e.target.value })}
                placeholder="Especialidades, ciudades donde opera, tipo de clientes…"
              />
              <p className={hintClass}>
                Sofía usa este texto como contexto al conversar. El aviso legal se configura en la
                pestaña Agente.
              </p>
            </div>
          </Section>

          <Section
            title="Asesor que recibe los casos"
            description="Cuando Sofía pasa una conversación a una persona, avisa a este número de WhatsApp."
          >
            <div className="max-w-sm">
              <label htmlFor={fieldId('advisor')} className={labelClass}>
                WhatsApp del asesor
              </label>
              <input
                id={fieldId('advisor')}
                type="tel"
                className={inputClass}
                value={config.advisor_phone}
                onChange={(e) => updateConfig({ advisor_phone: e.target.value })}
                placeholder="Ej: +57 300 123 4567"
              />
            </div>

            <AdvancedSection
              key={isSuperAdmin ? 'admin' : 'client'}
              defaultOpen={isSuperAdmin}
              description="Canal de WhatsApp que envía los avisos al asesor."
            >
              <div>
                <label htmlFor={fieldId('advisor-channel')} className={labelClass}>
                  Identificador del canal de WhatsApp para avisos
                </label>
                <input
                  id={fieldId('advisor-channel')}
                  type="text"
                  className={`${inputClass} font-mono`}
                  value={config.advisor_whatsapp_config_id}
                  onChange={(e) => updateConfig({ advisor_whatsapp_config_id: e.target.value })}
                  placeholder="Identificador de la configuración de WhatsApp"
                />
                <p className={hintClass}>
                  Conecte primero WhatsApp en su pestaña y copie aquí el identificador del canal.
                </p>
              </div>
            </AdvancedSection>
          </Section>

          <Section title="Cómo responde">
            <div className="grid gap-6 @lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <label htmlFor={fieldId('lines')} className="text-sm font-medium text-text-primary">
                    Máximo de líneas por respuesta
                  </label>
                  <span className="text-sm font-semibold tabular-nums text-primary-700">
                    {config.max_response_lines}
                  </span>
                </div>
                <input
                  id={fieldId('lines')}
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={config.max_response_lines}
                  onChange={(e) => updateConfig({ max_response_lines: parseInt(e.target.value, 10) })}
                  className={sliderClass}
                />
                <p className={hintClass}>Respuestas cortas se leen mejor en el celular.</p>
              </div>

              <div>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <label htmlFor={fieldId('threshold')} className="text-sm font-medium text-text-primary">
                    Mensajes antes de pasar a un asesor
                  </label>
                  <span className="text-sm font-semibold tabular-nums text-primary-700">
                    {config.escalation_threshold}
                  </span>
                </div>
                <input
                  id={fieldId('threshold')}
                  type="range"
                  min={1}
                  max={20}
                  step={1}
                  value={config.escalation_threshold}
                  onChange={(e) => updateConfig({ escalation_threshold: parseInt(e.target.value, 10) })}
                  className={sliderClass}
                />
                <p className={hintClass}>
                  Si la conversación llega a este número de mensajes sin resolverse, Sofía la pasa
                  al asesor.
                </p>
              </div>
            </div>
          </Section>

          <Section
            title="Frases que llaman a un asesor"
            description="Cuando el cliente escriba algo parecido a estas frases, Sofía avisará al asesor."
          >
            {config.extra_escalation_phrases.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {config.extra_escalation_phrases.map((phrase: string, idx: number) => (
                  <li
                    key={`${phrase}-${idx}`}
                    className="flex items-center gap-1 rounded-lg border border-border-default bg-surface-muted py-1 pl-3 pr-1 text-sm text-text-primary"
                  >
                    {phrase}
                    <button
                      type="button"
                      onClick={() => removePhrase(idx)}
                      aria-label={`Quitar la frase «${phrase}»`}
                      className="rounded-md p-1 text-text-tertiary transition-colors hover:bg-neutral-200 hover:text-text-primary"
                    >
                      <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor={fieldId('phrase')} className="sr-only">
                Nueva frase
              </label>
              <input
                id={fieldId('phrase')}
                type="text"
                className={inputClass}
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                placeholder="Ej: quiero hablar con una persona"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addPhrase()
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={addPhrase} disabled={!newPhrase.trim()}>
                Agregar frase
              </Button>
            </div>
          </Section>

          <Section title="Escalamientos">
            <div className="flex flex-col gap-3 rounded-lg bg-surface-muted px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-text-secondary">
                {pendingCount > 0
                  ? `Hay ${pendingCount} ${pendingCount === 1 ? 'caso pendiente' : 'casos pendientes'} de este agente.`
                  : 'Los casos que Sofía pasa a un asesor llegan a la bandeja de escalamientos.'}
              </p>
              <Link
                to="/escalamientos"
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-primary-700 hover:text-primary-800"
              >
                Abrir la bandeja
                <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
