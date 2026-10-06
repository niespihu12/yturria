/** Periodos del Resumen: hoy (por hora), últimos 7 días y últimos 30 días (por día). */
export type DashboardPeriod = 'day' | 'week' | 'month'

export const DEFAULT_PERIOD: DashboardPeriod = 'month'

/** Valor en la URL (?periodo=…) de cada periodo. */
export const PERIOD_PARAM: Record<DashboardPeriod, string> = { day: 'hoy', week: 'semana', month: 'mes' }

export const PERIOD_OPTIONS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: 'day', label: 'Hoy' },
  { value: 'week', label: '7 días' },
  { value: 'month', label: '30 días' },
]

export function periodFromParam(value: string | null): DashboardPeriod {
  const match = (Object.keys(PERIOD_PARAM) as DashboardPeriod[]).find((key) => PERIOD_PARAM[key] === value)
  return match ?? DEFAULT_PERIOD
}

export type PeriodWindow = {
  period: DashboardPeriod
  /** Inicio del periodo (unix, segundos, incluido). */
  start: number
  /** Inicio del periodo anterior de la misma duración (termina en `start`). */
  previousStart: number
  /** "Hoy" · "Últimos 7 días" · "Últimos 30 días" */
  label: string
  /** "Ayer" · "7 días anteriores" · "30 días anteriores" */
  previousLabel: string
  /** Frase para cuando no hay datos: "hoy", "en los últimos 7 días"… */
  emptyPhrase: string
}

const DAYS: Record<DashboardPeriod, number> = { day: 1, week: 7, month: 30 }

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

function startOfDay(ms: number): Date {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

export function periodWindow(period: DashboardPeriod, nowMs: number): PeriodWindow {
  const days = DAYS[period]
  const start = addDays(startOfDay(nowMs), -(days - 1))
  const previousStart = addDays(start, -days)
  return {
    period,
    start: unix(start),
    previousStart: unix(previousStart),
    label: period === 'day' ? 'Hoy' : `Últimos ${days} días`,
    previousLabel: period === 'day' ? 'Ayer' : `${days} días anteriores`,
    emptyPhrase: period === 'day' ? 'hoy' : `en los últimos ${days} días`,
  }
}

export type ActivityBucket = {
  /** Inicio del tramo (unix, segundos). */
  start: number
  /** Etiqueta corta del eje ('' si no se muestra en ese tramo). */
  tick: string
  /** Etiqueta secundaria: se oculta en pantallas angostas para que no se encimen. */
  minorTick: boolean
  /** Descripción completa del tramo para el detalle al pasar el mouse. */
  detail: string
  count: number
}

const two = (value: number) => String(value).padStart(2, '0')

/** Partes de fecha sin puntos ni comas: así se ven igual en todos los navegadores. */
const part = (date: Date, options: Intl.DateTimeFormatOptions) =>
  date.toLocaleDateString('es-CO', options).replace(/[.,]/g, '').trim()

function dayDetail(date: Date): string {
  return `${part(date, { weekday: 'long' })} ${date.getDate()} de ${part(date, { month: 'long' })}`
}

/** Tramos del gráfico: 24 horas de hoy, o un tramo por día en 7 / 30 días. */
export function buildActivityBuckets(timestamps: number[], window: PeriodWindow, nowMs: number): ActivityBucket[] {
  const startDate = new Date(window.start * 1000)
  let starts: Date[]
  let describe: (date: Date, index: number, total: number) => Pick<ActivityBucket, 'tick' | 'minorTick' | 'detail'>

  if (window.period === 'day') {
    starts = Array.from({ length: 24 }, (_, hour) => {
      const date = new Date(startDate)
      date.setHours(hour)
      return date
    })
    describe = (date, index) => {
      const label = `${two(date.getHours())}:00`
      const next = `${two((date.getHours() + 1) % 24)}:00`
      return { tick: index % 3 === 0 ? label : '', minorTick: index % 6 !== 0, detail: `De ${label} a ${next}` }
    }
  } else {
    const days = window.period === 'week' ? 7 : 30
    starts = Array.from({ length: days }, (_, index) => addDays(startDate, index))
    describe = (date, index, total) => {
      // 7 días: todos los días ("mar 6"); 30 días: uno de cada cinco, terminando en hoy ("6 oct").
      // En pantallas angostas se muestra la mitad (día por medio / cada 10 días).
      const fromToday = total - 1 - index
      const tick =
        window.period === 'week'
          ? `${part(date, { weekday: 'short' })} ${date.getDate()}`
          : fromToday % 5 === 0
            ? `${date.getDate()} ${part(date, { month: 'short' })}`
            : ''
      const minorTick = window.period === 'week' ? fromToday % 2 !== 0 : fromToday % 10 !== 0
      return { tick, minorTick, detail: dayDetail(date) }
    }
  }

  const ends = [...starts.slice(1).map(unix), unix(window.period === 'day' ? addDays(startDate, 1) : addDays(startOfDay(nowMs), 1))]
  const buckets: ActivityBucket[] = starts.map((date, index) => ({
    start: unix(date),
    count: 0,
    ...describe(date, index, starts.length),
  }))
  for (const timestamp of timestamps) {
    const index = buckets.findIndex((bucket, i) => timestamp >= bucket.start && timestamp < ends[i])
    if (index >= 0) buckets[index].count += 1
  }
  return buckets
}
