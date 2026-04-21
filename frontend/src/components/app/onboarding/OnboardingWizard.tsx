import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  BuildingOffice2Icon,
  DevicePhoneMobileIcon,
  UserIcon,
  RocketLaunchIcon,
  CheckCircleIcon,
  XMarkIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline'
import { updateTextAgent, upsertWhatsAppConfig, getWhatsAppConfig } from '@/api/TextAgentsAPI'
import type { WhatsAppProvider } from '@/types/textAgent'

type Props = {
  agentId: string
  onComplete: () => void
}

const STEPS = [
  { label: 'Empresa', Icon: BuildingOffice2Icon },
  { label: 'Canal', Icon: DevicePhoneMobileIcon },
  { label: 'Asesor', Icon: UserIcon },
  { label: 'Publicar', Icon: RocketLaunchIcon },
] as const

type StepIndex = 0 | 1 | 2 | 3

const inputClass =
  'w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none'
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-black/50'

interface WizardData {
  company_name: string
  business_hours: string
  carriers: string
  company_context: string
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
  company_name: '', business_hours: '', carriers: '', company_context: '',
  wp_provider: 'twilio', wp_phone: '', wp_account_sid: '', wp_auth_token: '',
  wp_access_token: '', wp_app_secret: '', wp_phone_number_id: '', wp_business_account_id: '',
  wp_config_id: '', wp_saved: false, wp_skipped: false,
  advisor_phone: '',
}

export default function OnboardingWizard({ agentId, onComplete }: Props) {
  const navigate = useNavigate()
  const [step, setStep] = useState<StepIndex>(0)
  const [data, setData] = useState<WizardData>(INIT)

  const upd = (partial: Partial<WizardData>) => setData((prev) => ({ ...prev, ...partial }))

  const { data: wpQueryData } = useQuery({
    queryKey: ['onboarding-whatsapp', agentId],
    queryFn: () => getWhatsAppConfig(agentId),
    enabled: step === 3,
  })

  const wpConfig = wpQueryData?.config ?? null
  const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
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

  function advanceToPublish(advisorOverride?: Partial<WizardData>) {
    saveSofia(buildSofiaJson(advisorOverride), {
      onSuccess: () => setStep(3),
    })
  }

  function markDone() {
    localStorage.setItem(`onboarding-wizard:done:${agentId}`, 'true')
    onComplete()
    navigate(`/agentes_texto/${agentId}`)
  }

  const checks = [
    { label: 'Perfil de empresa', ok: !!(data.company_name.trim() || data.carriers.trim()) },
    { label: 'Canal WhatsApp', ok: data.wp_saved },
    { label: 'Asesor asignado', ok: !!data.advisor_phone.trim() },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden">
        {/* Skip all */}
        <button
          type="button"
          onClick={markDone}
          title="Saltar configuración"
          className="absolute right-4 top-4 z-10 rounded-lg p-1.5 text-white/60 hover:text-white transition-colors"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        {/* Header / progress */}
        <div className="bg-gradient-to-br from-[#271173] to-[#4a28c4] px-8 pt-7 pb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/50 mb-3">
            Configuración inicial · {step + 1} / {STEPS.length}
          </p>
          <div className="flex items-center gap-2">
            {STEPS.map(({ label }, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold transition-all duration-300 ${
                    i < step
                      ? 'bg-emerald-400 text-white'
                      : i === step
                      ? 'bg-white text-[#271173] shadow-md'
                      : 'bg-white/15 text-white/40'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </div>
                <span
                  className={`hidden sm:block text-[10px] font-semibold transition-colors ${
                    i <= step ? 'text-white' : 'text-white/30'
                  }`}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 h-1 rounded-full bg-white/20">
            <div
              className="h-1 rounded-full bg-white transition-all duration-500"
              style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}
            />
          </div>
        </div>

        {/* Step content */}
        <div className="px-8 py-6">
          {/* ── STEP 1: Empresa ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-black">Perfil de la empresa</h2>
                <p className="mt-0.5 text-xs text-black/50">
                  Sofía usará esta información para presentarse y responder en nombre de tu empresa.
                </p>
              </div>

              <div>
                <label className={labelClass}>Nombre de la empresa <span className="text-rose-400">*</span></label>
                <input
                  className={inputClass}
                  value={data.company_name}
                  onChange={(e) => upd({ company_name: e.target.value })}
                  placeholder="Ej. Yturria Agente de Seguros"
                  autoFocus
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Horario de atención</label>
                  <input
                    className={inputClass}
                    value={data.business_hours}
                    onChange={(e) => upd({ business_hours: e.target.value })}
                    placeholder="Lun-Vie 9:00-18:00"
                  />
                </div>
                <div>
                  <label className={labelClass}>Aseguradoras</label>
                  <input
                    className={inputClass}
                    value={data.carriers}
                    onChange={(e) => upd({ carriers: e.target.value })}
                    placeholder="GNP, AXA, Chubb…"
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Contexto adicional</label>
                <textarea
                  rows={2}
                  className={`${inputClass} resize-none`}
                  value={data.company_context}
                  onChange={(e) => upd({ company_context: e.target.value })}
                  placeholder="Especialidades, zona de operación, tipo de clientes…"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={!data.company_name.trim()}
                  onClick={() => setStep(1)}
                  className="rounded-xl bg-[#271173] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#1f0d5a] disabled:opacity-40 transition-colors"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Canal ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-black">Canal de WhatsApp</h2>
                <p className="mt-0.5 text-xs text-black/50">
                  Conecta un número para que Sofía reciba y responda mensajes automáticamente.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {(['twilio', 'meta'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => upd({ wp_provider: p })}
                    className={`rounded-xl border p-3 text-left text-xs transition-colors ${
                      data.wp_provider === p
                        ? 'border-[#271173] bg-[#ede9ff] ring-1 ring-[#271173]'
                        : 'border-[#e4e0f5] hover:border-[#271173]/30'
                    }`}
                  >
                    <p className="font-semibold text-black">
                      {p === 'twilio' ? 'Twilio' : 'Meta Cloud API'}
                    </p>
                    <p className="mt-0.5 text-black/40 leading-relaxed">
                      {p === 'twilio'
                        ? 'Sandbox incluido, ideal para pruebas rápidas'
                        : 'API oficial de WhatsApp Business'}
                    </p>
                  </button>
                ))}
              </div>

              <div>
                <label className={labelClass}>Número de WhatsApp</label>
                <input
                  className={inputClass}
                  type="tel"
                  value={data.wp_phone}
                  onChange={(e) => upd({ wp_phone: e.target.value })}
                  placeholder="+5218123456789"
                />
              </div>

              {data.wp_provider === 'twilio' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Account SID</label>
                    <input
                      className={inputClass}
                      value={data.wp_account_sid}
                      onChange={(e) => upd({ wp_account_sid: e.target.value })}
                      placeholder="ACxxx…"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Auth Token</label>
                    <input
                      className={inputClass}
                      type="password"
                      value={data.wp_auth_token}
                      onChange={(e) => upd({ wp_auth_token: e.target.value })}
                      placeholder="Tu auth token"
                    />
                  </div>
                </div>
              )}

              {data.wp_provider === 'meta' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Access Token</label>
                    <input
                      className={inputClass}
                      type="password"
                      value={data.wp_access_token}
                      onChange={(e) => upd({ wp_access_token: e.target.value })}
                      placeholder="Token de Meta API"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Phone Number ID</label>
                    <input
                      className={inputClass}
                      value={data.wp_phone_number_id}
                      onChange={(e) => upd({ wp_phone_number_id: e.target.value })}
                      placeholder="ID del número en Meta"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => { upd({ wp_skipped: true }); setStep(2) }}
                  className="text-sm text-black/40 hover:text-black/70 transition-colors"
                >
                  Omitir por ahora
                </button>
                <button
                  type="button"
                  disabled={!data.wp_phone.trim() || savingWP}
                  onClick={() => saveWP()}
                  className="flex items-center gap-2 rounded-xl bg-[#271173] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#1f0d5a] disabled:opacity-40 transition-colors"
                >
                  {savingWP && (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  )}
                  Guardar y continuar →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Asesor ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-black">Asesor asignado</h2>
                <p className="mt-0.5 text-xs text-black/50">
                  Sofía escalará conversaciones a este número cuando el cliente requiera atención humana.
                </p>
              </div>

              {data.wp_saved && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs text-emerald-700">
                  <CheckCircleIcon className="h-4 w-4 shrink-0" />
                  WhatsApp configurado correctamente
                </div>
              )}

              {data.wp_skipped && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-700">
                  <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
                  Canal omitido — configúralo después en la pestaña WhatsApp
                </div>
              )}

              <div>
                <label className={labelClass}>
                  WhatsApp del asesor
                </label>
                <input
                  className={inputClass}
                  type="tel"
                  value={data.advisor_phone}
                  onChange={(e) => upd({ advisor_phone: e.target.value })}
                  placeholder="+5218123456789"
                  autoFocus
                />
                <p className="mt-1 text-[11px] text-black/40">
                  Recibirá una notificación cuando Sofía no pueda resolver al cliente.
                </p>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={savingSofia}
                  onClick={() => advanceToPublish()}
                  className="text-sm text-black/40 hover:text-black/70 transition-colors disabled:opacity-40"
                >
                  Omitir por ahora
                </button>
                <button
                  type="button"
                  disabled={!data.advisor_phone.trim() || savingSofia}
                  onClick={() => advanceToPublish()}
                  className="flex items-center gap-2 rounded-xl bg-[#271173] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#1f0d5a] disabled:opacity-40 transition-colors"
                >
                  {savingSofia && (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  )}
                  Guardar y publicar →
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Publicar ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-black">¡Sofía está lista!</h2>
                <p className="mt-0.5 text-xs text-black/50">
                  Revisa el estado de configuración y empieza a recibir conversaciones.
                </p>
              </div>

              <div className="space-y-2 rounded-2xl border border-[#e4e0f5] bg-[#fafafa] p-4">
                {checks.map((c) => (
                  <div key={c.label} className="flex items-center gap-3">
                    <div
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                        c.ok ? 'bg-emerald-100' : 'bg-amber-100'
                      }`}
                    >
                      {c.ok ? (
                        <CheckCircleIcon className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <ExclamationCircleIcon className="h-4 w-4 text-amber-500" />
                      )}
                    </div>
                    <span className="flex-1 text-sm text-black/70">{c.label}</span>
                    {!c.ok && (
                      <span className="text-[11px] font-medium text-amber-500">Pendiente</span>
                    )}
                  </div>
                ))}
              </div>

              {webhookUrl && (
                <div className="rounded-xl border border-[#e4e0f5] bg-white p-4 space-y-2">
                  <p className="text-xs font-semibold text-black/60">
                    URL de webhook — pega en{' '}
                    {wpConfig?.provider === 'meta' ? 'Meta Developers' : 'Twilio Console'}
                  </p>
                  <div className="flex gap-2">
                    <code className="flex-1 truncate rounded-lg bg-[#f5f3ff] px-2.5 py-1.5 text-[11px] text-[#271173]">
                      {webhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(webhookUrl).then(() => toast.success('URL copiada'))}
                      className="shrink-0 rounded-lg border border-[#e4e0f5] px-3 py-1.5 text-xs font-medium text-black/60 hover:border-[#271173] transition-colors"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              )}

              {checks.some((c) => !c.ok) && (
                <p className="text-[11px] text-black/40 text-center">
                  Puedes completar la configuración pendiente desde las pestañas del agente.
                </p>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={markDone}
                  className="rounded-xl bg-[#271173] px-8 py-2.5 text-sm font-semibold text-white hover:bg-[#1f0d5a] transition-colors"
                >
                  Ir al agente →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
