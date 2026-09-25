import type { GoogleCalendarEvent } from '@/api/CalendarsAPI'
import { cn } from '@/lib/utils'
import { pluralize } from '@/lib/format'
import {
  WEEKDAYS,
  contactLabel,
  formatDayTitle,
  formatTime,
  isInactiveStatus,
  statusLabel,
  type CalendarAppointment,
  type CalendarCell,
} from './calendar'

type Props = {
  cells: CalendarCell[]
  appointmentsByDay: Map<string, CalendarAppointment[]>
  googleEventsByDay: Map<string, GoogleCalendarEvent[]>
  selectedDayKey: string
  onSelectDay: (cell: CalendarCell) => void
  onOpenAppointment: (appointment: CalendarAppointment) => void
}

const MAX_ENTRIES_PER_DAY = 3

const STATUS_DOT: Record<CalendarAppointment['status'], string> = {
  scheduled: 'bg-info-500',
  confirmed: 'bg-primary-600',
  completed: 'bg-neutral-400',
  cancelled: 'bg-neutral-300',
  no_show: 'bg-warning-500',
}

/**
 * Mes en cuadrícula con divisores finos. En contenedores angostos (celular)
 * cada día muestra solo puntos y la agenda del día seleccionado va debajo.
 */
export default function MonthCalendar({
  cells,
  appointmentsByDay,
  googleEventsByDay,
  selectedDayKey,
  onSelectDay,
  onOpenAppointment,
}: Props) {
  return (
    <div className="@container overflow-hidden rounded-xl border border-border-default bg-surface">
      <div aria-hidden="true" className="grid grid-cols-7 border-b border-border-default bg-surface-muted">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday.short}
            className="px-1 py-2 text-center text-xs font-medium text-text-tertiary @2xl:px-2.5 @2xl:text-left"
          >
            <span className="@2xl:hidden">{weekday.initial}</span>
            <span className="hidden @2xl:inline">{weekday.short}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-border-subtle">
        {cells.map((cell) => {
          const dayAppointments = appointmentsByDay.get(cell.key) ?? []
          const dayEvents = googleEventsByDay.get(cell.key) ?? []
          const isSelected = cell.key === selectedDayKey
          const visibleAppointments = dayAppointments.slice(0, MAX_ENTRIES_PER_DAY)
          const visibleEvents = dayEvents.slice(0, MAX_ENTRIES_PER_DAY - visibleAppointments.length)
          const hiddenCount =
            dayAppointments.length + dayEvents.length - visibleAppointments.length - visibleEvents.length

          const dayLabel = [
            formatDayTitle(cell.date),
            cell.isToday ? 'hoy' : '',
            dayAppointments.length > 0 ? pluralize(dayAppointments.length, 'cita', 'citas') : 'sin citas',
          ]
            .filter(Boolean)
            .join(', ')

          return (
            <div
              key={cell.key}
              className={cn(
                'relative flex min-h-12 flex-col p-1 @2xl:min-h-24 @2xl:p-1.5',
                cell.inCurrentMonth ? 'bg-surface' : 'bg-surface-muted',
                isSelected && 'bg-primary-50',
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDay(cell)}
                aria-label={dayLabel}
                aria-pressed={isSelected}
                aria-current={cell.isToday ? 'date' : undefined}
                className="absolute inset-0 transition-colors hover:bg-neutral-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-600"
              />

              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none relative mx-auto flex size-7 items-center justify-center rounded-full text-sm tabular-nums @2xl:mx-0',
                  cell.inCurrentMonth ? 'text-text-secondary' : 'text-text-muted',
                  cell.isToday && 'font-semibold text-primary-800 ring-1 ring-inset ring-primary-600',
                  isSelected && 'bg-primary-700 font-semibold text-text-inverse ring-0',
                )}
              >
                {cell.date.getDate()}
              </span>

              {dayAppointments.length > 0 && (
                <span aria-hidden="true" className="pointer-events-none relative mx-auto mt-1 flex gap-0.5 @2xl:hidden">
                  {dayAppointments.slice(0, 3).map((appointment) => (
                    <span
                      key={`${appointment.agentKind}-${appointment.id}`}
                      className={cn('size-1.5 rounded-full', STATUS_DOT[appointment.status])}
                    />
                  ))}
                </span>
              )}

              {(visibleAppointments.length > 0 || visibleEvents.length > 0) && (
                <ul className="pointer-events-none relative mt-1 hidden flex-col gap-1 @2xl:flex">
                  {visibleAppointments.map((appointment) => {
                    const time = formatTime(appointment.appointment_date_unix_secs)
                    const name = contactLabel(appointment)
                    const inactive = isInactiveStatus(appointment.status)
                    const description = `${time}, ${name}, ${statusLabel(appointment.status)}`

                    return (
                      <li key={`${appointment.agentKind}-${appointment.id}`}>
                        <button
                          type="button"
                          onClick={() => onOpenAppointment(appointment)}
                          title={`${time} · ${name} · ${statusLabel(appointment.status)}`}
                          aria-label={`Abrir cita: ${description}`}
                          className="pointer-events-auto block w-full rounded-md px-1 py-0.5 text-left text-xs leading-tight transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                        >
                          <span className="flex items-center gap-1 tabular-nums text-text-tertiary">
                            <span
                              aria-hidden="true"
                              className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[appointment.status])}
                            />
                            {time}
                          </span>
                          <span
                            className={cn(
                              'block truncate font-medium',
                              inactive ? 'text-text-muted' : 'text-text-primary',
                              appointment.status === 'cancelled' && 'line-through',
                            )}
                          >
                            {name}
                          </span>
                        </button>
                      </li>
                    )
                  })}

                  {visibleEvents.map((event) => (
                    <li
                      key={`g-${event.id}`}
                      title={`Ocupado en Google Calendar · ${event.summary}`}
                      className="flex items-start gap-1.5 px-1 py-0.5 text-xs leading-snug text-text-tertiary"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-[0.3rem] size-1.5 shrink-0 rounded-full ring-1 ring-inset ring-neutral-400"
                      />
                      {!event.all_day && <span className="shrink-0 tabular-nums">{formatTime(event.start_unix)}</span>}
                      <span className="min-w-0 truncate">{event.summary || 'Ocupado'}</span>
                    </li>
                  ))}

                  {hiddenCount > 0 && (
                    <li className="px-1 text-xs font-medium tabular-nums text-text-tertiary">+{hiddenCount} más</li>
                  )}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
