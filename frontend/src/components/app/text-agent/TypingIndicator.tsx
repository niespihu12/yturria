import { cn } from '@/lib/utils'

type Props = {
  label?: string
  className?: string
}

/** Tres puntos suaves mientras el asistente responde. Quietos con movimiento reducido. */
export default function TypingIndicator({ label = 'El asistente está escribiendo', className }: Props) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-2xl rounded-bl-md border border-border-default bg-surface px-3.5 py-3',
        className,
      )}
    >
      <span className="sr-only">{label}…</span>
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-primary-600 animate-pulse motion-reduce:animate-none motion-reduce:opacity-60"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}
