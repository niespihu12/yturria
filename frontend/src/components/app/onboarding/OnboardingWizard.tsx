import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { CheckIcon } from '@heroicons/react/24/outline'
import {
  attachKnowledgeBaseDocument,
  createTextKnowledgeBaseDocumentFromFile,
  getTextAgentEmbedConfig,
  getWhatsAppConfig,
  updateTextAgent,
  upsertWhatsAppConfig,
} from '@/api/TextAgentsAPI'
import type { WhatsAppProvider } from '@/types/textAgent'
import { absoluteApiBaseUrl } from '@/lib/apiUrl'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import AdvancedSection from '@/components/ui/AdvancedSection'
import { friendlyUploadError } from '@/components/app/text-agent/copy'
import ChannelSelectionStep from './ChannelSelectionStep'

type Props = {
  agentId: string
  onComplete: () => void
}

const STEPS = ['Empresa', 'Canales', 'Asesor', 'Listo'] as const

type StepIndex = 0 | 1 | 2 | 3

const inputClass =
  'h-10 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus:border-primary-600'
const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'
const hintClass = 'mt-1.5 text-xs leading-relaxed text-text-tertiary'

interface WizardData {
  company_name: string
  business_hours: string
  carriers: string
  company_context: string
  presentation_file: File | null
  wp_provider: WhatsAppProvider
  wp_phone: string
  wp_account_sid: string
  wp_auth_token: string
  wp_access_token: string
  wp_app_secret: string
  wp_phone_number_id: string
  wp_business_account_id: string
  wp_config_id: string
  wp_saved: boolean
  wp_skipped: boolean
  advisor_phone: string
}

const INIT: WizardData = {
  company_name: '', business_hours: '', carriers: '', company_context: '', presentation_file: null,
  wp_provider: 'twilio', wp_phone: '', wp_account_sid: '', wp_auth_token: '',
  wp_access_token: '', wp_app_secret: '', wp_phone_number_id: '', wp_business_account_id: '',
  wp_config_id: '', wp_saved: false, wp_skipped: false,
  advisor_phone: '',
}

function Stepper({ step }: { step: StepIndex }) {
  return (
    <ol aria-label="Progreso de la configuración" className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < step
        const current = i === step
        return (
          <li
            key={label}
            aria-current={current ? 'step' : undefined}
            className="flex flex-1 items-center gap-2 last:flex-none"
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                done
                  ? 'bg-primary-600 text-text-inverse'
                  : current
                    ? 'border-2 border-primary-600 text-primary-700'
                    : 'border border-border-strong text-text-tertiary'
              }`}
            >
              {done ? <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
            </span>
            <span
              aria-hidden="true"
              className={`hidden text-xs font-medium sm:inline ${
                current ? 'text-text-primary' : 'text-text-tertiary'
              }`}
            >
              {label}
            </span>
            <span className="sr-only">
              {`Paso ${i + 1}: ${label}${done ? ', completado' : ''}`}
            </span>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className={`h-px flex-1 ${done ? 'bg-primary-600' : 'bg-border-default'}`}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

export default function OnboardingWizard({ agentId, onComplete }: Props) {
  const navigate = useNavigate()
  const { isSuperAdmin } = useCurrentUser()
  const [step, setStep] = useState<StepIndex>(0)
  const [data, setData] = useState<WizardData>(INIT)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const isFirstRender = useRef(true)
  const onCompleteRef = useRef(onComplete)
  const baseId = useId()
  const fieldId = (name: string) => `${baseId}-${name}`

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  // Al cambiar de paso, el foco va al título del paso para que el lector de pantalla lo anuncie.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    headingRef.current?.focus()
  }, [step])

  const upd = (partial: Partial<WizardData>) => setData((prev) => ({ ...prev, ...partial }))

  const { data: wpQueryData } = useQuery({
    queryKey: ['onboarding-whatsapp', agentId],
    queryFn: () => getWhatsAppConfig(agentId),
    enabled: step === 3,
  })

  const { data: embedConfigData } = useQuery({
    queryKey: ['onboarding-embed-config', agentId],
    queryFn: () => getTextAgentEmbedConfig(agentId),
    enabled: step === 1,
  })

  const wpConfig = wpQueryData?.config ?? null
  const API_BASE = absoluteApiBaseUrl()
  const webhookUrl = wpConfig
    ? `${API_BASE}/webhooks/whatsapp/${wpConfig.id}/${wpConfig.provider}`
    : ''

  const { mutate: saveSofia, isPending: savingSofia } = useMutation({
    mutationFn: (sofiaJson: string) =>
      updateTextAgent(agentId, { sofia_mode: true, sofia_config_json: sofiaJson }),
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: saveWP, isPending: savingWP } = useMutation({
    mutationFn: () =>
      upsertWhatsAppConfig(agentId, {
        provider: data.wp_provider,
        phone_number: data.wp_phone,
        ...(data.wp_provider === 'twilio'
          ? { account_sid: data.wp_account_sid, auth_token: data.wp_auth_token || undefined }
          : {
              access_token: data.wp_access_token || undefined,
              app_secret: data.wp_app_secret || undefined,
              phone_number_id: data.wp_phone_number_id,
              business_account_id: data.wp_business_account_id,
            }),
      }),
    onSuccess: (res) => {
      upd({ wp_saved: true, wp_config_id: res.config.id })
      setStep(2)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function buildSofiaJson(overrides?: Partial<WizardData>) {
    const d = { ...data, ...overrides }
    return JSON.stringify({
      company_name: d.company_name,
      business_hours: d.business_hours,
      carriers: d.carriers,
      company_context: d.company_context,
      advisor_phone: d.advisor_phone,
      advisor_whatsapp_config_id: d.wp_config_id,
      extra_escalation_phrases: [],
      escalation_threshold: 4,
      max_response_lines: 3,
    })
  }

  function saveCompany() {
    saveSofia(buildSofiaJson(), {
      onSuccess: () => {
        const file = data.presentation_file
        if (file) {
          createTextKnowledgeBaseDocumentFromFile(file, file.name)
            .then((doc) => attachKnowledgeBaseDocument(agentId, doc.id, 'auto'))
            .then(() => toast.success('Presentación cargada. Sofía ya puede consultarla.'))
            .catch((e: unknown) =>
              toast.error(
                `${friendlyUploadError(e)} Puede subirla después en la pestaña Conocimiento.`,
              ),
            )
        }
        setStep(1)
      },
    })
  }

  function advanceToFinish(advisorOverride?: Partial<WizardData>) {
    saveSofia(buildSofiaJson(advisorOverride), {
      onSuccess: () => setStep(3),
    })
  }

  const markDone = useCallback(() => {
    try {
      localStorage.setItem(`onboarding-wizard:done:${agentId}`, 'true')
    } catch {
      // Sin almacenamiento local el asistente solo volverá a ofrecerse la próxima vez.
    }
    onCompleteRef.current()
    navigate(`/agentes_texto/${agentId}`)
  }, [agentId, navigate])

  const checks = [
    {
      label: 'Datos de la empresa',
      ok: !!(data.company_name.trim() || data.carriers.trim()),
      pending: 'Complételos en la pestaña Sofía.',
    },
    {
      label: 'WhatsApp',
      ok: data.wp_saved,
      pending: 'Conéctelo cuando Meta apruebe su cuenta, en la pestaña WhatsApp.',
    },
    {
      label: 'Asesor que recibe los casos',
      ok: !!data.advisor_phone.trim(),
      pending: 'Agréguelo en la pestaña Sofía.',
    },
  ]

  const stepHeading = (title: string, description: string) => (
    <div>
      <h3 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-text-primary">
        {title}
      </h3>
      <p className="mt-1 text-sm text-text-secondary">{description}</p>
    </div>
  )

  const footer = (() => {
    if (step === 0)
      return (
        <>
          <Button type="button" variant="ghost" onClick={markDone}>
            Configurar después
          </Button>
          <Button
            type="button"
            isLoading={savingSofia}
            disabled={!data.company_name.trim()}
            onClick={saveCompany}
          >
            Continuar
          </Button>
        </>
      )
    if (step === 1)
      return (
        <>
          <Button type="button" variant="ghost" onClick={() => setStep(0)}>
            Atrás
          </Button>
          {data.wp_skipped ? (
            <Button type="button" onClick={() => setStep(2)}>
              Continuar con el chat web
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  upd({ wp_skipped: true })
                  setStep(2)
                }}
              >
                Omitir WhatsApp
              </Button>
              <Button
                type="button"
                isLoading={savingWP}
                disabled={!data.wp_phone.trim()}
                onClick={() => saveWP()}
              >
                Guardar y continuar
              </Button>
            </>
          )}
        </>
      )
    if (step === 2)
      return (
        <>
          <Button type="button" variant="ghost" onClick={() => setStep(1)}>
            Atrás
          </Button>
          <Button type="button" variant="outline" disabled={savingSofia} onClick={() => advanceToFinish()}>
            Omitir
          </Button>
          <Button
            type="button"
            isLoading={savingSofia}
            disabled={!data.advisor_phone.trim()}
            onClick={() => advanceToFinish()}
          >
            Guardar y continuar
          </Button>
        </>
      )
    return (
      <Button type="button" onClick={markDone}>
        Ir al agente
      </Button>
    )
  })()

  return (
    <Modal
      open
      onClose={markDone}
      title="Configuración inicial de Sofía"
      description="Cuatro pasos cortos. Puede cambiar todo después desde las pestañas del agente."
      size="lg"
      dismissOnBackdrop={false}
      footer={footer}
    >
      <div className="space-y-6">
        <Stepper step={step} />

        {step === 0 && (
          <div className="space-y-4">
            {stepHeading(
              'Datos de la empresa',
              'Sofía los usará para presentarse y responder en nombre de su empresa.',
            )}

            <div>
              <label htmlFor={fieldId('company')} className={labelClass}>
                Nombre de la empresa <span className="font-normal text-text-tertiary">(obligatorio)</span>
              </label>
              <input
                id={fieldId('company')}
                className={inputClass}
                required
                value={data.company_name}
                onChange={(e) => upd({ company_name: e.target.value })}
                placeholder="Ej: Seguros del Norte"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={fieldId('hours')} className={labelClass}>
                  Horario de atención
                </label>
                <input
                  id={fieldId('hours')}
                  className={inputClass}
                  value={data.business_hours}
                  onChange={(e) => upd({ business_hours: e.target.value })}
                  placeholder="Ej: lunes a viernes, 8 a. m. a 6 p. m."
                />
              </div>
              <div>
                <label htmlFor={fieldId('carriers')} className={labelClass}>
                  Aseguradoras
                </label>
                <input
                  id={fieldId('carriers')}
                  className={inputClass}
                  value={data.carriers}
                  onChange={(e) => upd({ carriers: e.target.value })}
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
                rows={2}
                className="w-full resize-y rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-600"
                value={data.company_context}
                onChange={(e) => upd({ company_context: e.target.value })}
                placeholder="Especialidades, ciudades donde opera, tipo de clientes…"
              />
            </div>

            <div>
              <label htmlFor={fieldId('presentation')} className={labelClass}>
                Presentación corporativa (PDF)
              </label>
              <input
                id={fieldId('presentation')}
                type="file"
                accept=".pdf,application/pdf"
                aria-describedby={fieldId('presentation-hint')}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null
                  upd({ presentation_file: file })
                }}
                className="block w-full text-sm text-text-secondary file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary-100 file:px-3 file:text-sm file:font-medium file:text-primary-800 hover:file:bg-primary-200"
              />
              <p id={fieldId('presentation-hint')} className={hintClass}>
                Opcional. Sofía la consultará para conocer mejor su empresa (máximo 5 MB).
              </p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            {stepHeading(
              'Canales de atención',
              'Empiece con el chat de su sitio web y agregue WhatsApp cuando esté listo.',
            )}

            <ChannelSelectionStep
              embedSnippet={embedConfigData?.iframe_snippet ?? 'Preparando el código…'}
              onChoiceChange={(c) => upd({ wp_skipped: c === 'web_only' })}
              defaultChoice={data.wp_skipped ? 'web_only' : 'web_and_whatsapp'}
            />

            {!data.wp_skipped && (
              <div className="space-y-4 border-t border-border-subtle pt-5">
                <div className="max-w-xs">
                  <label htmlFor={fieldId('wp-phone')} className={labelClass}>
                    Número de WhatsApp
                  </label>
                  <input
                    id={fieldId('wp-phone')}
                    className={inputClass}
                    type="tel"
                    value={data.wp_phone}
                    onChange={(e) => upd({ wp_phone: e.target.value })}
                    placeholder="Ej: +57 300 123 4567"
                  />
                </div>

                <AdvancedSection
                  key={isSuperAdmin ? 'admin' : 'client'}
                  title="Credenciales de WhatsApp"
                  description="Datos del proveedor que conecta su número. Puede agregarlos después."
                  defaultOpen={isSuperAdmin}
                >
                  <fieldset>
                    <legend className={labelClass}>Proveedor</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(['twilio', 'meta'] as const).map((p) => {
                        const selected = data.wp_provider === p
                        return (
                          <label
                            key={p}
                            className={`cursor-pointer rounded-lg border p-3 text-left transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-border-focus ${
                              selected ? 'border-primary-600 bg-primary-50' : 'border-border-default bg-surface hover:border-primary-300'
                            }`}
                          >
                            <input
                              type="radio"
                              name={fieldId('wp-provider')}
                              value={p}
                              checked={selected}
                              onChange={() => upd({ wp_provider: p })}
                              className="sr-only"
                            />
                            <span className="block text-sm font-semibold text-text-primary">
                              {p === 'twilio' ? 'Twilio' : 'Meta Cloud API'}
                            </span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-text-tertiary">
                              {p === 'twilio'
                                ? 'Incluye un entorno de pruebas, ideal para empezar.'
                                : 'Conexión oficial de WhatsApp Business.'}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>

                  {data.wp_provider === 'twilio' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={fieldId('wp-sid')} className={labelClass}>
                          Account SID
                        </label>
                        <input
                          id={fieldId('wp-sid')}
                          className={`${inputClass} font-mono`}
                          autoComplete="off"
                          value={data.wp_account_sid}
                          onChange={(e) => upd({ wp_account_sid: e.target.value })}
                          placeholder="ACxxx…"
                        />
                      </div>
                      <div>
                        <label htmlFor={fieldId('wp-auth')} className={labelClass}>
                          Auth Token
                        </label>
                        <input
                          id={fieldId('wp-auth')}
                          className={inputClass}
                          type="password"
                          autoComplete="off"
                          value={data.wp_auth_token}
                          onChange={(e) => upd({ wp_auth_token: e.target.value })}
                          placeholder="Token de Twilio"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor={fieldId('wp-access')} className={labelClass}>
                          Access Token
                        </label>
                        <input
                          id={fieldId('wp-access')}
                          className={inputClass}
                          type="password"
                          autoComplete="off"
                          value={data.wp_access_token}
                          onChange={(e) => upd({ wp_access_token: e.target.value })}
                          placeholder="Token de acceso de Meta"
                        />
                      </div>
                      <div>
                        <label htmlFor={fieldId('wp-phone-id')} className={labelClass}>
                          Phone Number ID
                        </label>
                        <input
                          id={fieldId('wp-phone-id')}
                          className={`${inputClass} font-mono`}
                          autoComplete="off"
                          value={data.wp_phone_number_id}
                          onChange={(e) => upd({ wp_phone_number_id: e.target.value })}
                          placeholder="ID del número en Meta"
                        />
                      </div>
                    </div>
                  )}
                </AdvancedSection>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {stepHeading(
              'Asesor que recibe los casos',
              'Cuando un cliente necesite a una persona, Sofía le avisará a este número de WhatsApp.',
            )}

            {data.wp_saved && (
              <p className="flex items-center gap-2 text-sm text-success-700">
                <CheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                WhatsApp quedó configurado.
              </p>
            )}

            <div className="max-w-xs">
              <label htmlFor={fieldId('advisor')} className={labelClass}>
                WhatsApp del asesor
              </label>
              <input
                id={fieldId('advisor')}
                className={inputClass}
                type="tel"
                value={data.advisor_phone}
                onChange={(e) => upd({ advisor_phone: e.target.value })}
                placeholder="Ej: +57 300 123 4567"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            {stepHeading(
              '¡Sofía está lista!',
              'Ya puede atender a sus clientes en el chat de su sitio web.',
            )}

            <ul className="divide-y divide-border-subtle rounded-xl border border-border-default">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      c.ok ? 'bg-primary-600 text-text-inverse' : 'border border-border-strong'
                    }`}
                  >
                    {c.ok && <CheckIcon className="h-3 w-3" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text-primary">{c.label}</span>
                    <span className="block text-xs text-text-tertiary">{c.ok ? 'Listo' : c.pending}</span>
                  </span>
                </li>
              ))}
            </ul>

            {webhookUrl && (
              <AdvancedSection
                key={isSuperAdmin ? 'admin' : 'client'}
                title="Datos para su proveedor de WhatsApp"
                description="Su equipo técnico los necesita para terminar la conexión."
                defaultOpen={isSuperAdmin}
              >
                <div>
                  <label htmlFor={fieldId('webhook')} className={labelClass}>
                    URL del webhook ({wpConfig?.provider === 'meta' ? 'Meta Developers' : 'consola de Twilio'})
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={fieldId('webhook')}
                      readOnly
                      value={webhookUrl}
                      onFocus={(event) => event.currentTarget.select()}
                      className={`${inputClass} min-w-0 flex-1 bg-surface-muted font-mono text-xs`}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        navigator.clipboard.writeText(webhookUrl).then(() => toast.success('URL copiada'))
                      }
                    >
                      Copiar
                    </Button>
                  </div>
                </div>
              </AdvancedSection>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
