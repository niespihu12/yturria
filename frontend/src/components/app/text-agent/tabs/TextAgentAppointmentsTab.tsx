import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { TrashIcon } from '@heroicons/react/24/outline'
import {
  createTextAgentAppointment,
  deleteTextAgentAppointment,
  getTextAgentAppointments,
  updateTextAgentAppointment,
} from '@/api/TextAgentsAPI'
import type { TextAppointment, TextAppointmentStatus } from '@/types/textAgent'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'

type Props = {
  agentId: string
}

type FilterValue = 'all' | TextAppointmentStatus

type AppointmentForm = {
  appointment_date: string
  contact_name: string
  contact_phone: string
  contact_email: string
  notes: string
  timezone: string
}

const STATUS_OPTIONS: Array<{ value: TextAppointmentStatus; label: string }> = [
  { value: 'scheduled', label: 'Programada' },
  { value: 'confirmed', label: 'Confirmada' },
  { value: 'completed', label: 'Completada' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'no_show', label: 'No asistió' },
]

const FILTER_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: 'all', label: 'Todas' },
  ...STATUS_OPTIONS,
]

const STATUS_BADGE: Record<TextAppointmentStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  scheduled: 'info',
  confirmed: 'primary',
  completed: 'success',
  cancelled: 'default',
  no_show: 'warning',
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Registrada en la consola',
  agent: 'Agendada por el agente',
  embed: 'Agendada desde el sitio web',
  web: 'Agendada desde el chat web',
  whatsapp: 'Agendada por WhatsApp',
  phone: 'Agendada por teléfono',
  voice: 'Agendada por el agente de voz',
}

const inputClass =
  'h-10 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-600'
const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'

function formatDateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toInputDateValue(date: Date): string {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return adjusted.toISOString().slice(0, 16)
}

function defaultFormState(): AppointmentForm {
  const initialDate = new Date(Date.now() + 60 * 60 * 1000)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota'

  return {
    appointment_date: toInputDateValue(initialDate),
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    notes: '',
    timezone,
  }
}

function statusLabel(status: TextAppointmentStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function contactName(appointment: TextAppointment) {
  return appointment.contact_name || appointment.contact_phone || appointment.contact_email || 'Contacto sin nombre'
}

function AppointmentRow({
  appointment,
  onStatusChange,
  onDelete,
  isUpdating,
  isDeleting,
}: {
  appointment: TextAppointment
  onStatusChange: (status: TextAppointmentStatus) => void
  onDelete: () => void
  isUpdating: boolean
  isDeleting: boolean
}) {
  const name = contactName(appointment)
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-text-primary">{name}</p>
          <Badge variant={STATUS_BADGE[appointment.status]} size="sm">
            {statusLabel(appointment.status)}
          </Badge>
        </div>
        <p className="mt-1 text-sm tabular-nums text-text-secondary">
          {formatDateTime(appointment.appointment_date_unix_secs)}
          <span className="text-text-tertiary"> · {appointment.timezone}</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-tertiary">
          {appointment.contact_phone && <span>{appointment.contact_phone}</span>}
          {appointment.contact_email && <span>{appointment.contact_email}</span>}
          <span>{SOURCE_LABELS[appointment.source] ?? appointment.source}</span>
        </p>
        {appointment.notes && (
          <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-text-secondary">{appointment.notes}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <select
          value={appointment.status}
          onChange={(event) => onStatusChange(event.target.value as TextAppointmentStatus)}
          disabled={isUpdating || isDeleting}
          aria-label={`Estado de la cita de ${name}`}
          className="h-9 rounded-lg border border-border-default bg-surface px-2.5 text-sm text-text-primary focus:border-primary-600"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={isUpdating || isDeleting}
          onClick={onDelete}
          aria-label={`Eliminar la cita de ${name}`}
          title="Eliminar"
          className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700 disabled:opacity-60"
        >
          <TrashIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}

export default function TextAgentAppointmentsTab({ agentId }: Props) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<FilterValue>('all')
  const [form, setForm] = useState<AppointmentForm>(defaultFormState)
  const [confirm, confirmDialog] = useConfirm()
  const baseId = useId()
  const fieldId = (name: string) => `${baseId}-${name}`

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['text-agent-appointments', agentId] })
  }

  const { data, isLoading } = useQuery({
    queryKey: ['text-agent-appointments', agentId, statusFilter],
    queryFn: () =>
      getTextAgentAppointments(agentId, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 200,
      }),
  })

  const appointments = data?.appointments ?? []

  const { mutate: createAppointment, isPending: isCreating } = useMutation({
    mutationFn: async () => {
      const parsedDate = new Date(form.appointment_date)
      if (Number.isNaN(parsedDate.getTime())) {
        throw new Error('Revise la fecha y la hora de la cita')
      }

      return createTextAgentAppointment(agentId, {
        appointment_date: parsedDate.toISOString(),
        contact_name: form.contact_name,
        contact_phone: form.contact_phone,
        contact_email: form.contact_email,
        notes: form.notes,
        timezone: form.timezone,
        source: 'manual',
      })
    },
    onSuccess: () => {
      toast.success('Cita agendada')
      setForm(defaultFormState())
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: updateStatus, isPending: isUpdatingStatus } = useMutation({
    mutationFn: ({ appointmentId, status }: { appointmentId: string; status: TextAppointmentStatus }) =>
      updateTextAgentAppointment(agentId, appointmentId, { status }),
    onSuccess: () => {
      toast.success('Estado de la cita actualizado')
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: deleteAppointment, isPending: isDeleting } = useMutation({
    mutationFn: (appointmentId: string) => deleteTextAgentAppointment(agentId, appointmentId),
    onSuccess: () => {
      toast.success('Cita eliminada')
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const handleDelete = async (appointment: TextAppointment) => {
    const accepted = await confirm({
      title: `¿Eliminar la cita de ${contactName(appointment)}?`,
      description: `Se borrará la cita del ${formatDateTime(appointment.appointment_date_unix_secs)} y sus notas. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar cita',
      tone: 'danger',
    })
    if (accepted) deleteAppointment(appointment.id)
  }

  const canCreate =
    form.appointment_date.trim() &&
    (form.contact_name.trim() || form.contact_phone.trim() || form.contact_email.trim())

  const update = (partial: Partial<AppointmentForm>) => setForm((prev) => ({ ...prev, ...partial }))

  return (
    <div className="max-w-3xl space-y-10">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Agendar una cita</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Registre citas de seguimiento. Indique al menos el nombre, el teléfono o el correo del
            cliente.
          </p>
        </div>

        <div className="grid gap-4 @lg:grid-cols-2">
          <div>
            <label htmlFor={fieldId('date')} className={labelClass}>
              Fecha y hora
            </label>
            <input
              id={fieldId('date')}
              type="datetime-local"
              value={form.appointment_date}
              onChange={(event) => update({ appointment_date: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={fieldId('tz')} className={labelClass}>
              Zona horaria
            </label>
            <input
              id={fieldId('tz')}
              type="text"
              value={form.timezone}
              onChange={(event) => update({ timezone: event.target.value })}
              placeholder="America/Bogota"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={fieldId('name')} className={labelClass}>
              Nombre del cliente
            </label>
            <input
              id={fieldId('name')}
              type="text"
              autoComplete="off"
              value={form.contact_name}
              onChange={(event) => update({ contact_name: event.target.value })}
              placeholder="Ej: María Pérez"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={fieldId('phone')} className={labelClass}>
              Teléfono
            </label>
            <input
              id={fieldId('phone')}
              type="tel"
              autoComplete="off"
              value={form.contact_phone}
              onChange={(event) => update({ contact_phone: event.target.value })}
              placeholder="Ej: +57 300 123 4567"
              className={inputClass}
            />
          </div>
          <div className="@lg:col-span-2">
            <label htmlFor={fieldId('email')} className={labelClass}>
              Correo electrónico
            </label>
            <input
              id={fieldId('email')}
              type="email"
              autoComplete="off"
              value={form.contact_email}
              onChange={(event) => update({ contact_email: event.target.value })}
              placeholder="cliente@correo.com"
              className={inputClass}
            />
          </div>
          <div className="@lg:col-span-2">
            <label htmlFor={fieldId('notes')} className={labelClass}>
              Nota para el asesor
            </label>
            <textarea
              id={fieldId('notes')}
              value={form.notes}
              onChange={(event) => update({ notes: event.target.value })}
              rows={3}
              placeholder="Contexto breve: qué necesita el cliente"
              className="w-full resize-y rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-600"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" isLoading={isCreating} disabled={!canCreate} onClick={() => createAppointment()}>
            {isCreating ? 'Agendando…' : 'Agendar cita'}
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-text-primary">Citas registradas</h3>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            Mostrar
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as FilterValue)}
              className="h-9 rounded-lg border border-border-default bg-surface px-2.5 text-sm text-text-primary focus:border-primary-600"
            >
              {FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-16" />
            <div className="skeleton h-16" />
          </div>
        ) : appointments.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-6 py-8 text-center text-sm text-text-tertiary">
            {statusFilter === 'all'
              ? 'Aún no hay citas. Las que agende el agente o usted aparecerán aquí.'
              : 'No hay citas con este estado.'}
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
            {appointments.map((appointment) => (
              <AppointmentRow
                key={appointment.id}
                appointment={appointment}
                isUpdating={isUpdatingStatus}
                isDeleting={isDeleting}
                onStatusChange={(nextStatus) =>
                  updateStatus({ appointmentId: appointment.id, status: nextStatus })
                }
                onDelete={() => void handleDelete(appointment)}
              />
            ))}
          </ul>
        )}
      </section>

      {confirmDialog}
    </div>
  )
}
