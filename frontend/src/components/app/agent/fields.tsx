import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  errorClass,
  helpClass,
  labelClass,
  sectionDescriptionClass,
  sectionTitleClass,
  subsectionTitleClass,
} from './agentUi'

type SwitchProps = {
  checked: boolean
  onChange: (next: boolean) => void
  /** Nombre accesible cuando no hay un texto visible que lo etiquete. */
  label?: string
  labelledBy?: string
  describedBy?: string
  disabled?: boolean
}

/** Interruptor accesible (role="switch"). */
export function Switch({ checked, onChange, label, labelledBy, describedBy, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex shrink-0 items-center rounded-full focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200',
          'group-focus-visible:ring-2 group-focus-visible:ring-primary-500 group-focus-visible:ring-offset-2',
          checked ? 'bg-primary-600' : 'bg-neutral-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-surface shadow-sm transition-transform duration-200',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

type SwitchFieldProps = {
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  className?: string
}

export function SwitchField({ label, description, checked, onChange, disabled, className }: SwitchFieldProps) {
  const id = useId()
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm font-medium text-text-primary">
          {label}
        </p>
        {description && (
          <p id={`${id}-desc`} className={helpClass}>
            {description}
          </p>
        )}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        labelledBy={`${id}-label`}
        describedBy={description ? `${id}-desc` : undefined}
        disabled={disabled}
      />
    </div>
  )
}

type FieldControlProps = {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

type FieldProps = {
  label: ReactNode
  help?: ReactNode
  error?: string | null
  className?: string
  labelClassName?: string
  children: (control: FieldControlProps) => ReactNode
}

/** Etiqueta asociada (htmlFor/id), ayuda antes del control y error debajo. */
export function Field({ label, help, error, className, labelClassName, children }: FieldProps) {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className={className}>
      <label htmlFor={id} className={cn(labelClass, labelClassName)}>
        {label}
      </label>
      {help && (
        <p id={helpId} className={helpClass}>
          {help}
        </p>
      )}
      <div className="mt-2">
        {children({
          id,
          'aria-describedby': describedBy || undefined,
          'aria-invalid': error ? true : undefined,
        })}
      </div>
      {error && (
        <p id={errorId} className={errorClass}>
          {error}
        </p>
      )}
    </div>
  )
}

type SliderFieldProps = Omit<ComponentProps<'input'>, 'type' | 'id'> & {
  label: string
  description?: string
  displayValue: string
  minLabel?: string
  maxLabel?: string
}

export function SliderField({
  label,
  description,
  displayValue,
  minLabel,
  maxLabel,
  className,
  ...inputProps
}: SliderFieldProps) {
  const id = useId()
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        <output htmlFor={id} className="text-sm font-semibold tabular-nums text-primary-700">
          {displayValue}
        </output>
      </div>
      {description && (
        <p id={`${id}-desc`} className={helpClass}>
          {description}
        </p>
      )}
      <input
        id={id}
        type="range"
        aria-describedby={description ? `${id}-desc` : undefined}
        className="mt-3 block w-full cursor-pointer accent-primary-600"
        {...inputProps}
      />
      {(minLabel || maxLabel) && (
        <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-text-tertiary">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  )
}

type SectionHeadingProps = {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  as?: 'h2' | 'h3'
  id?: string
  className?: string
}

export function SectionHeading({ title, description, action, as = 'h2', id, className }: SectionHeadingProps) {
  const Heading = as
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <Heading id={id} className={as === 'h2' ? sectionTitleClass : subsectionTitleClass}>
          {title}
        </Heading>
        {description && <p className={sectionDescriptionClass}>{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  )
}
