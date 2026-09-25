import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { deleteWhatsAppConfig, getWhatsAppConfig, upsertWhatsAppConfig } from '@/api/TextAgentsAPI'
import { WHATSAPP_PROVIDER_OPTIONS, type WhatsAppProvider } from '@/types/textAgent'
import { absoluteApiBaseUrl } from '@/lib/apiUrl'
import AdvancedSection from '@/components/ui/AdvancedSection'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type Props = {
  agentId: string
}

const inputClass =
  'h-10 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus:border-primary-600'

const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'
const hintClass = 'mt-1.5 text-xs leading-relaxed text-text-tertiary'
const KEEP_SECRET = 'Déjelo vacío para conservar el actual'

// La URL base del webhook sale de VITE_API_URL (ya incluye /api)
const API_BASE = absoluteApiBaseUrl()

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const id = useId()

  function copy() {
    navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => toast.error('No se pudo copiar. Selecciónelo y cópielo manualmente.'),
    )
  }

  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="h-10 min-w-0 flex-1 rounded-lg border border-border-default bg-surface-muted px-3 font-mono text-xs text-text-secondary"
        />
        <Button
          type="button"
          variant="outline"
          onClick={copy}
          leftIcon={
            copied ? (
              <CheckIcon className="h-4 w-4 text-success-600" aria-hidden="true" />
            ) : (
              <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />
            )
          }
        >
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  )
}

export default function TextAgentWhatsAppTab({ agentId }: Props) {
  const queryClient = useQueryClient()
  const { isSuperAdmin } = useCurrentUser()
  const [confirm, confirmDialog] = useConfirm()
  const baseId = useId()
  const fieldId = (name: string) => `${baseId}-${name}`

  const { data, isLoading } = useQuery({
    queryKey: ['text-agent-whatsapp', agentId],
    queryFn: () => getWhatsAppConfig(agentId),
  })

  const config = data?.config ?? null

  const [provider, setProvider] = useState<WhatsAppProvider>('twilio')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [businessAccountId, setBusinessAccountId] = useState('')

  // Hidrata el formulario cuando cambia la configuración (setState durante el render)
  const [lastConfigId, setLastConfigId] = useState<string | undefined>(undefined)
  const [lastConfigProvider, setLastConfigProvider] = useState<string | undefined>(undefined)
  if (config && (config.id !== lastConfigId || config.provider !== lastConfigProvider)) {
    setLastConfigId(config.id)
    setLastConfigProvider(config.provider)
    setProvider(config.provider)
    setPhoneNumber(config.phone_number)
    setAccountSid(config.account_sid)
    setPhoneNumberId(config.phone_number_id)
    setBusinessAccountId(config.business_account_id)
    // Los secretos nunca vuelven de la API: no sobrescribir lo que el usuario escribe
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['text-agent-whatsapp', agentId] })
  }

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: () =>
      upsertWhatsAppConfig(agentId, {
        provider,
        phone_number: phoneNumber,
        account_sid: accountSid,
        auth_token: authToken || undefined,
        access_token: accessToken || undefined,
        app_secret: appSecret || undefined,
        phone_number_id: phoneNumberId,
        business_account_id: businessAccountId,
      }),
    onSuccess: () => {
      toast.success('Configuración de WhatsApp guardada')
      setAuthToken('')
      setAccessToken('')
      setAppSecret('')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: toggle, isPending: isToggling } = useMutation({
    mutationFn: () =>
      upsertWhatsAppConfig(agentId, { provider: config!.provider, active: !config!.active }),
    onSuccess: () => {
      toast.success(config?.active ? 'WhatsApp en pausa' : 'WhatsApp activado')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: remove, isPending: isRemoving } = useMutation({
    mutationFn: () => deleteWhatsAppConfig(agentId),
    onSuccess: () => {
      toast.success('WhatsApp desconectado')
      setPhoneNumber('')
      setAccountSid('')
      setAuthToken('')
      setAccessToken('')
      setAppSecret('')
      setPhoneNumberId('')
      setBusinessAccountId('')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleRemove = async () => {
    const accepted = await confirm({
      title: '¿Desconectar WhatsApp?',
      description: `El agente dejará de responder en ${config?.phone_number || 'este número'} y se borrarán las credenciales guardadas. Podrá conectarlo de nuevo cuando quiera.`,
      confirmLabel: 'Desconectar',
      tone: 'danger',
    })
    if (accepted) remove()
  }

  const webhookUrl = config
    ? `${API_BASE}/webhooks/whatsapp/${config.id}/${config.provider}`
    : ''

  const verifyToken = config?.webhook_verify_token ?? ''

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-3" aria-label="Cargando configuración de WhatsApp">
        <div className="skeleton h-16" />
        <div className="skeleton h-10 w-1/2" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-8">
      {config ? (
        <section className="flex flex-col gap-4 rounded-xl border border-border-default bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-text-primary">WhatsApp conectado</h2>
              <Badge variant={config.active ? 'success' : 'warning'} size="sm">
                {config.active ? 'Activo' : 'En pausa'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              {config.phone_number ? `Número ${config.phone_number}` : 'Número sin registrar'}
              {!config.has_credentials && ' · faltan las credenciales del proveedor'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={isToggling} onClick={() => toggle()}>
              {config.active ? 'Pausar' : 'Activar'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isRemoving}
              onClick={() => void handleRemove()}
              className="text-danger-700 hover:bg-danger-50 hover:text-danger-700"
            >
              Desconectar
            </Button>
          </div>
        </section>
      ) : (
        <div>
          <h2 className="text-base font-semibold text-text-primary">Conectar WhatsApp</h2>
          <p className="mt-1 max-w-[60ch] text-sm text-text-secondary">
            Conecte este agente a un número de WhatsApp Business para que responda los mensajes
            de sus clientes automáticamente.
          </p>
        </div>
      )}

      <section className="space-y-5">
        <div className="max-w-sm">
          <label htmlFor={fieldId('phone')} className={labelClass}>
            Número de WhatsApp
          </label>
          <input
            id={fieldId('phone')}
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="Ej: +57 300 123 4567"
            className={inputClass}
          />
        </div>

        <AdvancedSection
          key={isSuperAdmin ? 'admin' : 'client'}
          title="Credenciales de WhatsApp"
          description="Datos del proveedor que conecta su número. Se los entrega su equipo técnico o el proveedor."
          defaultOpen={isSuperAdmin}
        >
          <fieldset>
            <legend className={labelClass}>Proveedor</legend>
            <div className="grid gap-2 @lg:grid-cols-2">
              {WHATSAPP_PROVIDER_OPTIONS.map((opt) => {
                const selected = provider === opt.value
                return (
                  <label
                    key={opt.value}
                    className={`cursor-pointer rounded-lg border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-border-focus ${
                      selected
                        ? 'border-primary-600 bg-primary-50'
                        : 'border-border-default bg-surface hover:border-primary-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name={fieldId('provider')}
                      value={opt.value}
                      checked={selected}
                      onChange={() => setProvider(opt.value)}
                      className="sr-only"
                    />
                    <span className="block text-sm font-semibold text-text-primary">{opt.label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-text-tertiary">
                      {opt.description}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          {provider === 'twilio' && (
            <div className="grid gap-4 @lg:grid-cols-2">
              <div>
                <label htmlFor={fieldId('sid')} className={labelClass}>
                  Account SID
                </label>
                <input
                  id={fieldId('sid')}
                  type="text"
                  autoComplete="off"
                  value={accountSid}
                  onChange={(e) => setAccountSid(e.target.value)}
                  placeholder="ACxxxxxxxxxxxxxxxx"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label htmlFor={fieldId('auth')} className={labelClass}>
                  Auth Token
                </label>
                <input
                  id={fieldId('auth')}
                  type="password"
                  autoComplete="off"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder={config?.has_credentials ? KEEP_SECRET : 'Token de Twilio'}
                  className={inputClass}
                />
                <p className={hintClass}>Permite comprobar que cada mensaje viene de Twilio.</p>
              </div>
            </div>
          )}

          {provider === 'meta' && (
            <div className="grid gap-4 @lg:grid-cols-2">
              <div>
                <label htmlFor={fieldId('access')} className={labelClass}>
                  Access Token
                </label>
                <input
                  id={fieldId('access')}
                  type="password"
                  autoComplete="off"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={config?.has_credentials ? KEEP_SECRET : 'Token de acceso de Meta'}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={fieldId('secret')} className={labelClass}>
                  App Secret
                </label>
                <input
                  id={fieldId('secret')}
                  type="password"
                  autoComplete="off"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder={config?.has_app_secret ? KEEP_SECRET : 'App Secret de su app de Meta'}
                  className={inputClass}
                />
                <p className={hintClass}>
                  Permite comprobar que cada mensaje viene de Meta. Está en Meta Developers → su app →
                  Configuración → Básica.
                </p>
              </div>
              <div>
                <label htmlFor={fieldId('phone-id')} className={labelClass}>
                  Phone Number ID
                </label>
                <input
                  id={fieldId('phone-id')}
                  type="text"
                  autoComplete="off"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="ID del número en Meta"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label htmlFor={fieldId('waba')} className={labelClass}>
                  WhatsApp Business Account ID
                </label>
                <input
                  id={fieldId('waba')}
                  type="text"
                  autoComplete="off"
                  value={businessAccountId}
                  onChange={(e) => setBusinessAccountId(e.target.value)}
                  placeholder="ID de la cuenta de negocio"
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
          )}

          {config && (
            <div className="space-y-4 border-t border-border-default pt-4">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">Datos para el proveedor</h3>
                <p className="mt-1 text-xs text-text-tertiary">
                  Registre estos datos en {config.provider === 'meta' ? 'Meta Developers' : 'la consola de Twilio'} para
                  que los mensajes lleguen al agente.
                </p>
              </div>

              <CopyField label="URL del webhook" value={webhookUrl} />
              {config.provider === 'meta' && <CopyField label="Token de verificación" value={verifyToken} />}

              {config.provider === 'twilio' ? (
                <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-text-secondary">
                  <li>En la consola de Twilio, abra Messaging → Senders → WhatsApp senders.</li>
                  <li>Seleccione su número de WhatsApp.</li>
                  <li>En «A message comes in», pegue la URL del webhook (HTTP POST).</li>
                  <li>Guarde los cambios.</li>
                </ol>
              ) : (
                <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-text-secondary">
                  <li>En Meta Developers, abra su app → WhatsApp → Configuración.</li>
                  <li>En «Webhooks», agregue la URL del webhook.</li>
                  <li>Pegue el token de verificación y elija «Verify and save».</li>
                  <li>Suscríbase al evento «messages».</li>
                  <li>Para comprobar la firma de los mensajes, registre el App Secret arriba.</li>
                </ol>
              )}
            </div>
          )}
        </AdvancedSection>

        <div className="flex justify-end">
          <Button type="button" isLoading={isSaving} onClick={() => save()}>
            {config ? 'Guardar cambios de WhatsApp' : 'Conectar WhatsApp'}
          </Button>
        </div>
      </section>

      {confirmDialog}
    </div>
  )
}
