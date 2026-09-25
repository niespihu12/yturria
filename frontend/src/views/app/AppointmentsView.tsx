import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  CalendarDaysIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { getTextAgentAppointments, getTextAgents } from '@/api/TextAgentsAPI'
import { getAgents, getVoiceAgentAppointments } from '@/api/VoiceRuntimeAPI'
import type { TextAppointmentStatus } from '@/types/textAgent'
import {
  getCalendarConnections,
  getGoogleAuthUrl,
  disconnectCalendar,
  getGoogleCalendarEvents,
} from '@/api/CalendarsAPI'
import type { GoogleCalendarEvent } from '@/api/CalendarsAPI'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import AppointmentFormModal from '@/components/app/appointments/AppointmentFormModal'
import DayAgenda from '@/components/app/appointments/DayAgenda'
import MonthCalendar from '@/components/app/appointments/MonthCalendar'
import {
  CHANNEL_LABELS,
  CHANNEL_ORDER,
  STATUS_OPTIONS,
  appointmentChannel,
  buildMonthCells,
  formatMonthTitle,
  isSameMonth,
  normalizeAgents,
  parseDateKey,
  toDateKey,
  toMonthStart,
  type AgentOption,
  type CalendarAppointment,
  type CalendarCell,
  type ChannelKey,
} from '@/components/app/appointments/calendar'
import { pluralize } from '@/lib/format'

type ChannelFilter = 'all' | ChannelKey
type StatusFilter = 'all' | TextAppointmentStatus

type CalendarData = {
  agents: AgentOption[]
  appointments: CalendarAppointment[]
}

type ModalState = { appointment: CalendarAppointment | null; date: Date } | null

const selectClass =
  'h-9 w-full min-w-0 rounded-lg sm:w-auto border border-border-default bg-surface pl-3 pr-8 text-sm text-text-primary transition-colors focus:border-primary-500'

const navButtonClass =
  'inline-flex size-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-neutral-100 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500'

function groupByDay<T>(items: T[], getUnix: (item: T) => number): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const key = toDateKey(new Date(getUnix(item) * 1000))
    const current = grouped.get(key)
    if (current) current.push(item)
    else grouped.set(key, [item])
  }
  for (const values of grouped.values()) {
    values.sort((left, right) => getUnix(left) - getUnix(right))
  }
  return grouped
}

export default function AppointmentsView() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [confirm, confirmDialog] = useConfirm()
  const fieldId = useId()
  const agendaRef = useRef<HTMLDivElement>(null)

  // Resultado del flujo OAuth de Google Calendar (el backend redirige con estos params).
  useEffect(() => {
    const connected = searchParams.get('calendar_connected')
    const error = searchParams.get('calendar_error')
    if (!connected && !error) return
    if (connected) {
      toast.success('Google Calendar conectado')
      queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
    } else {
      toast.error('No se pudo conectar Google Calendar. Intente de nuevo.')
    }
    const next = new URLSearchParams(searchParams)
    next.delete('calendar_connected')
    next.delete('calendar_error')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, queryClient])

  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [currentMonth, setCurrentMonth] = useState<Date>(() => toMonthStart(new Date()))
  const [selectedDayKey, setSelectedDayKey] = useState<string>(() => toDateKey(new Date()))
  const [modal, setModal] = useState<ModalState>(null)

  const { data: calendarConnectionsData } = useQuery({
    queryKey: ['calendar-connections'],
    queryFn: getCalendarConnections,
  })
  const googleConnection = (calendarConnectionsData?.connections ?? []).find(
    (connection) => connection.provider === 'google' && connection.active,
  )
  const hasGoogleCalendar = Boolean(googleConnection)

  const connectCalendarMutation = useMutation({
    mutationFn: getGoogleAuthUrl,
    onSuccess: (result) => {
      if (result.auth_url) {
        window.location.href = result.auth_url
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const disconnectMutation = useMutation({
    mutationFn: disconnectCalendar,
    onSuccess: () => {
      toast.success('Google Calendar desconectado')
      queryClient.invalidateQueries({ queryKey: ['calendar-connections'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const { data, isLoading, isError, refetch } = useQuery<CalendarData>({
    queryKey: ['appointments-dashboard'],
    queryFn: async () => {
      // Sin telefonía configurada, la lista de agentes de voz puede fallar: la agenda de chat sigue disponible.
      const [textAgentsRaw, voiceAgentsRaw] = await Promise.all([
        getTextAgents(),
        getAgents().catch(() => ({ agents: [] })),
      ])

      const textAgents = normalizeAgents(textAgentsRaw, 'text')
      const voiceAgents = normalizeAgents(voiceAgentsRaw, 'voice')

      const [textAppointments, voiceAppointments] = await Promise.all([
        Promise.all(
          textAgents.map(async (agent) => {
            const result = await getTextAgentAppointments(agent.id, { limit: 200 })
            return result.appointments.map((appointment) => ({
              ...appointment,
              agentKind: 'text' as const,
              agent_id: agent.id,
              agent_name: agent.name,
            }))
          }),
        ),
        Promise.all(
          voiceAgents.map(async (agent) => {
            const result = await getVoiceAgentAppointments(agent.id, { limit: 200 })
            return result.appointments.map((appointment) => ({
              ...appointment,
              agentKind: 'voice' as const,
              agent_id: agent.id,
              agent_name: agent.name,
            }))
          }),
        ),
      ])

      const appointments = [...textAppointments.flat(), ...voiceAppointments.flat()]
      appointments.sort((left, right) => left.appointment_date_unix_secs - right.appointment_date_unix_secs)

      return { agents: [...textAgents, ...voiceAgents], appointments }
    },
  })

  const agents = useMemo(() => data?.agents ?? [], [data?.agents])
  const allAppointments = useMemo(() => data?.appointments ?? [], [data?.appointments])
  const filtersActive = channelFilter !== 'all' || statusFilter !== 'all'

  const channelOptions = useMemo(() => {
    const present = new Set<ChannelKey>(allAppointments.map(appointmentChannel))
    if (channelFilter !== 'all') present.add(channelFilter)
    return CHANNEL_ORDER.filter((key) => present.has(key))
  }, [allAppointments, channelFilter])

  const filteredAppointments = useMemo(
    () =>
      allAppointments.filter(
        (appointment) =>
          (channelFilter === 'all' || appointmentChannel(appointment) === channelFilter) &&
          (statusFilter === 'all' || appointment.status === statusFilter),
      ),
    [allAppointments, channelFilter, statusFilter],
  )

  const appointmentsByDay = useMemo(
    () => groupByDay(filteredAppointments, (appointment) => appointment.appointment_date_unix_secs),
    [filteredAppointments],
  )

  const monthCells = useMemo(() => buildMonthCells(currentMonth), [currentMonth])

  const monthRange = useMemo(() => {
    const first = monthCells[0]?.date ?? currentMonth
    const last = monthCells[monthCells.length - 1]?.date ?? currentMonth
    const fromUnix = Math.floor(new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime() / 1000)
    const toUnix = Math.floor(
      new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59).getTime() / 1000,
    )
    return { fromUnix, toUnix }
  }, [monthCells, currentMonth])

  const { data: googleEventsData } = useQuery({
    queryKey: ['google-events', monthRange.fromUnix, monthRange.toUnix],
    queryFn: () => getGoogleCalendarEvents(monthRange.fromUnix, monthRange.toUnix),
    enabled: hasGoogleCalendar,
  })

  const googleEventsByDay = useMemo(
    () => groupByDay<GoogleCalendarEvent>(googleEventsData?.events ?? [], (event) => event.start_unix),
    [googleEventsData],
  )

  const monthAppointmentCount = useMemo(
    () =>
      filteredAppointments.filter((appointment) =>
        isSameMonth(new Date(appointment.appointment_date_unix_secs * 1000), currentMonth),
      ).length,
    [filteredAppointments, currentMonth],
  )

  const selectedDayDate = useMemo(() => parseDateKey(selectedDayKey), [selectedDayKey])
  const selectedDayAppointments = appointmentsByDay.get(selectedDayKey) ?? []
  const hiddenByFilters =
    allAppointments.filter(
      (appointment) => toDateKey(new Date(appointment.appointment_date_unix_secs * 1000)) === selectedDayKey,
    ).length - selectedDayAppointments.length

  const goToMonth = (date: Date) => {
    const monthStart = toMonthStart(date)
    const today = new Date()
    setCurrentMonth(monthStart)
    setSelectedDayKey(toDateKey(isSameMonth(today, monthStart) ? today : monthStart))
  }

  // Con la agenda debajo del mes (pantallas medianas), la trae a la vista al elegir un día.
  // Se espera a que React pinte la nueva agenda: un cambio de contenido cancela el desplazamiento suave.
  const revealAgenda = () => {
    window.setTimeout(() => {
      const agenda = agendaRef.current
      if (!agenda || agenda.getBoundingClientRect().top <= window.innerHeight - 96) return
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      agenda.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })
    }, 0)
  }

  const selectDay = (cell: CalendarCell) => {
    setSelectedDayKey(cell.key)
    if (!cell.inCurrentMonth) setCurrentMonth(toMonthStart(cell.date))
    revealAgenda()
  }

  const clearFilters = () => {
    setChannelFilter('all')
    setStatusFilter('all')
  }

  const openCreate = (date: Date) => {
    if (agents.length === 0) {
      toast.info('Para agendar citas, primero cree un agente de chat o de voz.')
      return
    }
    setModal({ appointment: null, date })
  }

  const openEdit = (appointment: CalendarAppointment) => {
    const date = new Date(appointment.appointment_date_unix_secs * 1000)
    setSelectedDayKey(toDateKey(date))
    setModal({ appointment, date })
  }

  const closeModal = useCallback(() => setModal(null), [])
  const refreshAppointments = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['appointments-dashboard'] })
  }, [queryClient])

  const requestDisconnect = async () => {
    if (!googleConnection) return
    const accepted = await confirm({
      title: 'Desconectar Google Calendar',
      description:
        'Las citas nuevas dejarán de copiarse a su Google Calendar y los asistentes ya no tendrán en cuenta sus horarios ocupados.',
      confirmLabel: 'Desconectar',
    })
    if (accepted) disconnectMutation.mutate(googleConnection.id)
  }

  const linkButtonClass =
    'font-medium text-text-link underline-offset-2 hover:text-text-link-hover hover:underline disabled:opacity-60'

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
        <PageHeader
          title="Citas"
          description="Las citas que agendan sus asistentes y su equipo. Abra una cita para cambiar su estado o sus datos."
          actions={
            <Button
              onClick={() => openCreate(selectedDayDate)}
              leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}
            >
              Nueva cita
            </Button>
          }
        />

        <p className="-mt-2 mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
          {hasGoogleCalendar ? (
            <>
              <CheckCircleIcon className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
              <span>Conectado con Google Calendar: las citas se copian a su calendario.</span>
              <button
                type="button"
                onClick={requestDisconnect}
                disabled={disconnectMutation.isPending}
                className={linkButtonClass}
              >
                Desconectar
              </button>
            </>
          ) : (
            <>
              <CalendarDaysIcon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
              <span>Google Calendar no está conectado.</span>
              <button
                type="button"
                onClick={() => connectCalendarMutation.mutate('/citas')}
                disabled={connectCalendarMutation.isPending}
                className={linkButtonClass}
              >
                {connectCalendarMutation.isPending ? 'Abriendo Google…' : 'Conectar'}
              </button>
            </>
          )}
        </p>

        {!isLoading && !isError && agents.length === 0 && (
          <p className="mb-6 rounded-xl border border-border-default bg-surface-muted px-4 py-3 text-sm text-text-secondary">
            Aún no hay agentes. Cree un agente de chat o de voz para empezar a registrar citas.
          </p>
        )}

        {isLoading ? (
          <p className="rounded-xl border border-border-default bg-surface px-6 py-12 text-center text-sm text-text-tertiary">
            Cargando la agenda…
          </p>
        ) : isError ? (
          <div className="rounded-xl border border-border-default bg-surface px-6 py-10 text-center">
            <p className="text-sm font-medium text-text-primary">No pudimos cargar la agenda.</p>
            <p className="mt-1 text-sm text-text-tertiary">Revise su conexión e intente de nuevo.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_20rem] @5xl:items-start">
            <section aria-labelledby={`${fieldId}-month`} className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="flex min-w-0 items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => goToMonth(new Date())} className="mr-1">
                    Hoy
                  </Button>
                  <button
                    type="button"
                    onClick={() => goToMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                    className={navButtonClass}
                    aria-label="Mes anterior"
                  >
                    <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                    className={navButtonClass}
                    aria-label="Mes siguiente"
                  >
                    <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <h2
                    id={`${fieldId}-month`}
                    className="ml-1 text-lg font-semibold text-text-primary"
                    aria-live="polite"
                  >
                    {formatMonthTitle(currentMonth)}
                  </h2>
                  <span className="ml-2 hidden text-sm tabular-nums text-text-tertiary @md:inline">
                    {pluralize(monthAppointmentCount, 'cita', 'citas')}
                  </span>
                </div>

                <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
                  <label htmlFor={`${fieldId}-channel`} className="sr-only">
                    Canal
                  </label>
                  <select
                    id={`${fieldId}-channel`}
                    value={channelFilter}
                    onChange={(event) => setChannelFilter(event.target.value as ChannelFilter)}
                    className={selectClass}
                  >
                    <option value="all">Canal: todos</option>
                    {channelOptions.map((key) => (
                      <option key={key} value={key}>
                        {CHANNEL_LABELS[key]}
                      </option>
                    ))}
                  </select>

                  <label htmlFor={`${fieldId}-status`} className="sr-only">
                    Estado
                  </label>
                  <select
                    id={`${fieldId}-status`}
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className={selectClass}
                  >
                    <option value="all">Estado: todos</option>
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  {filtersActive && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="col-span-2 justify-self-start">
                      Quitar filtros
                    </Button>
                  )}
                </div>
              </div>

              <MonthCalendar
                cells={monthCells}
                appointmentsByDay={appointmentsByDay}
                googleEventsByDay={googleEventsByDay}
                selectedDayKey={selectedDayKey}
                onSelectDay={selectDay}
                onOpenAppointment={openEdit}
              />
            </section>

            <div ref={agendaRef} className="scroll-mt-6 @5xl:sticky @5xl:top-6">
              <DayAgenda
                date={selectedDayDate}
                isToday={selectedDayKey === toDateKey(new Date())}
                appointments={selectedDayAppointments}
                googleEvents={googleEventsByDay.get(selectedDayKey) ?? []}
                hiddenByFilters={hiddenByFilters}
                onClearFilters={clearFilters}
                onOpenAppointment={openEdit}
                onCreate={() => openCreate(selectedDayDate)}
              />
            </div>
          </div>
        )}
      </div>

      {modal && (
        <AppointmentFormModal
          key={modal.appointment ? `${modal.appointment.agentKind}-${modal.appointment.id}` : `new-${modal.date.getTime()}`}
          appointment={modal.appointment}
          initialDate={modal.date}
          agents={agents}
          onClose={closeModal}
          onChanged={refreshAppointments}
        />
      )}

      {confirmDialog}
    </div>
  )
}
