import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

const variantStyles = {
  primary:
    'bg-primary-700 text-text-inverse hover:bg-primary-800 active:bg-primary-900 shadow-xs',
  secondary:
    'bg-primary-50 text-primary-800 hover:bg-primary-100 active:bg-primary-200',
  outline:
    'bg-transparent border border-border-strong text-text-primary hover:bg-neutral-50 hover:border-neutral-300 active:bg-neutral-100',
  ghost:
    'bg-transparent text-text-secondary hover:bg-neutral-100 hover:text-text-primary active:bg-neutral-200',
  danger:
    'bg-danger-600 text-text-inverse hover:bg-danger-700 active:bg-danger-800 shadow-xs',
}

const sizeStyles = {
  sm: 'h-9 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
}

export default function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  disabled,
  // Por defecto no envía formularios; usar type="submit" explícito cuando corresponda.
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-semibold transition-colors duration-150 ease-out',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:transform-none',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <svg
          className="animate-spin h-4 w-4"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {!isLoading && leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  )
}
