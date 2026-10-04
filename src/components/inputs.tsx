import type { ReactNode } from 'react'
import type { TriState } from '../lib/dayForm'

export function Field({
  label, hint, error, children,
}: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {hint && <span className="muted small">{hint}</span>}
      </div>
      {children}
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  )
}

export function TextInput({
  value, onChange, inputMode, placeholder, disabled, ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  inputMode: 'decimal' | 'numeric'
  placeholder?: string
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <input
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// A row of numbers 1..max. Tapping the selected number again clears it (not answered).
export function ScaleButtons({
  value, max, onChange, disabled, ariaLabel,
}: { value: string; max: number; onChange: (value: string) => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <div className="scale" role="group" aria-label={ariaLabel} style={{ gridTemplateColumns: `repeat(${max}, 1fr)` }}>
      {Array.from({ length: max }, (_, i) => String(i + 1)).map((n) => (
        <button
          key={n}
          type="button"
          className={value === n ? 'chip selected' : 'chip'}
          aria-pressed={value === n}
          disabled={disabled}
          onClick={() => onChange(value === n ? '' : n)}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

const TRI_OPTIONS: { value: TriState; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: '', label: 'Not answered' },
]

export function TriStateButtons({
  value, onChange, disabled, ariaLabel,
}: { value: TriState; onChange: (value: TriState) => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {TRI_OPTIONS.map((option) => (
        <button
          key={option.label}
          type="button"
          className={value === option.value ? 'chip selected' : 'chip'}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
