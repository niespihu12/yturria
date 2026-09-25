import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { TrashIcon } from '@heroicons/react/24/outline'
import {
  createTextAgentAppointment,
  deleteTextAgentAppointment,
  updateTextAgentAppointment,
} from '@/api/TextAgentsAPI'
import {
  createVoiceAgentAppointment,
  deleteVoiceAgentAppointment,
  updateVoiceAgentAppointment,
} from '@/api/VoiceRuntimeAPI'
import type { TextAppointmentStatus } from '@/types/textAgent'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import {
  CHANNEL_LABELS,
  STATUS_OPTIONS,
  agentKey,
  appointmentChannel,
  contactLabel,
  formatDayTitle,
  formatTime,
  splitAgentKey,
  toInputDateValue,
  type AgentOption,
  type CalendarAppointment,
} from './calendar'

type FormState = {
  agentKey: string
  appointmentDate: string
  timezone: string
  contactName: string
  contactPhone: string
  contactEmail: string
  status: TextAppointmentStatus
  notes: string
}

type Props = {
  /** Sin cita: se crea una nueva en `initialDate`. */
  appointment?: CalendarAppointment | null
  initialDate: Date
  agents: AgentOption[]
  onClose: () => void
  onChanged: () => void
}

const inputClass =
  'h-10 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-primary-500 disabled:cursor-not-allowed disabled:bg-surface-muted'

const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'

function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota'
}

function buildCreateForm(agents: AgentOption[], date: Date): FormState {
  const withTime = new Date(date)
  withTime.setHours(10, 0, 0, 0)
  const firstAgent = agents.find((agent) => agent.kind === 'text') ?? agents[0]

  return {
    agentKey: firstAgent ? agentKey(firstAgent.kind, firstAgent.id) : '',
    appointmentDate: toInputDateValue(withTime),
    timezone: defaultTimezone(),
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    status: 'scheduled',
    notes: '',
  }
}

function buildEditForm(appointment: CalendarAppointment): FormState {
  return {
    agentKey: agentKey(appointment.agentKind, appointment.agent_id),
    appointmentDate: toInputDateValue(new Date(appointment.appointment_date_unix_secs * 1000)),
    timezone: appointment.timezone || 'America/Bogota',
    contactName: appointment.contact_name || '',
    contactPhone: appointment.contact_phone || '',
    contactEmail: appointment.contact_email || '',
    status: appointment.status,
    notes: appointment.notes || '',
  }
}

function hasContact(form: FormState): boolean {
  return Boolean(form.contactName.trim() || form.contactPhone.trim() || form.contactEmail.trim())
}

function buildPayload(form: FormState) {
  if (!hasContact(form)) {
    throw new Error('Incluya al menos el nombre, el teléfono o el correo del cliente.')
  }
  const appointmentDate = new Date(form.appointmentDate)
  if (Number.isNaN(appointmentDate.getTime())) {
    throw new Error('La fecha y la hora de la cita no son válidas.')
  }
  return {
    appointment_date: appointmentDate.toISOString(),
    contact_name: form.contactName.trim(),
    contact_phone: form.contactPhone.trim(),
    contact_email: form.contactEmail.trim(),
    timezone: form.timezone.trim() || 'America/Bogota',
    status: form.status,
    notes: form.notes.trim(),
  }
}

/** Crear o editar una cita. Eliminar y cancelar piden confirmación explicando qué pasa. */
export default function AppointmentFormModal({ appointment, initialDate, agents, onClose, onChanged }: Props) {
  const isEdit = Boolean(appointment)
  const fieldId = useId()
  const formId = `${fieldId}-form`
  const [confirm, confirmDialog] = useConfirm()
  // Con la confirmación abierta, Esc solo debe cerrar la confirmación.
  const confirmingRef = useRef(false)
  const [form, setForm] = useState<FormState>(() =>
    appointment ? buildEditForm(appointment) : buildCreateForm(agents, initialDate),
  )

  const textAgents = agents.filter((agent) => agent.kind === 'text')
  const voiceAgents = agents.filter((agent) => agent.kind === 'voice')

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const { mutate: createAppointment, isPending: isCreating } = useMutation({
    mutationFn: async () => {
      const { kind, id } = splitAgentKey(form.agentKey)
      if (!id) {
        throw new Error('Seleccione el agente con el que se agenda la cita.')
      }
      const payload = { ...buildPayload(form), source: kind === 'voice' ? ('voice' as const) : ('manual' as const) }
      return kind === 'voice' ? createVoiceAgentAppointment(id, payload) : createTextAgentAppointment(id, payload)
    },
    onSuccess: () => {
      toast.success('Cita agendada')
      onChanged()
      onClose()
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const { mutate: updateAppointment, isPending: isUpdating } = useMutation({
    mutationFn: async () => {
      if (!appointment) throw new Error('No hay una cita seleccionada.')
      const payload = buildPayload(form)
      return appointment.agentKind === 'voice'
        ? updateVoiceAgentAppointment(appointment.agent_id, appointment.id, payload)
        : updateTextAgentAppointment(appointment.agent_id, appointment.id, payload)
    },
    onSuccess: () => {
      toast.success('Cita actualizada')
      onChanged()
      onClose()
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const { mutate: deleteAppointment, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      if (!appointment) throw new Error('No hay una cita seleccionada.')
      return appointment.agentKind === 'voice'
        ? deleteVoiceAgentAppointment(appointment.agent_id, appointment.id)
        : deleteTextAgentAppointment(appointment.agent_id, appointment.id)
    },
    onSuccess: () => {
      toast.success('Cita eliminada')
      onChanged()
      onClose()
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const isBusy = isCreating || isUpdating || isDeleting
  const canSubmit = Boolean(form.appointmentDate.trim()) && hasContact(form) && (isEdit || Boolean(form.agentKey))

  const ask = async (options: Parameters<typeof confirm>[0]) => {
    confirmingRef.current = true
    const accepted = await confirm(options)
    confirmingRef.current = false
    return accepted
  }

  const handleClose = useCallback(() => {
    if (!confirmingRef.current) onClose()
  }, [onClose])

  const whenLabel = appointment
    ? `${formatDayTitle(new Date(appointment.appointment_date_unix_secs * 1000)).toLocaleLowerCase('es-CO')} a las ${formatTime(appointment.appointment_date_unix_secs)}`
    : ''

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || isBusy) return

    if (appointment && form.status === 'cancelled' && appointment.status !== 'cancelled') {
      const accepted = await ask({
        title: 'Cancelar la cita',
        description: `La cita de ${contactLabel(appointment)} del ${whenLabel} quedará como cancelada y ese horario quedará libre para otra cita.`,
        confirmLabel: 'Cancelar cita',
        cancelLabel: 'Volver',
      })
      if (!accepted) return
    }

    if (isEdit) {
      updateAppointment()
    } else {
      createAppointment()
    }
  }

  const requestDelete = async () => {
    if (!appointment) return
    const accepted = await ask({
      title: 'Eliminar cita',
      description: `La cita de ${contactLabel(appointment)} del ${whenLabel} desaparecerá de la agenda. Si solo quiere dejar constancia de que no se hará, cambie su estado a «Cancelada».`,
      confirmLabel: 'Eliminar cita',
      tone: 'danger',
    })
    if (accepted) deleteAppointment()
  }

  const id = (name: string) => `${fieldId}-${name}`

  return (
    <>
      <Modal
        open
        onClose={handleClose}
        title={isEdit ? 'Editar cita' : 'Nueva cita'}
        description={
          appointment
            ? `${CHANNEL_LABELS[appointmentChannel(appointment)]} · ${appointment.agent_name}`
            : 'Registre una cita con un cliente. Aparecerá en la agenda de inmediato.'
        }
        size="lg"
        dismissOnBackdrop={false}
        footer={
          <>
            {isEdit && (
              <Button
                type="button"
                variant="ghost"
                onClick={requestDelete}
                disabled={isBusy}
                isLoading={isDeleting}
                leftIcon={<TrashIcon className="h-4 w-4" aria-hidden="true" />}
                className="text-danger-700 hover:bg-danger-50 hover:text-danger-700 sm:mr-auto"
              >
                Eliminar cita
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>
              {isEdit ? 'Cerrar' : 'Cancelar'}
            </Button>
            <Button type="submit" form={formId} disabled={!canSubmit || isDeleting} isLoading={isCreating || isUpdating}>
              {isEdit ? 'Guardar cambios' : 'Agendar cita'}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {!isEdit && (
              <div className="sm:col-span-2">
                <label htmlFor={id('agent')} className={labelClass}>
                  Agente
                </label>
                <select
                  id={id('agent')}
                  value={form.agentKey}
                  onChange={(event) => update('agentKey', event.target.value)}
                  className={inputClass}
                >
                  {agents.length === 0 && <option value="">No hay agentes disponibles</option>}
                  {textAgents.length > 0 && (
                    <optgroup label="Agentes de chat">
                      {textAgents.map((agent) => (
                        <option key={agentKey(agent.kind, agent.id)} value={agentKey(agent.kind, agent.id)}>
                          {agent.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {voiceAgents.length > 0 && (
                    <optgroup label="Agentes de voz">
                      {voiceAgents.map((agent) => (
                        <option key={agentKey(agent.kind, agent.id)} value={agentKey(agent.kind, agent.id)}>
                          {agent.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}

            <div>
              <label htmlFor={id('date')} className={labelClass}>
                Fecha y hora
              </label>
              <input
                id={id('date')}
                type="datetime-local"
                required
                value={form.appointmentDate}
                onChange={(event) => update('appointmentDate', event.target.value)}
                className={`${inputClass} tabular-nums`}
              />
            </div>

            <div>
              <label htmlFor={id('timezone')} className={labelClass}>
                Zona horaria
              </label>
              <input
                id={id('timezone')}
                type="text"
                value={form.timezone}
                onChange={(event) => update('timezone', event.target.value)}
                placeholder="America/Bogota"
                className={inputClass}
              />
            </div>
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-text-primary">Cliente</legend>
            <p id={id('contact-help')} className="-mt-2 text-xs text-text-tertiary">
              Incluya al menos un dato: nombre, teléfono o correo.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor={id('name')} className={labelClass}>
                  Nombre
                </label>
                <input
                  id={id('name')}
                  type="text"
                  value={form.contactName}
                  onChange={(event) => update('contactName', event.target.value)}
                  aria-describedby={id('contact-help')}
                  placeholder="Ej.: Laura Gómez"
                  autoComplete="off"
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor={id('phone')} className={labelClass}>
                  Teléfono
                </label>
                <input
                  id={id('phone')}
                  type="tel"
                  value={form.contactPhone}
                  onChange={(event) => update('contactPhone', event.target.value)}
                  placeholder="+57 300 123 4567"
                  autoComplete="off"
                  className={`${inputClass} tabular-nums`}
                />
              </div>
              <div>
                <label htmlFor={id('email')} className={labelClass}>
                  Correo electrónico
                </label>
                <input
                  id={id('email')}
                  type="email"
                  value={form.contactEmail}
                  onChange={(event) => update('contactEmail', event.target.value)}
                  placeholder="nombre@correo.com"
                  autoComplete="off"
                  className={inputClass}
                />
              </div>
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={id('status')} className={labelClass}>
                Estado
              </label>
              <select
                id={id('status')}
                value={form.status}
                onChange={(event) => update('status', event.target.value as TextAppointmentStatus)}
                className={inputClass}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor={id('notes')} className={labelClass}>
                Nota
              </label>
              <textarea
                id={id('notes')}
                rows={3}
                value={form.notes}
                onChange={(event) => update('notes', event.target.value)}
                placeholder="Ej.: Revisión de la póliza de salud familiar."
                className="w-full rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-primary-500"
              />
            </div>
          </div>
        </form>
      </Modal>
      {confirmDialog}
    </>
  )
}
