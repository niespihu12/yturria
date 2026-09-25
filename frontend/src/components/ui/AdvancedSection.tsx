import type { ReactNode } from 'react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

type Props = {
  title?: string
  description?: string
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}

/**
 * Agrupa opciones técnicas (proveedores, credenciales, parámetros del modelo)
 * detrás de una sección plegable, para que el equipo de negocio vea primero
 * lo que usa a diario.
 */
export default function AdvancedSection({
  title = 'Configuración avanzada',
  description = 'Opciones técnicas. Normalmente no necesita cambiarlas.',
  children,
  defaultOpen = false,
  className,
}: Props) {
  return (
    <details
      open={defaultOpen}
      className={cn('group rounded-xl border border-border-default bg-surface-muted', className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-3 text-left hover:bg-neutral-100 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          {description && <p className="mt-0.5 text-xs text-text-tertiary">{description}</p>}
        </div>
        <ChevronDownIcon
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <div className="space-y-4 border-t border-border-default px-4 py-4">{children}</div>
    </details>
  )
}
