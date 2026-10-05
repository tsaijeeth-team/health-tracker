import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CARDIO_TYPES, EMPTY_CARDIO_FORM, cardioFormFromRow, cardioFormsEqual, cardioLabel, totalMinutes, validateCardioForm,
  type CardioErrors, type CardioForm, type CardioRow,
} from './lib/cardio'
import { sortByTime } from './lib/fluids'
import { nowTimeIST } from './lib/dates'
import { friendlyError } from './lib/errors'
import { formatMinutes } from './lib/sleep'
import { useDayRows } from './lib/useDayRows'
import { Field } from './components/inputs'

type Props = {
  supabase: SupabaseClient
  dayId: string | null
  locked: boolean
  ensureDay: () => Promise<string>
  onDirtyChange: (dirty: boolean) => void
}

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; item: CardioRow }

function CardioSection({ supabase, dayId, locked, ensureDay, onDirtyChange }: Props) {
  const { rows, loading, error: loadError, reload } = useDayRows<CardioRow>(supabase, 'cardio_sessions', dayId)
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [form, setForm] = useState<CardioForm>(EMPTY_CARDIO_FORM)
  const [baseline, setBaseline] = useState<CardioForm>(EMPTY_CARDIO_FORM)
  const [errors, setErrors] = useState<CardioErrors>({})
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const dirty = mode.kind !== 'closed' && !cardioFormsEqual(form, baseline)
  const sorted = useMemo(() => sortByTime(rows), [rows])
  const total = totalMinutes(rows)

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  function closeForm() {
    setMode({ kind: 'closed' })
    setForm(EMPTY_CARDIO_FORM)
    setBaseline(EMPTY_CARDIO_FORM)
    setErrors({})
    setActionError('')
  }

  function confirmDiscard() {
    return !dirty || window.confirm('Discard the cardio session you are entering?')
  }

  function openAdd() {
    if (!confirmDiscard()) return
    const start = { ...EMPTY_CARDIO_FORM, start_time: nowTimeIST() }
    setForm(start)
    setBaseline(start)
    setErrors({})
    setActionError('')
    setMode({ kind: 'add' })
  }

  function openEdit(item: CardioRow) {
    if (locked || !confirmDiscard()) return
    const f = cardioFormFromRow(item)
    setForm(f)
    setBaseline(f)
    setErrors({})
    setActionError('')
    setMode({ kind: 'edit', item })
  }

  function update<K extends keyof CardioForm>(key: K, value: CardioForm[K]) {
    setActionError('')
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit() {
    const { errors: found, payload } = validateCardioForm(form)
    setErrors(found)
    if (!payload) {
      setActionError('Please fix the highlighted fields.')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      if (mode.kind === 'edit') {
        const { error } = await supabase.from('cardio_sessions').update(payload).eq('id', mode.item.id)
        if (error) throw error
        await reload(mode.item.day_id)
      } else {
        const id = await ensureDay()
        const { error } = await supabase.from('cardio_sessions').insert({ ...payload, day_id: id })
        if (error) throw error
        await reload(id)
      }
      closeForm()
    } catch (e) {
      const err = e as { message?: string; code?: string }
      setActionError(friendlyError(err.message ?? String(e), err.code))
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: CardioRow) {
    if (!window.confirm(`Delete ${cardioLabel(item.cardio_type)} (${item.minutes} min)?`)) return
    setBusy(true)
    const { error } = await supabase.from('cardio_sessions').delete().eq('id', item.id)
    setBusy(false)
    if (error) {
      setActionError(friendlyError(error.message, error.code))
      return
    }
    closeForm()
    await reload(item.day_id)
  }

  return (
    <section className="card">
      <h2>Cardio</h2>
      <p className="cardio-total">
        Total: <strong>{total === 0 ? '0 min' : formatMinutes(total)}</strong>
      </p>

      {loading && <p className="muted small">Loading cardio…</p>}
      {loadError && <p className="error small">{loadError}</p>}
      {!loading && !loadError && rows.length === 0 && <p className="muted small">No cardio logged for this day.</p>}

      {sorted.length > 0 && (
        <ul className="food-list">
          {sorted.map((c) => (
            <li key={c.id}>
              <button type="button" className={mode.kind === 'edit' && mode.item.id === c.id ? 'food-item editing' : 'food-item'}
                onClick={() => openEdit(c)} disabled={locked} aria-label={`Edit ${cardioLabel(c.cardio_type)} at ${c.start_time.slice(0, 5)}`}>
                <span className="food-main">
                  <span className="food-name">
                    {c.start_time.slice(0, 5)} · {cardioLabel(c.cardio_type)}
                    {c.description && <span className="muted"> ({c.description})</span>}
                  </span>
                  <span className="food-kcal">{c.minutes} min</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!locked && mode.kind === 'closed' && (
        <button type="button" onClick={openAdd}>+ Add cardio</button>
      )}
      {actionError && mode.kind === 'closed' && <p className="error small" role="alert">{actionError}</p>}

      {mode.kind !== 'closed' && (
        <div className="subpanel">
          <h3>{mode.kind === 'edit' ? 'Edit cardio' : 'Add cardio'}</h3>
          <Field label="Type" error={errors.cardio_type}>
            <div className="chip-grid" role="group" aria-label="Cardio type">
              {CARDIO_TYPES.map((t) => (
                <button key={t.value} type="button" disabled={busy}
                  className={form.cardio_type === t.value ? 'chip selected' : 'chip'} aria-pressed={form.cardio_type === t.value}
                  onClick={() => update('cardio_type', t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          {form.cardio_type === 'other' && (
            <Field label="Description" hint="optional, e.g. badminton" error={errors.description}>
              <input type="text" aria-label="Cardio description" maxLength={100} value={form.description} disabled={busy}
                onChange={(e) => update('description', e.target.value)} />
            </Field>
          )}
          <div className="two-col">
            <Field label="Minutes" error={errors.minutes}>
              <input type="text" inputMode="numeric" aria-label="Minutes" autoComplete="off" value={form.minutes} disabled={busy}
                onChange={(e) => update('minutes', e.target.value)} />
            </Field>
            <Field label="Start time" error={errors.start_time}>
              <input type="time" aria-label="Start time" value={form.start_time} disabled={busy}
                onChange={(e) => update('start_time', e.target.value)} />
            </Field>
          </div>
          {actionError && <p className="error small" role="alert">{actionError}</p>}
          <div className="button-row">
            <button type="button" onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : mode.kind === 'edit' ? 'Update' : 'Add'}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => { if (confirmDiscard()) closeForm() }}>
              Cancel
            </button>
          </div>
          {mode.kind === 'edit' && (
            <button type="button" className="danger" disabled={busy} onClick={() => remove(mode.item)}>
              Delete this session
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default CardioSection
