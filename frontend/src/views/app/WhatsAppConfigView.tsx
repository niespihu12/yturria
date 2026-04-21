import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { CheckIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import {
  getWhatsAppGlobalConfig,
  upsertWhatsAppGlobalConfig,
  type UserWhatsAppGlobalConfig,
} from '@/api/VoiceRuntimeAPI'

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
  'rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none'

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

export default function WhatsAppConfigView() {
  const queryClient = useQueryClient()

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
        default_sender_number: values.default_sender_number,
        account_sid: values.account_sid,
        auth_token: values.auth_token || undefined,
        phone_number_id: values.phone_number_id,
        business_account_id: values.business_account_id,
        access_token: values.access_token || undefined,
        message_template_escalation: values.message_template_escalation,
        message_template_appointment: values.message_template_appointment,
      }),
    onSuccess: (result) => {
      toast.success('Configuracion de WhatsApp guardada')
      queryClient.invalidateQueries({ queryKey: ['voice-whatsapp-global-config'] })
      reset(toDefaults(result.config), { keepDirty: false })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2.5 text-black/60">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
        Cargando configuracion de WhatsApp...
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-black/60">
        No se pudo cargar la configuracion de WhatsApp.
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-8">
        <div className="section-enter">
          <h1 className="text-2xl font-semibold text-black">WhatsApp Configuration</h1>
          <p className="mt-1 text-sm text-black/60">
            Configuracion global reutilizable para escalaciones, confirmaciones de citas y mensajes salientes.
          </p>
        </div>

        <section className="rounded-2xl border border-[#e4e0f5] bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2.5 text-black">
            <ChatBubbleLeftRightIcon className="h-5 w-5 text-[#271173]" />
            <h2 className="text-lg font-semibold">Canal y credenciales</h2>
          </div>

          <form onSubmit={handleSubmit((values) => saveConfig(values))} className="space-y-5" noValidate>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
                Proveedor
                <select className={inputClass} {...register('provider')}>
                  <option value="twilio">Twilio WhatsApp</option>
                  <option value="meta">Meta Cloud API</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
                Numero remitente por defecto
                <input
                  type="text"
                  className={inputClass}
                  placeholder="+573001234567"
                  {...register('default_sender_number')}
                />
              </label>
            </div>

            <label className="inline-flex items-center gap-2 rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-2 text-sm text-black/80">
              <input type="checkbox" className="h-4 w-4" {...register('active')} />
              Activar envio por WhatsApp
            </label>

            {provider === 'twilio' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
                  Account SID
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="ACxxxxxxxx"
                    {...register('account_sid')}
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
                  Auth Token
                  <input
                    type="password"
                    className={inputClass}
                    placeholder={hasTwilioToken ? '******** (dejar vacio para conservar)' : 'Tu auth token'}
                    {...register('auth_token')}
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
                  Phone Number ID
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Meta phone number id"
                    {...register('phone_number_id')}
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
                  Business Account ID (opcional)
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Meta business account id"
                    {...register('business_account_id')}
                  />
                </label>

                <label className="md:col-span-2 flex flex-col gap-1.5 text-sm font-medium text-black/80">
                  Access Token
                  <input
                    type="password"
                    className={inputClass}
                    placeholder={hasMetaToken ? '******** (dejar vacio para conservar)' : 'Token de Meta'}
                    {...register('access_token')}
                  />
                </label>
              </div>
            )}

            <div className="grid gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
                Template de escalacion (opcional)
                <textarea
                  rows={3}
                  className={inputClass}
                  placeholder="Hola, soy el asistente virtual de {agent_name}. Tu solicitud fue escalada..."
                  {...register('message_template_escalation')}
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
                Template de confirmacion de cita (opcional)
                <textarea
                  rows={3}
                  className={inputClass}
                  placeholder="Tu cita con {agent_name} fue agendada para {appointment_date} ({timezone})."
                  {...register('message_template_appointment')}
                />
              </label>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving || !isDirty}
                className="inline-flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-50"
              >
                {isSaving ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <CheckIcon className="h-4 w-4" />
                )}
                {isSaving ? 'Guardando...' : 'Guardar configuracion'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
