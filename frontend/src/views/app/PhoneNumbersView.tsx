import { useCallback, useId, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import {
  createTwilioPhoneNumber,
  getAgents,
  getPhoneNumbers,
  updatePhoneNumber,
} from '@/api/VoiceRuntimeAPI'
import type { AgentListItem, PhoneNumber } from '@/types/agent'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import AdvancedSection from '@/components/ui/AdvancedSection'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { compactPhone, formatPhone, pluralize } from '@/lib/format'

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
  'h-10 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-primary-500'

const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'

function callDirectionLabel(phoneNumber: PhoneNumber): string {
  const inbound = phoneNumber.supports_inbound !== false
  const outbound = phoneNumber.supports_outbound !== false
  if (inbound && outbound) return 'Recibe y hace llamadas'
  if (inbound) return 'Solo recibe llamadas'
  if (outbound) return 'Solo hace llamadas'
  return 'Sin llamadas habilitadas'
}

function providerLabel(provider: string): string {
  return provider === 'sip_trunk' ? 'Troncal SIP' : 'Twilio'
}

export default function PhoneNumbersView() {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [showImportModal, setShowImportModal] = useState(false)
  const [form, setForm] = useState<TwilioFormState>(emptyForm)
  const [submitted, setSubmitted] = useState(false)
  const [updatingPhoneId, setUpdatingPhoneId] = useState<string | null>(null)
  const { isSuperAdmin } = useCurrentUser()
  const fieldId = useId()

  const scopedUserId = searchParams.get('user_id') || undefined

  const {
    data: phoneNumbersData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['phone-numbers', scopedUserId ?? 'all'],
    queryFn: () => getPhoneNumbers({ userId: scopedUserId }),
    retry: false,
  })

  const { data: agentsData } = useQuery({
    queryKey: ['agents', scopedUserId ?? 'all'],
    queryFn: () => getAgents({ userId: scopedUserId }),
    retry: false,
  })

  const phoneNumbers: PhoneNumber[] = phoneNumbersData ?? []
  const agents: AgentListItem[] = agentsData?.agents ?? []
  const canImport = !isError && (isSuperAdmin || phoneNumbers.length < 1)

  // Estable: ui/Modal reinicia el foco si cambia la referencia de onClose.
  const closeImportModal = useCallback(() => {
    setShowImportModal(false)
    setForm(emptyForm)
    setSubmitted(false)
  }, [])

  const { mutate: importTwilioNumber, isPending: isImporting } = useMutation({
    mutationFn: () =>
      createTwilioPhoneNumber({
        ...form,
        label: form.label.trim(),
        phone_number: compactPhone(form.phone_number),
        sid: form.sid.trim(),
        token: form.token.trim(),
      }),
    onSuccess: () => {
      toast.success('Número agregado')
      queryClient.invalidateQueries({ queryKey: ['phone-numbers'] })
      closeImportModal()
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const { mutate: assignPhoneNumber } = useMutation({
    mutationFn: ({ phoneNumberId, agentId }: { phoneNumberId: string; agentId: string | null }) =>
      updatePhoneNumber(phoneNumberId, { agent_id: agentId }),
    onSuccess: (_result, variables) => {
      toast.success(variables.agentId ? 'Agente asignado al número' : 'El número quedó sin agente')
      queryClient.invalidateQueries({ queryKey: ['phone-numbers'] })
      setUpdatingPhoneId(null)
    },
    onError: (mutationError: Error) => {
      toast.error(mutationError.message)
      setUpdatingPhoneId(null)
    },
  })

  const missing = {
    label: !form.label.trim(),
    phone_number: !form.phone_number.trim(),
    sid: !form.sid.trim(),
    token: !form.token.trim(),
  }
  const credentialsMissing = submitted && (missing.sid || missing.token)

  const handleImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (Object.values(missing).some(Boolean)) return
    importTwilioNumber()
  }

  const errorFor = (key: keyof TwilioFormState, message: string) =>
    submitted && missing[key] ? (
      <p id={`${fieldId}-${key}-error`} className="mt-1 text-sm text-danger-700">
        {message}
      </p>
    ) : null

  const fieldA11y = (key: keyof TwilioFormState) => ({
    id: `${fieldId}-${key}`,
    'aria-invalid': submitted && missing[key] ? true : undefined,
    'aria-describedby': submitted && missing[key] ? `${fieldId}-${key}-error` : undefined,
  })

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
        <PageHeader
          title="Números de teléfono"
          description="Las líneas por las que sus agentes de voz reciben y hacen llamadas. Elija qué agente contesta en cada número."
          actions={
            canImport ? (
              <Button
                onClick={() => setShowImportModal(true)}
                leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
              >
                Agregar número
              </Button>
            ) : undefined
          }
        />

        {scopedUserId && (
          <p className="mb-4 text-sm text-text-tertiary">Está viendo los números de un usuario específico.</p>
        )}

        <section
          aria-label="Números de teléfono"
          className="overflow-hidden rounded-xl border border-border-default bg-surface"
        >
          {isLoading ? (
            <p className="px-6 py-12 text-center text-sm text-text-tertiary">Cargando números…</p>
          ) : isError ? (
            <div className="px-6 py-10 sm:px-8">
              <p className="text-sm font-medium text-text-primary">La telefonía aún no está disponible en esta cuenta.</p>
              <p className="mt-1 max-w-[65ch] text-sm text-text-secondary">
                Cuando el servicio de llamadas esté activo, aquí verá sus números y podrá asignarlos a sus agentes de
                voz. Si lo necesita pronto, comuníquese con el equipo de soporte.
              </p>
              {isSuperAdmin && error instanceof Error && (
                <p className="mt-3 text-xs text-text-tertiary">Detalle técnico: {error.message}</p>
              )}
            </div>
          ) : phoneNumbers.length === 0 ? (
            <div className="px-6 py-10 sm:px-8">
              <p className="text-sm font-medium text-text-primary">Aún no tiene números de teléfono.</p>
              <p className="mt-1 max-w-[65ch] text-sm text-text-secondary">
                Cuando agregue una línea, podrá elegir qué agente de voz contesta las llamadas que entren por ella.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden border-b border-border-default bg-surface-muted px-5 py-3 text-sm font-medium text-text-secondary @2xl:grid @2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,15rem)] @2xl:gap-6">
                <span>Número</span>
                <span>Llamadas</span>
                <span>Agente que contesta</span>
              </div>
              <ul className="divide-y divide-border-subtle">
                {phoneNumbers.map((phoneNumber) => {
                  const isUpdating = updatingPhoneId === phoneNumber.phone_number_id
                  const currentAgentId = phoneNumber.assigned_agent?.agent_id ?? ''
                  const selectId = `${fieldId}-agent-${phoneNumber.phone_number_id}`

                  return (
                    <li
                      key={phoneNumber.phone_number_id}
                      className="grid gap-3 px-5 py-4 @2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,15rem)] @2xl:items-center @2xl:gap-6"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-primary">
                          {phoneNumber.label || formatPhone(phoneNumber.phone_number)}
                        </p>
                        <p className="text-sm tabular-nums text-text-secondary">
                          {formatPhone(phoneNumber.phone_number)}
                        </p>
                        {isSuperAdmin && (
                          <p className="mt-0.5 text-xs text-text-tertiary">
                            {providerLabel(phoneNumber.provider)}
                            {phoneNumber.livekit_stack ? ` · ${phoneNumber.livekit_stack}` : ''}
                            {phoneNumber.owner_info?.email ? ` · ${phoneNumber.owner_info.email}` : ''}
                          </p>
                        )}
                      </div>

                      <p className="text-sm text-text-secondary">{callDirectionLabel(phoneNumber)}</p>

                      <div>
                        <label htmlFor={selectId} className="mb-1 block text-xs text-text-tertiary @2xl:sr-only">
                          Agente que contesta
                        </label>
                        <select
                          id={selectId}
                          value={currentAgentId}
                          disabled={isUpdating}
                          onChange={(event) => {
                            setUpdatingPhoneId(phoneNumber.phone_number_id)
                            assignPhoneNumber({
                              phoneNumberId: phoneNumber.phone_number_id,
                              agentId: event.target.value || null,
                            })
                          }}
                          className={`${inputClass} disabled:opacity-60`}
                        >
                          <option value="">Sin asignar</option>
                          {agents.map((agent) => (
                            <option key={agent.agent_id} value={agent.agent_id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="border-t border-border-subtle px-5 py-3 text-xs tabular-nums text-text-tertiary">
                {pluralize(phoneNumbers.length, 'número', 'números')}
              </p>
            </>
          )}
        </section>

        <AdvancedSection
          className="mt-6"
          title="Cómo se conectan las líneas"
          description="Detalles técnicos del proveedor de telefonía."
          defaultOpen={isSuperAdmin}
        >
          <div className="space-y-3 text-sm leading-relaxed text-text-secondary">
            <p>
              <span className="font-medium text-text-primary">Twilio.</span> Puede agregar un número comprado en Twilio
              (recibe y hace llamadas) o un identificador de llamadas verificado (solo hace llamadas). Se necesitan el
              Account SID y el Auth Token de la cuenta de Twilio.
            </p>
            <p>
              <span className="font-medium text-text-primary">Troncal SIP.</span> Las líneas de su operador conectadas
              por SIP las configura el equipo técnico; aparecen en esta lista listas para asignarlas a un agente.
            </p>
          </div>
        </AdvancedSection>
      </div>

      <Modal
        open={showImportModal}
        onClose={closeImportModal}
        title="Agregar número de teléfono"
        description="Registre la línea para que sus agentes de voz puedan usarla."
        dismissOnBackdrop={false}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeImportModal}>
              Cancelar
            </Button>
            <Button type="submit" form={`${fieldId}-import-form`} isLoading={isImporting}>
              Agregar número
            </Button>
          </>
        }
      >
        <form id={`${fieldId}-import-form`} onSubmit={handleImport} className="space-y-4" noValidate>
          <div>
            <label htmlFor={`${fieldId}-label`} className={labelClass}>
              Nombre de la línea
            </label>
            <input
              type="text"
              {...fieldA11y('label')}
              value={form.label}
              onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
              placeholder="Ej.: Línea de atención al cliente"
              className={inputClass}
            />
            {errorFor('label', 'Escriba un nombre para reconocer la línea.')}
          </div>

          <div>
            <label htmlFor={`${fieldId}-phone_number`} className={labelClass}>
              Número
            </label>
            <input
              type="tel"
              {...fieldA11y('phone_number')}
              value={form.phone_number}
              onChange={(event) => setForm((prev) => ({ ...prev, phone_number: event.target.value }))}
              placeholder="+57 300 123 4567"
              className={`${inputClass} tabular-nums`}
            />
            {errorFor('phone_number', 'Escriba el número con el indicativo del país.')}
          </div>

          <AdvancedSection
            title="Credenciales de la cuenta de telefonía"
            description="Obligatorias. Las encuentra en la consola de Twilio."
            defaultOpen={isSuperAdmin || credentialsMissing}
          >
            <div>
              <label htmlFor={`${fieldId}-sid`} className={labelClass}>
                Account SID
              </label>
              <input
                type="text"
                {...fieldA11y('sid')}
                value={form.sid}
                onChange={(event) => setForm((prev) => ({ ...prev, sid: event.target.value }))}
                placeholder="AC…"
                autoComplete="off"
                className={inputClass}
              />
              {errorFor('sid', 'Falta el Account SID.')}
            </div>
            <div>
              <label htmlFor={`${fieldId}-token`} className={labelClass}>
                Auth Token
              </label>
              <input
                type="password"
                {...fieldA11y('token')}
                value={form.token}
                onChange={(event) => setForm((prev) => ({ ...prev, token: event.target.value }))}
                autoComplete="new-password"
                className={inputClass}
              />
              {errorFor('token', 'Falta el Auth Token.')}
            </div>
          </AdvancedSection>
        </form>
      </Modal>
    </div>
  )
}
