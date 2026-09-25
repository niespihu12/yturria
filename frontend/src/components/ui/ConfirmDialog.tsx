import { useCallback, useRef, useState, type ReactNode } from 'react'
import Modal from './Modal'
import Button from './Button'

type ConfirmOptions = {
  title: string
  /** Qué pasará exactamente (p. ej. "Se borrarán sus 12 conversaciones"). */
  description?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
}

/**
 * Reemplazo accesible de window.confirm().
 * Uso: const [confirm, confirmDialog] = useConfirm(); … if (await confirm({...})) …
 * y renderizar {confirmDialog} en el componente.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setOptions(null)
  }, [])

  const dialog = (
    <Modal
      open={options !== null}
      onClose={() => settle(false)}
      title={options?.title ?? ''}
      description={options?.description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => settle(false)}>
            {options?.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button variant={options?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {options?.confirmLabel}
          </Button>
        </>
      }
    />
  )

  return [confirm, dialog]
}
