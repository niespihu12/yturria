import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline'
import { brand } from '@/brand'
import BrandLogo from './BrandLogo'
import SidebarContent from './SidebarContent'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
const DESKTOP_QUERY = '(min-width: 1024px)'

type DrawerProps = {
  id: string
  onClose: () => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}

function NavDrawer({ id, onClose, returnFocusRef }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const panel = panelRef.current
    const trigger = returnFocusRef.current
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
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

    // Si la ventana crece hasta escritorio, el menú deja de tener sentido.
    const desktop = window.matchMedia(DESKTOP_QUERY)
    const onViewportChange = (event: MediaQueryListEvent) => {
      if (event.matches) onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    desktop.addEventListener('change', onViewportChange)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      desktop.removeEventListener('change', onViewportChange)
      trigger?.focus()
    }
  }, [onClose, returnFocusRef])

  return createPortal(
    <div className="fixed inset-0 z-400 lg:hidden">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-surface-overlay transition-opacity duration-200 ease-out starting:opacity-0"
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="Menú principal"
        className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-surface shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] starting:-translate-x-full"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle py-3 pl-5 pr-2">
          <div className="min-w-0">
            <BrandLogo className="h-8" />
            <p className="mt-2 truncate text-xs text-text-tertiary">{brand.productName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-neutral-100 hover:text-text-primary"
          >
            <XMarkIcon aria-hidden="true" className="h-6 w-6" />
          </button>
        </div>
        <SidebarContent onNavigate={onClose} />
      </div>
    </div>,
    document.body,
  )
}

/** Barra superior y menú lateral para pantallas menores que lg. */
export default function MobileNav() {
  const { pathname } = useLocation()
  const drawerId = useId()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  // Guardar la ruta en la que se abrió cierra el menú en cuanto cambia la navegación.
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const open = openedAt === pathname

  const close = useCallback(() => setOpenedAt(null), [])

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-default bg-surface pl-4 pr-2 lg:hidden">
        <Link
          to="/dashboard"
          aria-label={`${brand.logo.alt}, ir al Dashboard`}
          className="inline-flex shrink-0 rounded-lg"
        >
          <BrandLogo variant="mark" className="h-8" />
        </Link>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {brand.productName}
        </p>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setOpenedAt(pathname)}
          aria-label="Abrir menú"
          aria-expanded={open}
          aria-controls={open ? drawerId : undefined}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-neutral-100 hover:text-text-primary"
        >
          <Bars3Icon aria-hidden="true" className="h-6 w-6" />
        </button>
      </header>
      {open && <NavDrawer id={drawerId} onClose={close} returnFocusRef={menuButtonRef} />}
    </>
  )
}
