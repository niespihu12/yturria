import type { ReactNode } from 'react'
import { ExclamationCircleIcon } from '@heroicons/react/20/solid'
import { cn } from '@/lib/utils'

type Props = {
  children: ReactNode
  id?: string
  className?: string
}

/** Mensaje de validación junto al campo: tono calmado, sin mayúsculas. */
export default function ErrorMessage({ children, id, className }: Props) {
  return (
    <p id={id} className={cn('flex items-start gap-1.5 text-sm text-danger-700', className)}>
      <ExclamationCircleIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
