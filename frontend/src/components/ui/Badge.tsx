import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  className?: string
  variant?:
    | 'default'
    | 'primary'
    | 'secondary'
    | 'success'
    | 'warning'
    | 'danger'
    | 'info'
  size?: 'sm' | 'md'
}

const variantStyles = {
  default: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
  primary: 'bg-primary-100 text-primary-700 ring-primary-200',
  secondary: 'bg-accent-50 text-accent-700 ring-accent-200',
  success: 'bg-accent-100 text-accent-700 ring-accent-200',
  warning: 'bg-warning-50 text-warning-700 ring-warning-200',
  danger: 'bg-danger-50 text-danger-700 ring-danger-200',
  info: 'bg-info-50 text-info-700 ring-info-200',
}

const sizeStyles = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
}

export default function Badge({
  children,
  className,
  variant = 'default',
  size = 'md',
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold ring-1 ring-inset',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {children}
    </span>
  )
}
