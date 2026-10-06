import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ActivityBucket } from '@/lib/dashboardPeriod'

export type ChannelRow = {
  key: string
  label: string
  count: number
}

function conversations(count: number): string {
  return count === 1 ? '1 conversación' : `${count.toLocaleString('es-CO')} conversaciones`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

type ActivityChartProps = {
  buckets: ActivityBucket[]
  /** 'hour': un tramo por hora (Hoy); 'day': un tramo por día (7 / 30 días). */
  unit: 'hour' | 'day'
  rangeLabel: string
  emptyPhrase: string
}

export function ActivityChart({ buckets, unit, rangeLabel, emptyPhrase }: ActivityChartProps) {
  const [active, setActive] = useState<number | null>(null)
  const titleId = useId()
  const title = unit === 'hour' ? 'Conversaciones por hora' : 'Conversaciones por día'
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count))
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const peak = buckets.reduce((best, bucket, index) => (bucket.count > buckets[best].count ? index : best), 0)

  let readout: string
  if (active !== null) {
    readout = `${capitalize(buckets[active].detail)} · ${conversations(buckets[active].count)}`
  } else if (total === 0) {
    readout = `Sin conversaciones ${emptyPhrase}.`
  } else if (unit === 'hour') {
    readout = `${conversations(total)} en total · la hora con más actividad: ${buckets[peak].detail.toLowerCase()}`
  } else {
    readout = `${conversations(total)} en total · el día con más actividad fue el ${buckets[peak].detail}`
  }

  return (
    <section aria-labelledby={titleId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold text-text-primary">
          {title}
        </h2>
        <p className="text-sm text-text-tertiary">{rangeLabel}</p>
      </div>

      <div className="mt-3 rounded-xl border border-border-default bg-surface px-4 pb-4 pt-5 sm:px-5">
        <p aria-hidden="true" className="min-h-5 text-sm tabular-nums text-text-secondary">
          {readout}
        </p>

        <div aria-hidden="true" className="mt-4 flex gap-3">
          <div className="flex h-36 flex-col justify-between pb-px text-right text-xs tabular-nums text-text-muted">
            <span className="-mt-1.5">{max}</span>
            <span className="-mb-1.5">0</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative h-36 border-b border-border-strong">
              <div className="absolute inset-x-0 top-0 border-t border-dashed border-border-default" />
              <div
                className={cn('relative flex h-full items-end', buckets.length > 24 ? 'gap-0.5' : 'gap-1')}
                onMouseLeave={() => setActive(null)}
              >
                {buckets.map((bucket, index) => (
                  <div
                    key={bucket.start}
                    className="flex h-full flex-1 items-end"
                    onMouseEnter={() => setActive(index)}
                  >
                    <div
                      className={cn(
                        'w-full rounded-t-[3px] transition-colors duration-150',
                        active === index ? 'bg-primary-800' : 'bg-primary-600',
                      )}
                      style={{ height: bucket.count > 0 ? `${Math.max((bucket.count / max) * 100, 3)}%` : 0 }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className={cn('mt-2 flex h-4 text-xs tabular-nums text-text-tertiary', buckets.length > 24 ? 'gap-0.5' : 'gap-1')}>
              {buckets.map((bucket) => (
                <span key={bucket.start} className="relative flex-1 text-center">
                  {bucket.tick && (
                    <span
                      className={cn(
                        'absolute left-1/2 -translate-x-1/2 whitespace-nowrap',
                        bucket.minorTick && 'hidden sm:inline',
                      )}
                    >
                      {bucket.tick}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="sr-only">
          <table>
            <caption>
              {title} · {rangeLabel}
            </caption>
            <thead>
              <tr>
                <th scope="col">{unit === 'hour' ? 'Hora' : 'Día'}</th>
                <th scope="col">Conversaciones</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.start}>
                  <td>{bucket.detail}</td>
                  <td>{bucket.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export function ChannelBreakdown({ rows, periodLabel }: { rows: ChannelRow[]; periodLabel: string }) {
  const titleId = useId()
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <section aria-labelledby={titleId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold text-text-primary">
          Por canal
        </h2>
        <p className="text-sm text-text-tertiary">{periodLabel}</p>
      </div>

      <div className="mt-3 rounded-xl border border-border-default bg-surface px-5 py-5">
        {total === 0 ? (
          <p className="text-sm text-text-secondary">Todavía no hay conversaciones en este periodo.</p>
        ) : (
          <ul className="space-y-4">
            {rows.map((row) => {
              const pct = Math.round((row.count / total) * 100)
              return (
                <li key={row.key}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-text-primary">{row.label}</span>
                    <span className="tabular-nums text-text-secondary">
                      <span className="font-semibold text-text-primary">{row.count.toLocaleString('es-CO')}</span>
                      {' · '}
                      {pct} %
                    </span>
                  </div>
                  <div aria-hidden="true" className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full bg-primary-600"
                      style={{ width: `${Math.max(pct, row.count > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
