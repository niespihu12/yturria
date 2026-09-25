import { useId, useState } from 'react'
import { cn } from '@/lib/utils'

export type HourBucket = {
  /** Inicio de la hora (unix, segundos). */
  start: number
  label: string
  count: number
}

export type ChannelRow = {
  key: string
  label: string
  count: number
}

function conversations(count: number): string {
  return count === 1 ? '1 conversación' : `${count.toLocaleString('es-CO')} conversaciones`
}

export function HourlyActivityChart({ buckets }: { buckets: HourBucket[] }) {
  const [active, setActive] = useState<number | null>(null)
  const titleId = useId()
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count))
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0)
  const peak = buckets.reduce((best, bucket, index) => (bucket.count > buckets[best].count ? index : best), 0)

  let readout: string
  if (active !== null) {
    const bucket = buckets[active]
    const next = buckets[active + 1]?.label
    readout = `${next ? `De ${bucket.label} a ${next}` : `Desde las ${bucket.label}`} · ${conversations(bucket.count)}`
  } else if (total === 0) {
    readout = 'Sin conversaciones en las últimas 12 horas.'
  } else {
    readout = `${conversations(total)} en total · la hora con más actividad fue las ${buckets[peak].label}`
  }

  return (
    <section aria-labelledby={titleId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold text-text-primary">
          Conversaciones por hora
        </h2>
        <p className="text-sm text-text-tertiary">Últimas 12 horas</p>
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
              <div className="relative flex h-full items-end gap-1" onMouseLeave={() => setActive(null)}>
                {buckets.map((bucket, index) => (
                  <div
                    key={bucket.start}
                    className="flex h-full flex-1 items-end"
                    onMouseEnter={() => setActive(index)}
                  >
                    <div
                      className={cn(
                        'w-full rounded-t-[4px] transition-colors duration-150',
                        active === index ? 'bg-primary-800' : 'bg-primary-600',
                      )}
                      style={{ height: bucket.count > 0 ? `${(bucket.count / max) * 100}%` : 0 }}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2 flex gap-1 text-xs tabular-nums text-text-tertiary">
              {buckets.map((bucket, index) => (
                <span key={bucket.start} className="flex-1 whitespace-nowrap text-center">
                  {index % 3 === 2 ? bucket.label : ''}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="sr-only">
          <table>
            <caption>Conversaciones por hora en las últimas 12 horas</caption>
            <thead>
              <tr>
                <th scope="col">Hora</th>
                <th scope="col">Conversaciones</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.start}>
                  <td>{bucket.label}</td>
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
