import { cn } from '@/lib/utils'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  count?: number
}

type Props<T extends string> = {
  /** Nombre del grupo para lectores de pantalla. */
  label: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

/** Filtro de opciones excluyentes (p. ej. Pendientes / Resueltas). */
export default function SegmentedFilter<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border-default bg-surface p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm transition-colors',
              active
                ? 'bg-primary-50 font-semibold text-primary-800 ring-1 ring-inset ring-primary-200'
                : 'font-medium text-text-secondary hover:bg-neutral-100 hover:text-text-primary',
            )}
          >
            {option.label}
            {typeof option.count === 'number' && (
              <span className={cn('text-xs tabular-nums', active ? 'text-primary-700' : 'text-text-tertiary')}>
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
