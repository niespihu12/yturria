import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  title: ReactNode
  description?: ReactNode
  /** Acciones a la derecha. Una sola acción primaria por vista. */
  actions?: ReactNode
  className?: string
}

/**
 * Encabezado estándar de página. El título usa la fuente display de la marca
 * y un pequeño cuadro de acento (el cuadrado amarillo del isotipo en el tema
 * Seguros Bolívar) como único toque de color de la cabecera.
 */
export default function PageHeader({ title, description, actions, className }: Props) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 font-display text-2xl leading-tight text-primary-800 sm:text-3xl">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] bg-highlight-400" />
          <span className="min-w-0">{title}</span>
        </h1>
        {description && (
          <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-text-secondary">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
