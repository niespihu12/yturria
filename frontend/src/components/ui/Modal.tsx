import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Acciones al pie (botones). */
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Cerrar al hacer clic fuera. Desactivar en formularios largos. */
  dismissOnBackdrop?: boolean
}

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Pila de modales abiertos: Esc y el foco atrapado solo aplican al de arriba.
const openStack: symbol[] = []

/** Diálogo accesible: Esc cierra, el foco queda atrapado y vuelve al disparador al cerrar. */
export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissOnBackdrop = true,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  // La referencia de onClose puede cambiar en cada render; el efecto no debe reiniciarse por eso.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const token = Symbol('modal')
    openStack.push(token)
    const isTop = () => openStack[openStack.length - 1] === token
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // Foco inicial: primer campo del contenido; si no hay, el primer control del diálogo.
    const firstField = bodyRef.current?.querySelector<HTMLElement>(
      '[data-autofocus], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])',
    )
    ;(firstField ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = openStack.indexOf(token)
      if (index !== -1) openStack.splice(index, 1)
      if (openStack.length === 0) document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-surface-overlay"
        onClick={dismissOnBackdrop ? onClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'modal-content relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface-elevated shadow-2xl sm:rounded-2xl',
          SIZES[size],
        )}
      >
        <header className="flex items-start gap-4 border-b border-border-subtle px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-text-primary">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-text-secondary">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 -mt-1 rounded-lg p-2 text-text-tertiary transition-colors hover:bg-neutral-100 hover:text-text-primary"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        {children && (
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {children}
          </div>
        )}
        {footer && (
          <footer className="flex flex-col-reverse gap-2 border-t border-border-subtle bg-surface-muted px-6 py-4 sm:flex-row sm:justify-end">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
