import { useEffect, useId } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  getWhatsAppGlobalConfig,
  upsertWhatsAppGlobalConfig,
  type UserWhatsAppGlobalConfig,
} from '@/api/VoiceRuntimeAPI'
import AdvancedSection from '@/components/ui/AdvancedSection'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { compactPhone, formatPhone } from '@/lib/format'

type FormValues = {
  provider: 'twilio' | 'meta'
  active: boolean
  default_sender_number: string
  account_sid: string
  auth_token: string
  phone_number_id: string
  business_account_id: string
  access_token: string
  message_template_escalation: string
  message_template_appointment: string
}

const inputClass =
  'h-10 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-primary-500'

const textareaClass =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm leading-relaxed text-text-primary placeholder:text-text-muted transition-colors focus:border-primary-500'

const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'
const helpClass = 'mt-1.5 text-xs leading-relaxed text-text-tertiary'

function Variable({ children }: { children: string }) {
  return <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-xs text-text-secondary">{children}</code>
}

function toDefaults(config: UserWhatsAppGlobalConfig | null): FormValues {
  return {
    provider: config?.provider ?? 'twilio',
    active: config?.active ?? true,
    default_sender_number: config?.default_sender_number ?? '',
    account_sid: config?.account_sid ?? '',
    auth_token: '',
    phone_number_id: config?.phone_number_id ?? '',
    business_account_id: config?.business_account_id ?? '',
    access_token: '',
    message_template_escalation: config?.message_template_escalation ?? '',
    message_template_appointment: config?.message_template_appointment ?? '',
  }
}

function StatusLine({ config }: { config: UserWhatsAppGlobalConfig | null | undefined }) {
  if (!config) {
    return <p className="text-sm text-text-secondary">Aún no ha configurado el envío por WhatsApp.</p>
  }
  if (!config.active) {
    return <p className="text-sm text-text-secondary">El envío está pausado: no se están mandando mensajes.</p>
  }
  return (
    <p className="flex items-center gap-2 text-sm text-text-secondary">
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary-600" />
      <span>
        Activo
        {config.default_sender_number ? (
          <>
            {' '}
            · los mensajes salen desde{' '}
            <span className="font-medium tabular-nums text-text-primary">
              {formatPhone(config.default_sender_number)}
            </span>
          </>
        ) : null}
      </span>
    </p>
  )
}

export default function WhatsAppConfigView() {
  const queryClient = useQueryClient()
  const { isSuperAdmin } = useCurrentUser()
  const fieldId = useId()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['voice-whatsapp-global-config'],
    queryFn: getWhatsAppGlobalConfig,
  })

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { isDirty },
  } = useForm<FormValues>({
    defaultValues: toDefaults(null),
  })

  useEffect(() => {
    reset(toDefaults(data?.config ?? null))
  }, [data?.config, reset])

  const provider = useWatch({ control, name: 'provider' })
  const hasTwilioToken = Boolean(data?.config?.has_twilio_auth_token)
  const hasMetaToken = Boolean(data?.config?.has_meta_access_token)

  const { mutate: saveConfig, isPending: isSaving } = useMutation({
    mutationFn: (values: FormValues) =>
      upsertWhatsAppGlobalConfig({
        provider: values.provider,
        active: values.active,
        default_sender_number: compactPhone(values.default_sender_number),
        account_sid: values.account_sid,
        auth_token: values.auth_token || undefined,
        phone_number_id: values.phone_number_id,
        business_account_id: values.business_account_id,
        access_token: values.access_token || undefined,
        message_template_escalation: values.message_template_escalation,
        message_template_appointment: values.message_template_appointment,
      }),
    onSuccess: (result) => {
      toast.success('Configuración de WhatsApp guardada')
      queryClient.invalidateQueries({ queryKey: ['voice-whatsapp-global-config'] })
      reset(toDefaults(result.config), { keepDirty: false })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const id = (name: keyof FormValues) => `${fieldId}-${name}`

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-8">
        <PageHeader
          title="WhatsApp saliente"
          description="Los mensajes que el asistente envía por WhatsApp a sus clientes: el aviso de que una persona del equipo continuará la conversación y la confirmación de cada cita agendada."
        />

        {isLoading ? (
          <p className="rounded-xl border border-border-default bg-surface px-6 py-12 text-center text-sm text-text-tertiary">
            Cargando la configuración…
          </p>
        ) : isError ? (
          <div className="rounded-xl border border-border-default bg-surface px-6 py-10">
            <p className="text-sm font-medium text-text-primary">No pudimos cargar la configuración de WhatsApp.</p>
            <p className="mt-1 text-sm text-text-secondary">Revise su conexión y vuelva a intentarlo en unos segundos.</p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit((values) => saveConfig(values))}
            className="rounded-xl border border-border-default bg-surface"
            noValidate
          >
            <div className="border-b border-border-subtle px-5 py-4 sm:px-6">
              <StatusLine config={data?.config} />
            </div>

            <section aria-labelledby={`${fieldId}-sending`} className="space-y-5 px-5 py-6 sm:px-6">
              <h2 id={`${fieldId}-sending`} className="text-base font-semibold text-text-primary">
                Envío
              </h2>

              <div className="flex items-start gap-3">
                <input
                  id={id('active')}
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
                  aria-describedby={`${id('active')}-help`}
                  {...register('active')}
                />
                <div>
                  <label htmlFor={id('active')} className="text-sm font-medium text-text-primary">
                    Enviar mensajes por WhatsApp
                  </label>
                  <p id={`${id('active')}-help`} className="mt-0.5 text-xs text-text-tertiary">
                    Si lo desactiva, el asistente deja de enviar avisos y confirmaciones por este canal.
                  </p>
                </div>
              </div>

              <div className="max-w-sm">
                <label htmlFor={id('default_sender_number')} className={labelClass}>
                  Número remitente
                </label>
                <input
                  id={id('default_sender_number')}
                  type="tel"
                  className={`${inputClass} tabular-nums`}
                  placeholder="+57 300 123 4567"
                  aria-describedby={`${id('default_sender_number')}-help`}
                  {...register('default_sender_number')}
                />
                <p id={`${id('default_sender_number')}-help`} className={helpClass}>
                  El número de WhatsApp de su empresa desde el que salen los mensajes, con el indicativo del país.
                </p>
              </div>
            </section>

            <section
              aria-labelledby={`${fieldId}-messages`}
              className="space-y-5 border-t border-border-subtle px-5 py-6 sm:px-6"
            >
              <div>
                <h2 id={`${fieldId}-messages`} className="text-base font-semibold text-text-primary">
                  Mensajes
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Opcionales. Si deja un mensaje vacío, se envía el texto estándar.
                </p>
              </div>

              <div>
                <label htmlFor={id('message_template_escalation')} className={labelClass}>
                  Cuando una persona del equipo continuará la conversación
                </label>
                <textarea
                  id={id('message_template_escalation')}
                  rows={3}
                  className={textareaClass}
                  placeholder="Hola, le escribe el asistente de {agent_name}. Una persona de nuestro equipo continuará con su solicitud muy pronto."
                  aria-describedby={`${id('message_template_escalation')}-help`}
                  {...register('message_template_escalation')}
                />
                <p id={`${id('message_template_escalation')}-help`} className={helpClass}>
                  Puede incluir <Variable>{'{agent_name}'}</Variable> (nombre del asistente) y{' '}
                  <Variable>{'{summary}'}</Variable> (resumen de lo que pidió el cliente).
                </p>
              </div>

              <div>
                <label htmlFor={id('message_template_appointment')} className={labelClass}>
                  Confirmación de cita
                </label>
                <textarea
                  id={id('message_template_appointment')}
                  rows={3}
                  className={textareaClass}
                  placeholder="Su cita con {agent_name} quedó agendada para el {appointment_date} ({timezone})."
                  aria-describedby={`${id('message_template_appointment')}-help`}
                  {...register('message_template_appointment')}
                />
                <p id={`${id('message_template_appointment')}-help`} className={helpClass}>
                  Puede incluir <Variable>{'{agent_name}'}</Variable>, <Variable>{'{appointment_date}'}</Variable>{' '}
                  (fecha y hora de la cita) y <Variable>{'{timezone}'}</Variable> (zona horaria).
                </p>
              </div>
            </section>

            <div className="border-t border-border-subtle px-5 py-6 sm:px-6">
              <AdvancedSection
                title="Conexión con el proveedor"
                description="Credenciales de la cuenta de WhatsApp Business. Normalmente las configura el equipo técnico."
                defaultOpen={isSuperAdmin}
              >
                <div className="max-w-sm">
                  <label htmlFor={id('provider')} className={labelClass}>
                    Proveedor
                  </label>
                  <select id={id('provider')} className={inputClass} {...register('provider')}>
                    <option value="twilio">Twilio WhatsApp</option>
                    <option value="meta">Meta Cloud API</option>
                  </select>
                </div>

                {provider === 'twilio' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={id('account_sid')} className={labelClass}>
                        Account SID
                      </label>
                      <input
                        id={id('account_sid')}
                        type="text"
                        className={inputClass}
                        placeholder="AC…"
                        autoComplete="off"
                        {...register('account_sid')}
                      />
                    </div>
                    <div>
                      <label htmlFor={id('auth_token')} className={labelClass}>
                        Auth Token
                      </label>
                      <input
                        id={id('auth_token')}
                        type="password"
                        className={inputClass}
                        autoComplete="new-password"
                        aria-describedby={hasTwilioToken ? `${id('auth_token')}-help` : undefined}
                        {...register('auth_token')}
                      />
                      {hasTwilioToken && (
                        <p id={`${id('auth_token')}-help`} className={helpClass}>
                          Ya hay un token guardado. Déjelo vacío para conservarlo.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor={id('phone_number_id')} className={labelClass}>
                        Phone Number ID
                      </label>
                      <input
                        id={id('phone_number_id')}
                        type="text"
                        className={inputClass}
                        autoComplete="off"
                        {...register('phone_number_id')}
                      />
                    </div>
                    <div>
                      <label htmlFor={id('business_account_id')} className={labelClass}>
                        Business Account ID <span className="font-normal text-text-tertiary">(opcional)</span>
                      </label>
                      <input
                        id={id('business_account_id')}
                        type="text"
                        className={inputClass}
                        autoComplete="off"
                        {...register('business_account_id')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={id('access_token')} className={labelClass}>
                        Access Token
                      </label>
                      <input
                        id={id('access_token')}
                        type="password"
                        className={inputClass}
                        autoComplete="new-password"
                        aria-describedby={hasMetaToken ? `${id('access_token')}-help` : undefined}
                        {...register('access_token')}
                      />
                      {hasMetaToken && (
                        <p id={`${id('access_token')}-help`} className={helpClass}>
                          Ya hay un token guardado. Déjelo vacío para conservarlo.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </AdvancedSection>
            </div>

            <div className="flex flex-col-reverse items-stretch gap-3 rounded-b-xl border-t border-border-subtle bg-surface-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
              {!isDirty && <p className="text-xs text-text-tertiary sm:mr-auto">No hay cambios por guardar.</p>}
              <Button type="submit" isLoading={isSaving} disabled={!isDirty}>
                Guardar cambios
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
