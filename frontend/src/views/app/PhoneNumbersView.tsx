import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowsRightLeftIcon,
  PhoneIcon,
  PlusIcon,
  SignalIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import {
  createTwilioPhoneNumber,
  getAgents,
  getPhoneNumbers,
  updatePhoneNumber,
} from '@/api/VoiceRuntimeAPI'
import type { AgentListItem, PhoneNumber } from '@/types/agent'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type TwilioFormState = {
  label: string
  phone_number: string
  sid: string
  token: string
}

const emptyForm: TwilioFormState = {
  label: '',
  phone_number: '',
  sid: '',
  token: '',
}

const inputClass =
  'w-full rounded-xl border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-all duration-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none'

function ProviderBadge({ provider }: { provider: string }) {
  const isSip = provider === 'sip_trunk'

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        isSip
          ? 'bg-accent-50 text-accent-700'
          : 'bg-primary-50 text-primary-600'
      }`}
    >
      {isSip ? 'SIP trunk' : 'Twilio'}
    </span>
  )
}

export default function PhoneNumbersView() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [showImportModal, setShowImportModal] = useState(false)
  const [form, setForm] = useState<TwilioFormState>(emptyForm)
  const [updatingPhoneId, setUpdatingPhoneId] = useState<string | null>(null)
  const { isSuperAdmin } = useCurrentUser()

  const scopedUserId = searchParams.get('user_id') || undefined

  const { data: phoneNumbersData, isLoading } = useQuery({
    queryKey: ['phone-numbers', scopedUserId ?? 'all'],
    queryFn: () => getPhoneNumbers({ userId: scopedUserId }),
  })

  const { data: agentsData } = useQuery({
    queryKey: ['agents', scopedUserId ?? 'all'],
    queryFn: () => getAgents({ userId: scopedUserId }),
  })

  const phoneNumbers: PhoneNumber[] = phoneNumbersData ?? []
  const agents: AgentListItem[] = agentsData?.agents ?? []
  const canImport = isSuperAdmin || phoneNumbers.length < 1

  const { mutate: importTwilioNumber, isPending: isImporting } = useMutation({
    mutationFn: () => createTwilioPhoneNumber(form),
    onSuccess: () => {
      toast.success('Numero importado')
      queryClient.invalidateQueries({ queryKey: ['phone-numbers'] })
      setShowImportModal(false)
      setForm(emptyForm)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: assignPhoneNumber } = useMutation({
    mutationFn: ({
      phoneNumberId,
      agentId,
    }: {
      phoneNumberId: string
      agentId: string | null
    }) => updatePhoneNumber(phoneNumberId, { agent_id: agentId }),
    onSuccess: () => {
      toast.success('Asignacion actualizada')
      queryClient.invalidateQueries({ queryKey: ['phone-numbers'] })
      setUpdatingPhoneId(null)
    },
    onError: (error: Error) => {
      toast.error(error.message)
      setUpdatingPhoneId(null)
    },
  })

  return (
    <div className="h-full overflow-y-auto">
    <div className="w-full p-8">
      <section className="section-enter mb-8 overflow-hidden rounded-3xl border border-border-default bg-surface px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-600">
              Telephony
            </p>
            <h1 className="mt-2 text-3xl font-bold text-text-primary">
              Numeros de telefono
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-text-secondary">
              Esta vista usa los phone numbers reales de la plataforma. Twilio se
              puede importar desde aqui y los numeros ya existentes, incluyendo
              SIP trunk, se pueden asignar a tus agentes.
            </p>
          </div>

          {canImport && (
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
            >
              <PlusIcon className="h-4 w-4" />
              Importar Twilio
            </button>
          )}
        </div>
      </section>

      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text-primary">Tus numeros</h2>
        <p className="mt-1 text-sm text-text-secondary">
          {scopedUserId
            ? 'Vista filtrada por usuario para supervision administrativa.'
            : 'Solo se muestran numeros asociados a tu cuenta para mantener el aislamiento entre usuarios del workspace.'}
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-border-default bg-surface shadow-sm">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-text-secondary">
            <div className="flex items-center gap-2.5">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
              Cargando numeros...
            </div>
          </div>
        ) : phoneNumbers.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50">
              <PhoneIcon className="h-6 w-6 text-primary-600" />
            </div>
            <p className="text-sm text-text-primary">
              Aun no hay numeros asociados a tu cuenta.
            </p>
            <p className="max-w-xl text-sm text-text-tertiary">
              Puedes importar un numero Twilio desde esta consola. Los numeros
              SIP trunk que ya existan en tu workspace tambien apareceran aqui
              para asignarlos al agente correcto.
            </p>
            {canImport && (
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="text-sm font-medium text-primary-600 transition-colors hover:text-[#1f0d5a]"
              >
                Importar primer numero
              </button>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-default">
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                  Numero
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                  Provider
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                  Propietario
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                  Capacidades
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                  Agente asignado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e0f5]">
              {phoneNumbers.map((phoneNumber) => {
                const isUpdating = updatingPhoneId === phoneNumber.phone_number_id
                const currentAgentId = phoneNumber.assigned_agent?.agent_id ?? ''

                return (
                  <tr key={phoneNumber.phone_number_id}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-50">
                          <PhoneIcon className="h-4 w-4 text-primary-600" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {phoneNumber.label}
                          </p>
                          <p className="text-sm text-text-secondary">
                            {phoneNumber.phone_number}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <ProviderBadge provider={phoneNumber.provider} />
                    </td>
                    <td className="px-6 py-4 text-sm text-text-secondary">
                      {phoneNumber.owner_info?.email ?? '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-secondary">
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-[#f0edff] px-2.5 py-1 text-xs">
                          Inbound:{' '}
                          {phoneNumber.supports_inbound === false ? 'No' : 'Si'}
                        </span>
                        <span className="rounded-full bg-[#f0edff] px-2.5 py-1 text-xs">
                          Outbound:{' '}
                          {phoneNumber.supports_outbound === false ? 'No' : 'Si'}
                        </span>
                        {phoneNumber.provider === 'sip_trunk' &&
                          phoneNumber.livekit_stack && (
                            <span className="rounded-full bg-[#f0edff] px-2.5 py-1 text-xs">
                              Stack: {phoneNumber.livekit_stack}
                            </span>
                          )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="max-w-xs">
                        <select
                          value={currentAgentId}
                          disabled={isUpdating}
                          onChange={(event) => {
                            setUpdatingPhoneId(phoneNumber.phone_number_id)
                            assignPhoneNumber({
                              phoneNumberId: phoneNumber.phone_number_id,
                              agentId: event.target.value || null,
                            })
                          }}
                          className="w-full rounded-xl border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary transition-colors focus:border-primary-500 focus:outline-none"
                        >
                          <option value="">Sin asignar</option>
                          {agents.map((agent) => (
                            <option key={agent.agent_id} value={agent.agent_id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-border-default bg-surface p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ArrowsRightLeftIcon className="h-5 w-5 text-primary-600" />
            <h3 className="text-base font-semibold text-text-primary">
              Twilio nativo
            </h3>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">
            la plataforma soporta dos tipos de numeros Twilio: numeros comprados en
            Twilio con inbound + outbound, y caller IDs verificados para
            outbound. Esta consola importa el numero con label, SID y Auth
            Token, y despues puedes asignarlo al agente si soporta inbound.
          </p>
        </div>

        <div className="rounded-3xl border border-border-default bg-surface p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <SignalIcon className="h-5 w-5 text-accent-600" />
            <h3 className="text-base font-semibold text-text-primary">
              SIP trunk
            </h3>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">
            la plataforma tambien lista phone numbers con provider{' '}
            <span className="rounded bg-[#f0edff] px-1.5 py-0.5 font-mono text-[11px] text-text-primary">
              sip_trunk
            </span>
            . Los mostramos aqui con su stack y quedan listos para asignacion.
            Mantengo la importacion SIP fuera de esta primera pasada hasta
            exponer el contrato completo del request sin adivinar campos.
          </p>
        </div>
      </div>

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="modal-content mx-4 w-full max-w-lg rounded-2xl border border-border-default bg-surface p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-text-primary">
                Importar numero Twilio
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false)
                  setForm(emptyForm)
                }}
                className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-primary-50/60 hover:text-text-primary"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {[
                { key: 'label', label: 'Label', placeholder: 'Customer Support Line', type: 'text' },
                { key: 'phone_number', label: 'Numero', placeholder: '+573001234567', type: 'text' },
                { key: 'sid', label: 'Twilio SID', placeholder: 'AC...', type: 'text' },
                { key: 'token', label: 'Twilio token', placeholder: 'Auth Token', type: 'password' },
              ].map(({ key, label, placeholder, type }) => (
                <div key={key}>
                  <label className="mb-1.5 block text-sm font-medium text-text-primary">
                    {label}
                  </label>
                  <input
                    type={type}
                    value={form[key as keyof TwilioFormState]}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                    placeholder={placeholder}
                    className={inputClass}
                  />
                </div>
              ))}
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false)
                  setForm(emptyForm)
                }}
                className="flex-1 rounded-xl bg-[#f5f3ff] px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-primary-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => importTwilioNumber()}
                disabled={
                  isImporting ||
                  !form.label ||
                  !form.phone_number ||
                  !form.sid ||
                  !form.token
                }
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
              >
                {isImporting && (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                Importar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
  )
}


