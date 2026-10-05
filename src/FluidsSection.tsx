import { useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EMPTY_FLUID_FORM, FLUID_TARGET_ML, FLUID_TYPES, QUICK_ADD_ML,
  fluidFormFromRow, fluidFormsEqual, fluidLabel, fluidTotals, kcalAllowed, sortByTime, validateFluidForm,
  type FluidErrors, type FluidForm, type FluidRow,
} from './lib/fluids'
import { formatNumber } from './lib/food'
import { nowTimeIST } from './lib/dates'
import { friendlyError } from './lib/errors'
import { useDayRows } from './lib/useDayRows'
import { Field } from './components/inputs'

export type DrinkKcal = { known: number; unknownCount: number }

type Props = {
  supabase: SupabaseClient
  dayId: string | null
  locked: boolean
  ensureDay: () => Promise<string>
  onDirtyChange: (dirty: boolean) => void
  onKcalChange: (kcal: DrinkKcal) => void
}

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; item: FluidRow }
type Undo = { id: string; dayId: string; ml: number }

const UNDO_SECONDS = 5

function FluidsSection({ supabase, dayId, locked, ensureDay, onDirtyChange, onKcalChange }: Props) {
  const { rows, loading, error: loadError, reload } = useDayRows<FluidRow>(supabase, 'fluids', dayId)
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [form, setForm] = useState<FluidForm>(EMPTY_FLUID_FORM)
  const [baseline, setBaseline] = useState<FluidForm>(EMPTY_FLUID_FORM)
  const [errors, setErrors] = useState<FluidErrors>({})
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [undo, setUndo] = useState<Undo | null>(null)
  const undoTimer = useRef<number | undefined>(undefined)

  const dirty = mode.kind !== 'closed' && !fluidFormsEqual(form, baseline)
  const totals = useMemo(() => fluidTotals(rows), [rows])
  const sorted = useMemo(() => sortByTime(rows), [rows])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    onKcalChange({ known: totals.kcalKnown, unknownCount: totals.kcalUnknownCount })
  }, [totals.kcalKnown, totals.kcalUnknownCount, onKcalChange])

  useEffect(() => () => window.clearTimeout(undoTimer.current), [])

  function closeForm() {
    setMode({ kind: 'closed' })
    setForm(EMPTY_FLUID_FORM)
    setBaseline(EMPTY_FLUID_FORM)
    setErrors({})
    setActionError('')
  }

  function confirmDiscard() {
    return !dirty || window.confirm('Discard the drink you are entering?')
  }

  function openAdd() {
    if (!confirmDiscard()) return
    // The time is pre-filled with "now"; it only counts as unsaved once something else changes.
    const start = { ...EMPTY_FLUID_FORM, drink_time: nowTimeIST() }
    setForm(start)
    setBaseline(start)
    setErrors({})
    setActionError('')
    setMode({ kind: 'add' })
  }

  function openEdit(item: FluidRow) {
    if (locked || !confirmDiscard()) return
    const f = fluidFormFromRow(item)
    setForm(f)
    setBaseline(f)
    setErrors({})
    setActionError('')
    setMode({ kind: 'edit', item })
  }

  function update<K extends keyof FluidForm>(key: K, value: FluidForm[K]) {
    setActionError('')
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
    setForm((f) => ({ ...f, [key]: value }))
  }

  function showUndo(next: Undo) {
    window.clearTimeout(undoTimer.current)
    setUndo(next)
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_SECONDS * 1000)
  }

  async function quickAdd(ml: number) {
    setActionError('')
    try {
      const id = await ensureDay()
      const { data, error } = await supabase
        .from('fluids')
        .insert({ day_id: id, drink_time: nowTimeIST(), drink_type: 'water', ml })
        .select('id')
        .single()
      if (error) throw error
      showUndo({ id: (data as { id: string }).id, dayId: id, ml })
      await reload(id)
    } catch (e) {
      const err = e as { message?: string; code?: string }
      setActionError(friendlyError(err.message ?? String(e), err.code))
    }
  }

  async function undoLast() {
    if (!undo) return
    const target = undo
    window.clearTimeout(undoTimer.current)
    setUndo(null)
    const { error } = await supabase.from('fluids').delete().eq('id', target.id)
    if (error) setActionError(friendlyError(error.message, error.code))
    await reload(target.dayId)
  }

  async function submit() {
    const { errors: found, payload } = validateFluidForm(form)
    setErrors(found)
    if (!payload) {
      setActionError('Please fix the highlighted fields.')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      if (mode.kind === 'edit') {
        const { error } = await supabase.from('fluids').update(payload).eq('id', mode.item.id)
        if (error) throw error
        await reload(mode.item.day_id)
      } else {
        const id = await ensureDay()
        const { error } = await supabase.from('fluids').insert({ ...payload, day_id: id })
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

  async function remove(item: FluidRow) {
    if (!window.confirm(`Delete ${fluidLabel(item.drink_type)} (${formatNumber(item.ml)} ml)?`)) return
    setBusy(true)
    const { error } = await supabase.from('fluids').delete().eq('id', item.id)
    setBusy(false)
    if (error) {
      setActionError(friendlyError(error.message, error.code))
      return
    }
    closeForm()
    await reload(item.day_id)
  }

  const reached = totals.totalMl >= FLUID_TARGET_ML
  const showKcal = Boolean(form.drink_type) && kcalAllowed(form.drink_type)

  return (
    <section className="card">
      <h2>Fluids</h2>

      <div className="kcal">
        <div className="kcal-numbers">
          <strong>{formatNumber(totals.totalMl)}</strong> / {formatNumber(FLUID_TARGET_ML)} ml
          <span className={`kcal-note ${reached ? 'green' : 'muted-note'}`}>
            {reached ? 'Target reached' : `${formatNumber(FLUID_TARGET_ML - totals.totalMl)} ml to go`}
          </span>
        </div>
        <div className="kcal-track" role="progressbar" aria-label="Fluids against 4 litre target"
          aria-valuemin={0} aria-valuemax={FLUID_TARGET_ML} aria-valuenow={totals.totalMl}>
          <div className="kcal-fill water" style={{ width: `${Math.min(100, (totals.totalMl / FLUID_TARGET_ML) * 100)}%` }} />
        </div>
      </div>

      <dl className="totals small">
        <div><dt>Water &amp; other drinks</dt><dd>{formatNumber(totals.otherMl)} ml</dd></div>
        <div><dt>Sugary drinks</dt><dd className={totals.sugaryMl > 0 ? 'sugary' : ''}>{formatNumber(totals.sugaryMl)} ml</dd></div>
        <div>
          <dt>Drink calories</dt>
          <dd>
            {totals.kcalUnknownCount > 0 ? 'at least ' : ''}{formatNumber(totals.kcalKnown)} kcal
            {totals.kcalUnknownCount > 0 && ` (${totals.kcalUnknownCount} unknown)`}
          </dd>
        </div>
      </dl>

      {!locked && mode.kind === 'closed' && (
        <>
          <div className="button-row">
            <button type="button" onClick={() => quickAdd(QUICK_ADD_ML.glass)}>+{QUICK_ADD_ML.glass} ml water</button>
            <button type="button" onClick={() => quickAdd(QUICK_ADD_ML.bottle)}>+{QUICK_ADD_ML.bottle} ml water</button>
          </div>
          <button type="button" className="secondary" onClick={openAdd}>+ Add other drink</button>
        </>
      )}

      {loading && <p className="muted small">Loading drinks…</p>}
      {loadError && <p className="error small">{loadError}</p>}
      {!loading && !loadError && rows.length === 0 && <p className="muted small">No drinks logged for this day.</p>}

      {sorted.length > 0 && (
        <ul className="food-list">
          {sorted.map((d) => (
            <li key={d.id}>
              <button type="button" className={mode.kind === 'edit' && mode.item.id === d.id ? 'food-item editing' : 'food-item'}
                onClick={() => openEdit(d)} disabled={locked} aria-label={`Edit ${fluidLabel(d.drink_type)} at ${d.drink_time.slice(0, 5)}`}>
                <span className="food-main">
                  <span className="food-name">
                    {d.drink_time.slice(0, 5)} · {fluidLabel(d.drink_type)}
                    {d.description && <span className="muted"> ({d.description})</span>}
                    {d.drink_type === 'sugary_drink' && <span className="tag">Sugary</span>}
                  </span>
                  <span className="food-kcal">{formatNumber(d.ml)} ml</span>
                </span>
                {kcalAllowed(d.drink_type) && (
                  <span className="food-sub muted small">{d.kcal === null ? 'kcal ?' : `${formatNumber(d.kcal)} kcal`}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {actionError && mode.kind === 'closed' && <p className="error small" role="alert">{actionError}</p>}

      {mode.kind !== 'closed' && (
        <div className="subpanel">
          <h3>{mode.kind === 'edit' ? 'Edit drink' : 'Add drink'}</h3>
          <Field label="Time" error={errors.drink_time}>
            <input type="time" aria-label="Drink time" value={form.drink_time} disabled={busy}
              onChange={(e) => update('drink_time', e.target.value)} />
          </Field>
          <Field label="Type" error={errors.drink_type}>
            <div className="chip-grid wide" role="group" aria-label="Drink type">
              {FLUID_TYPES.map((t) => (
                <button key={t.value} type="button" disabled={busy}
                  className={form.drink_type === t.value ? 'chip selected' : 'chip'} aria-pressed={form.drink_type === t.value}
                  onClick={() => update('drink_type', t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          {form.drink_type === 'other' && (
            <Field label="Description" hint="optional, e.g. coconut water" error={errors.description}>
              <input type="text" aria-label="Drink description" maxLength={100} value={form.description} disabled={busy}
                onChange={(e) => update('description', e.target.value)} />
            </Field>
          )}
          <div className={showKcal ? 'two-col' : ''}>
            <Field label="Amount" hint="ml" error={errors.ml}>
              <input type="text" inputMode="numeric" aria-label="Amount in ml" autoComplete="off" value={form.ml} disabled={busy}
                onChange={(e) => update('ml', e.target.value)} />
            </Field>
            {showKcal && (
              <Field label="Calories" hint="optional" error={errors.kcal}>
                <input type="text" inputMode="decimal" aria-label="Drink calories" autoComplete="off" value={form.kcal} disabled={busy}
                  onChange={(e) => update('kcal', e.target.value)} />
              </Field>
            )}
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
              Delete this drink
            </button>
          )}
        </div>
      )}

      {undo && (
        <div className="toast" role="status">
          <span>Added {formatNumber(undo.ml)} ml</span>
          <button type="button" className="link toast-undo" onClick={undoLast}>Undo</button>
        </div>
      )}
    </section>
  )
}

export default FluidsSection
