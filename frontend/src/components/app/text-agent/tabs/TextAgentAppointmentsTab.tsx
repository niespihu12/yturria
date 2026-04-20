import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  CalendarDaysIcon,
  ClockIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import {
  createTextAgentAppointment,
  deleteTextAgentAppointment,
  getTextAgentAppointments,
  updateTextAgentAppointment,
} from '@/api/TextAgentsAPI'
import type { TextAppointment, TextAppointmentStatus } from '@/types/textAgent'

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

const STATUS_BADGE: Record<TextAppointmentStatus, string> = {
  scheduled: 'bg-amber-50 text-amber-700 ring-amber-200',
  confirmed: 'bg-blue-50 text-blue-700 ring-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 ring-rose-200',
  no_show: 'bg-slate-100 text-slate-600 ring-slate-200',
}

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

function AppointmentCard({
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
  return (
    <article className="rounded-2xl border border-[#e4e0f5] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-black">
            {appointment.contact_name || appointment.contact_phone || appointment.contact_email || 'Contacto sin nombre'}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-black/60">
            <ClockIcon className="h-3.5 w-3.5" />
            {formatDateTime(appointment.appointment_date_unix_secs)} ({appointment.timezone})
          </p>
        </div>

        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${STATUS_BADGE[appointment.status]}`}
        >
          {statusLabel(appointment.status)}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-black/65 sm:grid-cols-2">
        <p>Teléfono: {appointment.contact_phone || 'Sin registro'}</p>
        <p>Email: {appointment.contact_email || 'Sin registro'}</p>
        <p>Origen: {appointment.source}</p>
        <p>Estado: {statusLabel(appointment.status)}</p>
      </div>

      {appointment.notes && (
        <p className="mt-3 rounded-lg border border-[#ece8fb] bg-[#faf9ff] px-3 py-2 text-xs text-black/70">
          {appointment.notes}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#ece8fb] pt-3">
        <select
          value={appointment.status}
          onChange={(event) => onStatusChange(event.target.value as TextAppointmentStatus)}
          disabled={isUpdating || isDeleting}
          className="rounded-lg border border-[#e4e0f5] bg-white px-2.5 py-1.5 text-xs text-black focus:border-[#271173] focus:outline-none"
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
          className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60"
        >
          <TrashIcon className="h-3.5 w-3.5" />
          Eliminar
        </button>
      </div>
    </article>
  )
}

export default function TextAgentAppointmentsTab({ agentId }: Props) {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<FilterValue>('all')
  const [form, setForm] = useState<AppointmentForm>(defaultFormState)

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
        throw new Error('Fecha y hora inválidas para la cita')
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
      toast.success('Estado de cita actualizado')
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

  const canCreate =
    form.appointment_date.trim() &&
    (form.contact_name.trim() || form.contact_phone.trim() || form.contact_email.trim())

  return (
    <div className="max-w-4xl space-y-5">
      <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f5f3ff] text-[#271173]">
            <CalendarDaysIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-black">Agenda de Citas</h2>
            <p className="text-xs text-black/55">
              Registra citas para seguimiento comercial y cambia su estado desde este panel.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50">
              Fecha y hora
            </label>
            <input
              type="datetime-local"
              value={form.appointment_date}
              onChange={(event) => setForm((prev) => ({ ...prev, appointment_date: event.target.value }))}
              className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black focus:border-[#271173] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50">
              Zona horaria
            </label>
            <input
              type="text"
              value={form.timezone}
              onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
              placeholder="America/Bogota"
              className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black focus:border-[#271173] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50">
              Nombre de contacto
            </label>
            <input
              type="text"
              value={form.contact_name}
              onChange={(event) => setForm((prev) => ({ ...prev, contact_name: event.target.value }))}
              placeholder="María Pérez"
              className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black focus:border-[#271173] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50">
              Teléfono
            </label>
            <input
              type="text"
              value={form.contact_phone}
              onChange={(event) => setForm((prev) => ({ ...prev, contact_phone: event.target.value }))}
              placeholder="+57 3000000000"
              className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black focus:border-[#271173] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50">
              Email
            </label>
            <input
              type="email"
              value={form.contact_email}
              onChange={(event) => setForm((prev) => ({ ...prev, contact_email: event.target.value }))}
              placeholder="cliente@correo.com"
              className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black focus:border-[#271173] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/50">
              Nota
            </label>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              rows={3}
              placeholder="Contexto breve para el asesor"
              className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black focus:border-[#271173] focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end border-t border-[#ece8fb] pt-4">
          <button
            type="button"
            disabled={!canCreate || isCreating}
            onClick={() => createAppointment()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
          >
            <PlusIcon className="h-4 w-4" />
            {isCreating ? 'Agendando...' : 'Agendar cita'}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-black">Citas registradas</h3>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as FilterValue)}
            className="rounded-lg border border-[#e4e0f5] bg-white px-2.5 py-1.5 text-xs text-black focus:border-[#271173] focus:outline-none"
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-[#e4e0f5] bg-white p-4 text-sm text-black/60">
            Cargando citas...
          </div>
        ) : appointments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#d4cfee] bg-[#fafafa] p-6 text-sm text-black/55">
            No hay citas registradas con el filtro actual.
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                isUpdating={isUpdatingStatus}
                isDeleting={isDeleting}
                onStatusChange={(nextStatus) =>
                  updateStatus({ appointmentId: appointment.id, status: nextStatus })
                }
                onDelete={() => deleteAppointment(appointment.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
