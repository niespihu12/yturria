import { useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'

export const authLinkClass =
  'font-medium text-primary-700 underline-offset-4 transition-colors hover:text-primary-800 hover:underline'

export function AuthHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <header>
      <h1 className="font-display text-3xl leading-tight text-primary-800">{title}</h1>
      {description && (
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{description}</p>
      )}
    </header>
  )
}

const LENGTH = 6
const DIGITS = Array.from({ length: LENGTH }, (_, index) => index)

type PinCodeFieldProps = {
  legend: string
  value: string
  onChange: (value: string) => void
  onComplete: (value: string) => void
  disabled?: boolean
}

/**
 * Código de 6 dígitos con etiqueta de grupo y nombre accesible por casilla.
 * Avanza solo al escribir, retrocede con Backspace y acepta pegar el código completo.
 */
export function PinCodeField({ legend, value, onChange, onComplete, disabled }: PinCodeFieldProps) {
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const digits = value.replace(/\D/g, '').slice(0, LENGTH).split('')

  const commit = (next: string, focusIndex: number) => {
    const clean = next.replace(/\D/g, '').slice(0, LENGTH)
    onChange(clean)
    inputs.current[Math.min(focusIndex, LENGTH - 1)]?.focus()
    if (clean.length === LENGTH) onComplete(clean)
  }

  const handleInput = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '')
    if (!typed) return
    const chars = [...digits]
    // Autocompletado del SO o varios dígitos a la vez: se reparten desde esta casilla.
    typed.split('').forEach((char, offset) => {
      if (index + offset < LENGTH) chars[index + offset] = char
    })
    commit(chars.join(''), index + typed.length)
  }

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const chars = [...digits]
      if (chars[index]) {
        chars.splice(index, 1)
        commit(chars.join(''), index)
      } else if (index > 0) {
        chars.splice(index - 1, 1)
        commit(chars.join(''), index - 1)
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault()
      inputs.current[index - 1]?.focus()
    } else if (event.key === 'ArrowRight' && index < LENGTH - 1) {
      event.preventDefault()
      inputs.current[index + 1]?.focus()
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '')
    if (!pasted) return
    event.preventDefault()
    commit(pasted, pasted.length)
  }

  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium text-text-primary">{legend}</legend>
      <div className="mt-3 flex gap-2 sm:gap-3">
        {DIGITS.map((index) => (
          <input
            key={index}
            ref={(element) => {
              inputs.current[index] = element
            }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={index === 0 ? LENGTH : 1}
            value={digits[index] ?? ''}
            aria-label={`Dígito ${index + 1} de ${LENGTH}`}
            onChange={(event) => handleInput(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            onFocus={(event) => event.target.select()}
            className="h-12 w-11 rounded-lg border border-border-strong bg-surface text-center text-lg font-semibold tabular-nums text-text-primary transition-colors hover:border-neutral-400 focus:border-primary-600 focus-visible:outline-offset-0 disabled:opacity-60"
          />
        ))}
      </div>
    </fieldset>
  )
}
