import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import {
  createTextAgentAppointment,
  deleteTextAgentAppointment,
  getTextAgentAppointments,
  getTextAgents,
  updateTextAgentAppointment,
} from '@/api/TextAgentsAPI'
import {
  createVoiceAgentAppointment,
  deleteVoiceAgentAppointment,
  getAgents,
  getVoiceAgentAppointments,
  updateVoiceAgentAppointment,
} from '@/api/VoiceRuntimeAPI'
import type { TextAppointment, TextAppointmentStatus } from '@/types/textAgent'

type Channel = 'text' | 'voice'
type ChannelFilter = 'all' | Channel
type StatusFilter = 'all' | TextAppointmentStatus
type ModalMode = 'create' | 'edit'

type AgentOption = {
  id: string
  name: string
  channel: Channel
}

type CalendarAppointment = TextAppointment & {
  channel: Channel
  agent_id: string
  agent_name: string
}

type CalendarData = {
  textAgents: AgentOption[]
  voiceAgents: AgentOption[]
  appointments: CalendarAppointment[]
}

type ModalFormState = {
  channel: Channel
  agentId: string
  appointmentDate: string
  timezone: string
  contactName: string
  contactPhone: string
  contactEmail: string
  status: TextAppointmentStatus
  notes: string
}

type CalendarCell = {
  key: string
  date: Date
  inCurrentMonth: boolean
  isToday: boolean
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']

const STATUS_OPTIONS: Array<{ value: TextAppointmentStatus; label: string }> = [
  { value: 'scheduled', label: 'Programada' },
  { value: 'confirmed', label: 'Confirmada' },
  { value: 'completed', label: 'Completada' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'no_show', label: 'No asistio' },
]

const STATUS_BADGE: Record<TextAppointmentStatus, string> = {
  scheduled: 'bg-amber-50 text-amber-700 ring-amber-200',
  confirmed: 'bg-blue-50 text-blue-700 ring-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 ring-rose-200',
  no_show: 'bg-slate-100 text-slate-600 ring-slate-200',
}

function toInputDateValue(date: Date): string {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return adjusted.toISOString().slice(0, 16)
}

function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(key: string): Date {
  const [yearRaw, monthRaw, dayRaw] = key.split('-')
  const year = Number.parseInt(yearRaw || '', 10)
  const month = Number.parseInt(monthRaw || '', 10)
  const day = Number.parseInt(dayRaw || '', 10)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date()
  }

  return new Date(year, month - 1, day)
}

function toMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function buildMonthCells(monthStart: Date): CalendarCell[] {
  const firstDayIndex = monthStart.getDay()
  const leadingDays = firstDayIndex === 0 ? 6 : firstDayIndex - 1
  const firstCellDate = new Date(monthStart)
  firstCellDate.setDate(monthStart.getDate() - leadingDays)

  const todayKey = toDateKey(new Date())
  const cells: CalendarCell[] = []

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(firstCellDate)
    date.setDate(firstCellDate.getDate() + index)

    const key = toDateKey(date)
    cells.push({
      key,
      date,
      inCurrentMonth: date.getMonth() === monthStart.getMonth(),
      isToday: key === todayKey,
    })
  }

  return cells
}

function statusLabel(status: TextAppointmentStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function channelLabel(channel: Channel): string {
  return channel === 'voice' ? 'Voz' : 'Texto'
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

function normalizeVoiceAgents(raw: unknown): AgentOption[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { agents?: unknown[] }).agents)) {
    return []
  }

  const normalized: AgentOption[] = []
  for (const agent of (raw as { agents: Array<Record<string, unknown>> }).agents) {
    const id = String(agent.agent_id ?? '').trim()
    if (!id) continue
    const name = String(agent.name ?? id).trim() || id
    normalized.push({ id, name, channel: 'voice' })
  }

  return normalized
}

function normalizeTextAgents(raw: unknown): AgentOption[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { agents?: unknown[] }).agents)) {
    return []
  }

  const normalized: AgentOption[] = []
  for (const agent of (raw as { agents: Array<Record<string, unknown>> }).agents) {
    const id = String(agent.agent_id ?? '').trim()
    if (!id) continue
    const name = String(agent.name ?? id).trim() || id
    normalized.push({ id, name, channel: 'text' })
  }

  return normalized
}

function buildDefaultModalForm(
  allAgents: AgentOption[],
  preferredDate: Date,
  preferredChannel?: Channel
): ModalFormState {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota'

  const withTime = new Date(preferredDate)
  withTime.setHours(10, 0, 0, 0)

  const availableChannel: Channel =
    preferredChannel && allAgents.some((agent) => agent.channel === preferredChannel)
      ? preferredChannel
      : allAgents.some((agent) => agent.channel === 'text')
      ? 'text'
      : 'voice'

  const firstAgent = allAgents.find((agent) => agent.channel === availableChannel)

  return {
    channel: availableChannel,
    agentId: firstAgent?.id ?? '',
    appointmentDate: toInputDateValue(withTime),
    timezone,
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    status: 'scheduled',
    notes: '',
  }
}

function isFormContactValid(form: ModalFormState): boolean {
  return Boolean(form.contactName.trim() || form.contactPhone.trim() || form.contactEmail.trim())
}

function channelChipClass(channel: Channel): string {
  return channel === 'voice'
    ? 'bg-sky-50 text-sky-700 ring-sky-200'
    : 'bg-violet-50 text-violet-700 ring-violet-200'
}

export default function AppointmentsView() {
  const queryClient = useQueryClient()

  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [currentMonth, setCurrentMonth] = useState<Date>(() => toMonthStart(new Date()))
  const [selectedDayKey, setSelectedDayKey] = useState<string>(() => toDateKey(new Date()))

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<ModalMode>('create')
  const [editingAppointment, setEditingAppointment] = useState<CalendarAppointment | null>(null)
  const [modalForm, setModalForm] = useState<ModalFormState>(() =>
    buildDefaultModalForm([], new Date(), 'text')
  )

  const { data, isLoading, isError, error } = useQuery<CalendarData>({
    queryKey: ['appointments-dashboard'],
    queryFn: async () => {
      const [textAgentsRaw, voiceAgentsRaw] = await Promise.all([getTextAgents(), getAgents()])

      const textAgents = normalizeTextAgents(textAgentsRaw)
      const voiceAgents = normalizeVoiceAgents(voiceAgentsRaw)

      const textAppointmentResults = await Promise.all(
        textAgents.map(async (agent) => {
          const result = await getTextAgentAppointments(agent.id, { limit: 200 })
          return result.appointments.map((appointment) => ({
            ...appointment,
            channel: 'text' as const,
            agent_id: agent.id,
            agent_name: agent.name,
          }))
        })
      )

      const voiceAppointmentResults = await Promise.all(
        voiceAgents.map(async (agent) => {
          const result = await getVoiceAgentAppointments(agent.id, { limit: 200 })
          return result.appointments.map((appointment) => ({
            ...appointment,
            channel: 'voice' as const,
            agent_id: agent.id,
            agent_name: agent.name,
          }))
        })
      )

      const appointments = [...textAppointmentResults.flat(), ...voiceAppointmentResults.flat()]
      appointments.sort((left, right) => left.appointment_date_unix_secs - right.appointment_date_unix_secs)

      return {
        textAgents,
        voiceAgents,
        appointments,
      }
    },
  })

  const allAgents = useMemo(
    () => [...(data?.textAgents ?? []), ...(data?.voiceAgents ?? [])],
    [data?.textAgents, data?.voiceAgents]
  )

  const filteredAppointments = useMemo(() => {
    const source = data?.appointments ?? []
    return source.filter((appointment) => {
      const channelMatch = channelFilter === 'all' || appointment.channel === channelFilter
      const statusMatch = statusFilter === 'all' || appointment.status === statusFilter
      return channelMatch && statusMatch
    })
  }, [channelFilter, data?.appointments, statusFilter])

  const appointmentsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarAppointment[]>()

    for (const appointment of filteredAppointments) {
      const key = toDateKey(new Date(appointment.appointment_date_unix_secs * 1000))
      const current = grouped.get(key)
      if (current) {
        current.push(appointment)
      } else {
        grouped.set(key, [appointment])
      }
    }

    for (const values of grouped.values()) {
      values.sort((left, right) => left.appointment_date_unix_secs - right.appointment_date_unix_secs)
    }

    return grouped
  }, [filteredAppointments])

  const monthCells = useMemo(() => buildMonthCells(currentMonth), [currentMonth])

  const selectedDayDate = useMemo(() => parseDateKey(selectedDayKey), [selectedDayKey])

  const selectedDayAppointments = useMemo(
    () => appointmentsByDay.get(selectedDayKey) ?? [],
    [appointmentsByDay, selectedDayKey]
  )

  const monthTitle = useMemo(
    () =>
      currentMonth.toLocaleDateString('es-CO', {
        month: 'long',
        year: 'numeric',
      }),
    [currentMonth]
  )

  const selectedDayTitle = useMemo(
    () =>
      selectedDayDate.toLocaleDateString('es-CO', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    [selectedDayDate]
  )

  const createModeAgents = useMemo(
    () => allAgents.filter((agent) => agent.channel === modalForm.channel),
    [allAgents, modalForm.channel]
  )

  useEffect(() => {
    const inCurrentMonth =
      selectedDayDate.getFullYear() === currentMonth.getFullYear() &&
      selectedDayDate.getMonth() === currentMonth.getMonth()

    if (inCurrentMonth) {
      return
    }

    const today = new Date()
    const todayInMonth =
      today.getFullYear() === currentMonth.getFullYear() && today.getMonth() === currentMonth.getMonth()

    if (todayInMonth) {
      setSelectedDayKey(toDateKey(today))
      return
    }

    setSelectedDayKey(toDateKey(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)))
  }, [currentMonth, selectedDayDate])

  useEffect(() => {
    if (!isModalOpen || modalMode !== 'create') {
      return
    }

    if (createModeAgents.length === 0) {
      if (modalForm.agentId) {
        setModalForm((prev) => ({ ...prev, agentId: '' }))
      }
      return
    }

    const exists = createModeAgents.some((agent) => agent.id === modalForm.agentId)
    if (!exists) {
      setModalForm((prev) => ({ ...prev, agentId: createModeAgents[0].id }))
    }
  }, [createModeAgents, isModalOpen, modalForm.agentId, modalMode])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['appointments-dashboard'] })
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingAppointment(null)
  }

  const openCreateModal = (forDate?: Date) => {
    if (allAgents.length === 0) {
      toast.info('Crea al menos un agente para poder registrar citas')
      return
    }

    const targetDate = forDate ?? selectedDayDate
    setModalMode('create')
    setEditingAppointment(null)
    setModalForm(buildDefaultModalForm(allAgents, targetDate, channelFilter === 'all' ? undefined : channelFilter))
    setIsModalOpen(true)
  }

  const openEditModal = (appointment: CalendarAppointment) => {
    setModalMode('edit')
    setEditingAppointment(appointment)
    setModalForm({
      channel: appointment.channel,
      agentId: appointment.agent_id,
      appointmentDate: toInputDateValue(new Date(appointment.appointment_date_unix_secs * 1000)),
      timezone: appointment.timezone || 'America/Bogota',
      contactName: appointment.contact_name || '',
      contactPhone: appointment.contact_phone || '',
      contactEmail: appointment.contact_email || '',
      status: appointment.status,
      notes: appointment.notes || '',
    })
    setIsModalOpen(true)
  }

  const { mutate: createAppointment, isPending: isCreating } = useMutation({
    mutationFn: async () => {
      if (!modalForm.agentId) {
        throw new Error('Seleccione un agente para crear la cita')
      }

      if (!isFormContactValid(modalForm)) {
        throw new Error('Debes incluir al menos nombre, telefono o email del contacto')
      }

      const appointmentDate = new Date(modalForm.appointmentDate)
      if (Number.isNaN(appointmentDate.getTime())) {
        throw new Error('Fecha y hora invalida para la cita')
      }

      const payload = {
        appointment_date: appointmentDate.toISOString(),
        contact_name: modalForm.contactName.trim(),
        contact_phone: modalForm.contactPhone.trim(),
        contact_email: modalForm.contactEmail.trim(),
        timezone: modalForm.timezone.trim() || 'America/Bogota',
        status: modalForm.status,
        notes: modalForm.notes.trim(),
        source: modalForm.channel === 'voice' ? ('voice' as const) : ('manual' as const),
      }

      if (modalForm.channel === 'voice') {
        return createVoiceAgentAppointment(modalForm.agentId, payload)
      }

      return createTextAgentAppointment(modalForm.agentId, payload)
    },
    onSuccess: () => {
      toast.success('Cita creada correctamente')
      closeModal()
      refresh()
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const { mutate: updateAppointment, isPending: isUpdating } = useMutation({
    mutationFn: async () => {
      if (!editingAppointment) {
        throw new Error('No hay cita seleccionada para actualizar')
      }

      if (!isFormContactValid(modalForm)) {
        throw new Error('Debes incluir al menos nombre, telefono o email del contacto')
      }

      const appointmentDate = new Date(modalForm.appointmentDate)
      if (Number.isNaN(appointmentDate.getTime())) {
        throw new Error('Fecha y hora invalida para la cita')
      }

      const payload = {
        appointment_date: appointmentDate.toISOString(),
        contact_name: modalForm.contactName.trim(),
        contact_phone: modalForm.contactPhone.trim(),
        contact_email: modalForm.contactEmail.trim(),
        timezone: modalForm.timezone.trim() || 'America/Bogota',
        status: modalForm.status,
        notes: modalForm.notes.trim(),
      }

      if (editingAppointment.channel === 'voice') {
        return updateVoiceAgentAppointment(editingAppointment.agent_id, editingAppointment.id, payload)
      }

      return updateTextAgentAppointment(editingAppointment.agent_id, editingAppointment.id, payload)
    },
    onSuccess: () => {
      toast.success('Cita actualizada')
      closeModal()
      refresh()
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const { mutate: deleteAppointment, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      if (!editingAppointment) {
        throw new Error('No hay cita seleccionada para eliminar')
      }

      if (editingAppointment.channel === 'voice') {
        return deleteVoiceAgentAppointment(editingAppointment.agent_id, editingAppointment.id)
      }

      return deleteTextAgentAppointment(editingAppointment.agent_id, editingAppointment.id)
    },
    onSuccess: () => {
      toast.success('Cita eliminada')
      closeModal()
      refresh()
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  const canSubmit =
    modalForm.appointmentDate.trim() &&
    isFormContactValid(modalForm) &&
    (modalMode === 'edit' || modalForm.agentId.length > 0)

  const isSaving = isCreating || isUpdating

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full p-8">
        <section className="section-enter mb-6 overflow-hidden rounded-[28px] border border-[#e4e0f5] bg-white px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#271173]">Agenda</p>
              <h1 className="mt-2 text-3xl font-bold text-black">Citas</h1>
              <p className="mt-2 max-w-2xl text-sm text-black/60">
                Vista mensual para planear, crear y actualizar citas de agentes de texto y voz.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-black/45">
                  Canal
                </label>
                <select
                  value={channelFilter}
                  onChange={(event) => setChannelFilter(event.target.value as ChannelFilter)}
                  className="rounded-xl border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black focus:border-[#271173] focus:outline-none"
                >
                  <option value="all">Todos</option>
                  <option value="text">Texto</option>
                  <option value="voice">Voz</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-black/45">
                  Estado
                </label>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  className="rounded-xl border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black focus:border-[#271173] focus:outline-none"
                >
                  <option value="all">Todos</option>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => openCreateModal(selectedDayDate)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a]"
              >
                <PlusIcon className="h-4 w-4" />
                Nueva cita
              </button>
            </div>
          </div>

          {!isLoading && allAgents.length === 0 && (
            <div className="mt-4 rounded-2xl border border-dashed border-[#d4cfee] bg-[#faf9ff] px-4 py-3 text-sm text-black/65">
              No hay agentes disponibles todavia. Crea al menos un agente de texto o voz para registrar citas.
            </div>
          )}
        </section>

        {isLoading && (
          <div className="rounded-3xl border border-[#e4e0f5] bg-white p-6 text-sm text-black/60 shadow-sm">
            Cargando calendario de citas...
          </div>
        )}

        {isError && (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
            No se pudo cargar la agenda.
            {error instanceof Error ? ` ${error.message}` : ''}
          </div>
        )}

        {!isLoading && !isError && (
          <section className="grid gap-4 xl:grid-cols-[1.7fr,1fr]">
            <article className="rounded-3xl border border-[#e4e0f5] bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5f3ff] text-[#271173]">
                    <CalendarDaysIcon className="h-4.5 w-4.5" />
                  </div>
                  <h2 className="text-lg font-semibold text-black">{monthTitle}</h2>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentMonth((previous) =>
                        toMonthStart(new Date(previous.getFullYear(), previous.getMonth() - 1, 1))
                      )
                    }
                    className="rounded-lg border border-[#e4e0f5] bg-white p-1.5 text-black/65 transition-colors hover:border-[#d4cfee] hover:bg-[#faf9ff] hover:text-[#271173]"
                    aria-label="Mes anterior"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentMonth(toMonthStart(new Date()))}
                    className="rounded-lg border border-[#e4e0f5] bg-white px-3 py-1.5 text-xs font-semibold text-black/70 transition-colors hover:border-[#d4cfee] hover:bg-[#faf9ff]"
                  >
                    Hoy
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentMonth((previous) =>
                        toMonthStart(new Date(previous.getFullYear(), previous.getMonth() + 1, 1))
                      )
                    }
                    className="rounded-lg border border-[#e4e0f5] bg-white p-1.5 text-black/65 transition-colors hover:border-[#d4cfee] hover:bg-[#faf9ff] hover:text-[#271173]"
                    aria-label="Mes siguiente"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto no-visible-scrollbar">
                <div className="min-w-190">
                  <div className="grid grid-cols-7 gap-2">
                    {WEEKDAY_LABELS.map((dayLabel) => (
                      <div key={dayLabel} className="px-2 pb-1 text-center text-xs font-semibold uppercase tracking-wide text-black/45">
                        {dayLabel}
                      </div>
                    ))}
                  </div>

                  <div className="mt-1 grid grid-cols-7 gap-2">
                    {monthCells.map((cell) => {
                      const dayAppointments = appointmentsByDay.get(cell.key) ?? []
                      const hiddenAppointments = Math.max(0, dayAppointments.length - 2)
                      const isSelected = cell.key === selectedDayKey

                      return (
                        <div
                          key={cell.key}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedDayKey(cell.key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedDayKey(cell.key)
                            }
                          }}
                          className={`min-h-32 rounded-xl border p-2 transition-colors ${
                            isSelected
                              ? 'border-[#271173] bg-[#f8f5ff]'
                              : cell.inCurrentMonth
                              ? 'border-[#ece8fb] bg-white hover:bg-[#faf9ff]'
                              : 'border-[#f1eefc] bg-[#fcfbff] text-black/45'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-semibold ${cell.isToday ? 'text-[#271173]' : 'text-black/75'}`}>
                              {cell.date.getDate()}
                            </span>
                            {dayAppointments.length > 0 && (
                              <span className="rounded-full bg-[#ede9ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#271173]">
                                {dayAppointments.length}
                              </span>
                            )}
                          </div>

                          <div className="mt-2 space-y-1">
                            {dayAppointments.slice(0, 2).map((appointment) => (
                              <button
                                key={`${appointment.channel}-${appointment.id}`}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openEditModal(appointment)
                                }}
                                className={`w-full truncate rounded-md px-1.5 py-1 text-left text-[10px] font-semibold ring-1 ${channelChipClass(
                                  appointment.channel
                                )}`}
                                title={`${appointment.agent_name} · ${formatDateTime(
                                  appointment.appointment_date_unix_secs
                                )}`}
                              >
                                {new Date(appointment.appointment_date_unix_secs * 1000).toLocaleTimeString('es-CO', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                · {appointment.contact_name || appointment.contact_phone || 'Sin contacto'}
                              </button>
                            ))}

                            {hiddenAppointments > 0 && (
                              <p className="px-1 text-[10px] font-semibold text-black/45">+{hiddenAppointments} mas</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-[#e4e0f5] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/45">Dia seleccionado</p>
                  <h3 className="mt-1 text-base font-semibold text-black">{selectedDayTitle}</h3>
                </div>

                <button
                  type="button"
                  onClick={() => openCreateModal(selectedDayDate)}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#f5f3ff] px-2.5 py-1.5 text-xs font-semibold text-[#271173] transition-colors hover:bg-[#ede9ff]"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Crear
                </button>
              </div>

              <div className="space-y-2">
                {selectedDayAppointments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#d4cfee] bg-[#faf9ff] p-4 text-sm text-black/55">
                    No hay citas registradas para este dia con los filtros actuales.
                  </div>
                ) : (
                  selectedDayAppointments.map((appointment) => (
                    <article
                      key={`${appointment.channel}-${appointment.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEditModal(appointment)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openEditModal(appointment)
                        }
                      }}
                      className="rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3 transition-colors hover:border-[#d9d2f5] hover:bg-white"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-black">
                            {appointment.contact_name || appointment.contact_phone || appointment.contact_email || 'Contacto sin nombre'}
                          </p>
                          <p className="mt-1 inline-flex items-center gap-1 text-xs text-black/60">
                            <ClockIcon className="h-3.5 w-3.5" />
                            {formatDateTime(appointment.appointment_date_unix_secs)}
                          </p>
                          <p className="mt-1 text-xs text-black/55">Agente: {appointment.agent_name}</p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_BADGE[appointment.status]}`}
                          >
                            {statusLabel(appointment.status)}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${channelChipClass(
                              appointment.channel
                            )}`}
                          >
                            {channelLabel(appointment.channel)}
                          </span>
                        </div>
                      </div>

                      {appointment.notes && (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-black/60">{appointment.notes}</p>
                      )}
                    </article>
                  ))
                )}
              </div>

              <div className="mt-4 border-t border-[#ece8fb] pt-3 text-xs text-black/50">
                {filteredAppointments.length} cita(s) visibles en la agenda.
              </div>
            </article>
          </section>
        )}

        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
            <div className="modal-content w-full max-w-2xl rounded-2xl border border-[#e4e0f5] bg-white p-6 shadow-xl">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/45">
                    {modalMode === 'create' ? 'Nueva cita' : 'Actualizar cita'}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-black">
                    {modalMode === 'create' ? 'Crear cita en calendario' : 'Editar cita seleccionada'}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg p-1.5 text-black/50 transition-colors hover:bg-[#f5f3ff] hover:text-black"
                  aria-label="Cerrar modal"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  if (modalMode === 'create') {
                    createAppointment()
                  } else {
                    updateAppointment()
                  }
                }}
                className="space-y-4"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Canal</label>
                    <select
                      value={modalForm.channel}
                      disabled={modalMode === 'edit'}
                      onChange={(event) =>
                        setModalForm((prev) => ({
                          ...prev,
                          channel: event.target.value as Channel,
                          agentId: '',
                        }))
                      }
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#fafafa]"
                    >
                      <option value="text">Agente de texto</option>
                      <option value="voice">Agente de voz</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Agente</label>
                    <select
                      value={modalForm.agentId}
                      disabled={modalMode === 'edit'}
                      onChange={(event) => setModalForm((prev) => ({ ...prev, agentId: event.target.value }))}
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#fafafa]"
                    >
                      {createModeAgents.length === 0 ? (
                        <option value="">Sin agentes disponibles</option>
                      ) : (
                        createModeAgents.map((agent) => (
                          <option key={`${agent.channel}-${agent.id}`} value={agent.id}>
                            {agent.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Fecha y hora</label>
                    <input
                      type="datetime-local"
                      value={modalForm.appointmentDate}
                      onChange={(event) => setModalForm((prev) => ({ ...prev, appointmentDate: event.target.value }))}
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Zona horaria</label>
                    <input
                      type="text"
                      value={modalForm.timezone}
                      onChange={(event) => setModalForm((prev) => ({ ...prev, timezone: event.target.value }))}
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Nombre contacto</label>
                    <input
                      type="text"
                      value={modalForm.contactName}
                      onChange={(event) => setModalForm((prev) => ({ ...prev, contactName: event.target.value }))}
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Telefono</label>
                    <input
                      type="text"
                      value={modalForm.contactPhone}
                      onChange={(event) => setModalForm((prev) => ({ ...prev, contactPhone: event.target.value }))}
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Email</label>
                    <input
                      type="email"
                      value={modalForm.contactEmail}
                      onChange={(event) => setModalForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Estado</label>
                    <select
                      value={modalForm.status}
                      onChange={(event) =>
                        setModalForm((prev) => ({
                          ...prev,
                          status: event.target.value as TextAppointmentStatus,
                        }))
                      }
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-1.5 block text-sm font-medium text-black/80">Nota</label>
                    <textarea
                      value={modalForm.notes}
                      onChange={(event) => setModalForm((prev) => ({ ...prev, notes: event.target.value }))}
                      rows={3}
                      className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ece8fb] pt-4">
                  {modalMode === 'edit' ? (
                    <button
                      type="button"
                      disabled={isSaving || isDeleting}
                      onClick={() => deleteAppointment()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-60"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Eliminar cita
                    </button>
                  ) : (
                    <span className="text-xs text-black/45">Completa al menos un dato de contacto.</span>
                  )}

                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={isSaving || isDeleting}
                      className="rounded-xl bg-[#f5f3ff] px-4 py-2 text-sm font-medium text-black/80 transition-colors hover:bg-[#ede9ff] disabled:opacity-60"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={!canSubmit || isSaving || isDeleting}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
                    >
                      <PlusIcon className="h-4 w-4" />
                      {isSaving
                        ? modalMode === 'create'
                          ? 'Creando...'
                          : 'Actualizando...'
                        : modalMode === 'create'
                        ? 'Crear cita'
                        : 'Guardar cambios'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
