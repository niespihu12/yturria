import { useId, type ReactNode } from 'react'
import ErrorMessage from '@/components/ErrorMessage'
import { cn } from '@/lib/utils'

export const inputClass =
  'block w-full rounded-lg border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-150 hover:border-neutral-400 focus:border-primary-600 focus-visible:outline-offset-0 aria-[invalid=true]:border-danger-500 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-tertiary'

type ControlProps = {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
}

type Props = {
  label: ReactNode
  error?: string
  hint?: ReactNode
  className?: string
  /** Recibe id y atributos ARIA para el control, así la etiqueta queda asociada. */
  children: (control: ControlProps) => ReactNode
}

export default function FormField({ label, error, hint, className, children }: Props) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const showHint = Boolean(hint) && !error
  const describedBy = error ? errorId : showHint ? hintId : undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">
        {label}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {showHint && (
        <p id={hintId} className="text-xs text-text-tertiary">
          {hint}
        </p>
      )}
      {error && <ErrorMessage id={errorId}>{error}</ErrorMessage>}
    </div>
  )
}
