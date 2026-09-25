import { useId } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import type { GoogleCalendarEvent } from '@/api/CalendarsAPI'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { formatPhone, pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  CHANNEL_LABELS,
  STATUS_BADGE,
  appointmentChannel,
  contactLabel,
  formatDayTitle,
  formatTime,
  isInactiveStatus,
  statusLabel,
  type CalendarAppointment,
} from './calendar'

type Props = {
  date: Date
  isToday: boolean
  appointments: CalendarAppointment[]
  googleEvents: GoogleCalendarEvent[]
  hiddenByFilters: number
  onClearFilters: () => void
  onOpenAppointment: (appointment: CalendarAppointment) => void
  onCreate: () => void
}

/** Agenda del día seleccionado: lista con divisores, una fila por cita. */
export default function DayAgenda({
  date,
  isToday,
  appointments,
  googleEvents,
  hiddenByFilters,
  onClearFilters,
  onOpenAppointment,
  onCreate,
}: Props) {
  const headingId = useId()
  const dayTitle = formatDayTitle(date)

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border-default bg-surface">
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-text-primary" aria-live="polite">
            {isToday ? `Hoy, ${dayTitle.charAt(0).toLocaleLowerCase('es-CO')}${dayTitle.slice(1)}` : dayTitle}
          </h2>
          <p className="mt-0.5 text-sm tabular-nums text-text-tertiary">
            {appointments.length > 0 ? pluralize(appointments.length, 'cita', 'citas') : 'Sin citas'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCreate}
          leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
          aria-label={`Agendar una cita el ${dayTitle.toLocaleLowerCase('es-CO')}`}
          className="-mr-2 shrink-0"
        >
          Agendar
        </Button>
      </header>

      {appointments.length === 0 ? (
        <div className="px-5 py-6 text-sm text-text-secondary">
          <p>No hay citas para este día.</p>
          {hiddenByFilters > 0 && (
            <p className="mt-1 text-text-tertiary">
              {hiddenByFilters === 1 ? 'Hay 1 cita oculta' : `Hay ${hiddenByFilters} citas ocultas`} por los filtros.{' '}
              <button
                type="button"
                onClick={onClearFilters}
                className="font-medium text-text-link underline-offset-2 hover:text-text-link-hover hover:underline"
              >
                Quitar filtros
              </button>
            </p>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {appointments.map((appointment) => {
            const inactive = isInactiveStatus(appointment.status)
            const name = contactLabel(appointment)
            const phone = appointment.contact_phone?.trim()

            return (
              <li key={`${appointment.agentKind}-${appointment.id}`}>
                <button
                  type="button"
                  onClick={() => onOpenAppointment(appointment)}
                  className="flex w-full gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
                >
                  <span
                    className={cn(
                      'w-11 shrink-0 text-sm font-semibold tabular-nums',
                      inactive ? 'text-text-muted' : 'text-text-primary',
                    )}
                  >
                    {formatTime(appointment.appointment_date_unix_secs)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          'font-medium',
                          inactive ? 'text-text-tertiary' : 'text-text-primary',
                          appointment.status === 'cancelled' && 'line-through',
                        )}
                      >
                        {name}
                      </span>
                      <Badge variant={STATUS_BADGE[appointment.status]} size="sm">
                        {statusLabel(appointment.status)}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-sm text-text-secondary">
                      {CHANNEL_LABELS[appointmentChannel(appointment)]} · {appointment.agent_name}
                    </span>
                    {phone && name !== phone && (
                      <span className="block text-sm tabular-nums text-text-tertiary">{formatPhone(phone)}</span>
                    )}
                    {appointment.notes && (
                      <span className="mt-1 line-clamp-2 block text-sm text-text-tertiary">{appointment.notes}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {googleEvents.length > 0 && (
        <div className="border-t border-border-subtle px-5 py-4">
          <h3 className="text-sm font-semibold text-text-primary">Ocupado en Google Calendar</h3>
          <ul className="mt-2 space-y-1.5">
            {googleEvents.map((event) => (
              <li key={`g-day-${event.id}`} className="flex gap-4 text-sm text-text-secondary">
                <span className="w-11 shrink-0 tabular-nums text-text-tertiary">
                  {event.all_day ? '' : formatTime(event.start_unix)}
                </span>
                <span className="min-w-0 truncate">
                  {event.all_day ? `Todo el día · ${event.summary || 'Ocupado'}` : event.summary || 'Ocupado'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-tertiary">Sus asistentes no agendan citas en estos horarios.</p>
        </div>
      )}
    </section>
  )
}
