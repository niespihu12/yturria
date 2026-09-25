import Logo from '@/components/Logo'
import { brand } from '@/brand'
import { cn } from '@/lib/utils'

/*
 * Cada marca declara si su logo va sobre superficie clara (Seguros Bolívar,
 * con sus colores originales) o necesita placa de color (logo AOS en blanco).
 */
const needsDarkBackdrop = brand.logo.surface === 'dark'

type Props = {
  variant?: 'full' | 'mark'
  /** Alto del logo, p. ej. `h-9`. */
  className?: string
}

export default function BrandLogo({ variant = 'full', className = 'h-9' }: Props) {
  if (!needsDarkBackdrop) {
    return <Logo variant={variant} className={cn('w-auto', className)} />
  }
  return (
    <span className="inline-flex rounded-lg bg-primary-700 px-2.5 py-1.5">
      <Logo variant={variant} className={cn('w-auto', className)} />
    </span>
  )
}
