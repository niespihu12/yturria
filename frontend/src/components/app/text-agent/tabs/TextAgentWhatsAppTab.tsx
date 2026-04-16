import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  CheckCircleIcon,
  ClipboardDocumentIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { deleteWhatsAppConfig, getWhatsAppConfig, upsertWhatsAppConfig } from '@/api/TextAgentsAPI'
import { WHATSAPP_PROVIDER_OPTIONS, type WhatsAppProvider } from '@/types/textAgent'

type Props = {
  agentId: string
  backendBaseUrl?: string
}

const inputClass =
  'w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none'

const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-black/50'

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={value}
          className="min-w-0 flex-1 rounded-xl border border-[#e4e0f5] bg-[#fafafa] px-3 py-2.5 font-mono text-xs text-black/70 focus:outline-none"
        />
        <button
          type="button"
          onClick={copy}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all ${
            copied
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-[#e4e0f5] text-black/60 hover:border-[#271173] hover:text-[#271173]'
          }`}
        >
          {copied ? (
            <>
              <CheckCircleIcon className="h-3.5 w-3.5" />
              Copiado
            </>
          ) : (
            <>
              <ClipboardDocumentIcon className="h-3.5 w-3.5" />
              Copiar
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default function TextAgentWhatsAppTab({ agentId, backendBaseUrl }: Props) {
  const queryClient = useQueryClient()
  const baseUrl = backendBaseUrl ?? (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:8000` : '')

  const { data, isLoading } = useQuery({
    queryKey: ['text-agent-whatsapp', agentId],
    queryFn: () => getWhatsAppConfig(agentId),
  })

  const config = data?.config ?? null

  const [provider, setProvider] = useState<WhatsAppProvider>(config?.provider ?? 'twilio')
  const [phoneNumber, setPhoneNumber] = useState(config?.phone_number ?? '')
  const [accountSid, setAccountSid] = useState(config?.account_sid ?? '')
  const [authToken, setAuthToken] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState(config?.phone_number_id ?? '')
  const [businessAccountId, setBusinessAccountId] = useState(config?.business_account_id ?? '')

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
        phone_number_id: phoneNumberId,
        business_account_id: businessAccountId,
      }),
    onSuccess: () => {
      toast.success('Configuración de WhatsApp guardada')
      setAuthToken('')
      setAccessToken('')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: remove, isPending: isRemoving } = useMutation({
    mutationFn: () => deleteWhatsAppConfig(agentId),
    onSuccess: () => {
      toast.success('Configuración eliminada')
      setPhoneNumber('')
      setAccountSid('')
      setAuthToken('')
      setAccessToken('')
      setPhoneNumberId('')
      setBusinessAccountId('')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const webhookUrl = config
    ? `${baseUrl}/api/webhooks/whatsapp/${config.id}/${config.provider}`
    : ''

  const verifyToken = config?.webhook_verify_token ?? ''

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-black/60">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
        Cargando configuración...
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Status banner */}
      {config ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-800">
              WhatsApp conectado via {config.provider === 'meta' ? 'Meta Cloud API' : 'Twilio'}
            </p>
            <p className="text-xs text-emerald-700">
              {config.has_credentials ? 'Credenciales configuradas' : 'Faltan credenciales'} ·{' '}
              {config.active ? 'Activo' : 'Inactivo'}
            </p>
          </div>
          <button
            type="button"
            disabled={isRemoving}
            onClick={() => remove()}
            className="rounded-lg border border-rose-200 p-1.5 text-rose-500 transition-colors hover:bg-rose-50 disabled:opacity-50"
            title="Eliminar configuración"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#e4e0f5] bg-[#fafafa] px-5 py-4">
          <p className="text-sm font-semibold text-black">Conectar WhatsApp</p>
          <p className="mt-1 text-xs text-black/50">
            Conecta este agente a un número de WhatsApp para recibir y responder mensajes
            automáticamente.
          </p>
        </div>
      )}

      {/* Provider selector */}
      <div>
        <label className={labelClass}>Proveedor</label>
        <div className="grid gap-3 sm:grid-cols-2">
          {WHATSAPP_PROVIDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setProvider(opt.value)}
              className={`rounded-xl border p-4 text-left transition-colors duration-150 ease-out ${
                provider === opt.value
                  ? 'border-[#271173] bg-[#ede9ff] ring-1 ring-[#271173]'
                  : 'border-[#e4e0f5] bg-white hover:border-[#271173]/30 hover:bg-[#f5f3ff]'
              }`}
            >
              <p className="text-sm font-semibold text-black">{opt.label}</p>
              <p className="mt-1 text-xs text-black/50 leading-relaxed">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Credentials form */}
      <div className="space-y-4 rounded-2xl border border-[#e4e0f5] bg-white p-5">
        <h3 className="text-sm font-semibold text-black">Credenciales</h3>

        <div>
          <label className={labelClass}>Número de WhatsApp</label>
          <input
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="+573001234567"
            className={inputClass}
          />
        </div>

        {provider === 'twilio' && (
          <>
            <div>
              <label className={labelClass}>Account SID</label>
              <input
                type="text"
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Auth Token</label>
              <input
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={config?.has_credentials ? '••••••••  (dejar vacío para mantener)' : 'Tu auth token de Twilio'}
                className={inputClass}
              />
            </div>
          </>
        )}

        {provider === 'meta' && (
          <>
            <div>
              <label className={labelClass}>Access Token</label>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={config?.has_credentials ? '••••••••  (dejar vacío para mantener)' : 'Token de acceso de Meta API'}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Phone Number ID</label>
              <input
                type="text"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="ID del número en Meta"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>WhatsApp Business Account ID</label>
              <input
                type="text"
                value={businessAccountId}
                onChange={(e) => setBusinessAccountId(e.target.value)}
                placeholder="ID de tu cuenta de negocio"
                className={inputClass}
              />
            </div>
          </>
        )}

        <button
          type="button"
          disabled={isSaving}
          onClick={() => save()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
        >
          {isSaving && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          Guardar configuración
        </button>
      </div>

      {/* Webhook info */}
      {config && (
        <div className="space-y-4 rounded-2xl border border-[#e4e0f5] bg-white p-5">
          <div>
            <h3 className="text-sm font-semibold text-black">Configuración del webhook</h3>
            <p className="mt-1 text-xs text-black/50">
              Usa estas URLs y tokens en el panel de {config.provider === 'meta' ? 'Meta Developers' : 'Twilio Console'}.
            </p>
          </div>

          <CopyField label="URL del webhook" value={webhookUrl} />
          {config.provider === 'meta' && (
            <CopyField label="Token de verificación" value={verifyToken} />
          )}

          {config.provider === 'twilio' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold text-amber-800">Instrucciones Twilio</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-amber-700">
                <li>Ve a Twilio Console → Messaging → Senders → WhatsApp senders</li>
                <li>Selecciona tu número de WhatsApp</li>
                <li>En "A message comes in" pega la URL del webhook (HTTP POST)</li>
                <li>Guarda los cambios</li>
              </ol>
            </div>
          )}

          {config.provider === 'meta' && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-semibold text-blue-800">Instrucciones Meta</p>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-blue-700">
                <li>Ve a Meta Developers → Tu App → WhatsApp → Configuración</li>
                <li>En "Webhooks" agrega la URL del webhook</li>
                <li>Pega el Token de verificación y haz clic en "Verify and save"</li>
                <li>Suscríbete al evento <code>messages</code></li>
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
