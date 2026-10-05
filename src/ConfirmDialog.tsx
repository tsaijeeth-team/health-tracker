import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DayRow } from './lib/dayForm'
import { blankDayFields } from './lib/confirm'
import { formatDateLabel } from './lib/dates'
import { friendlyError } from './lib/errors'
import { KCAL_CAP, foodTotals, formatNumber, formatTotal, type FoodRow } from './lib/food'
import { FLUID_TARGET_ML, fluidTotals, type FluidRow } from './lib/fluids'
import { cardioLabel, totalMinutes, type CardioRow } from './lib/cardio'
import { formatMinutes } from './lib/sleep'

type Props = {
  supabase: SupabaseClient
  date: string
  isToday: boolean
  row: DayRow | null
  ensureDay: () => Promise<string>
  onCancel: () => void
  onConfirmed: () => void
}

type Items = { food: FoodRow[]; fluids: FluidRow[]; cardio: CardioRow[] }

const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'Yes' : 'No')
const val = (v: number | string | null, unit = '') => (v === null ? '—' : `${typeof v === 'number' ? formatNumber(v) : v}${unit}`)

function ConfirmDialog({ supabase, date, isToday, row, ensureDay, onCancel, onConfirmed }: Props) {
  const [items, setItems] = useState<Items | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!row) {
        setItems({ food: [], fluids: [], cardio: [] })
        return
      }
      const [food, fluids, cardio] = await Promise.all([
        supabase.from('food_items').select('*').eq('day_id', row.id),
        supabase.from('fluids').select('*').eq('day_id', row.id),
        supabase.from('cardio_sessions').select('*').eq('day_id', row.id).order('start_time'),
      ])
      if (cancelled) return
      const err = food.error ?? fluids.error ?? cardio.error
      if (err) {
        setLoadError(friendlyError(err.message, err.code))
        return
      }
      setItems({ food: food.data as FoodRow[], fluids: fluids.data as FluidRow[], cardio: cardio.data as CardioRow[] })
    }
    load()
    return () => { cancelled = true }
  }, [supabase, row])

  // Close with the Escape key, like any dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const id = await ensureDay()
      // The database replaces this time with its own clock; the phone's clock is never trusted.
      const { error: err } = await supabase.from('days').update({ confirmed_at: new Date().toISOString() }).eq('id', id)
      if (err) throw err
      onConfirmed()
    } catch (e) {
      const err = e as { message?: string; code?: string }
      setError(friendlyError(err.message ?? String(e), err.code))
      setBusy(false)
    }
  }

  const blanks = blankDayFields(row)
  const food = items ? foodTotals(items.food) : null
  const fluids = items ? fluidTotals(items.fluids) : null
  const kcal = food && fluids ? Math.round((food.kcal.known + fluids.kcalKnown) * 100) / 100 : 0
  const kcalUnknown = fluids?.kcalUnknownCount ?? 0
  const sleepText = row?.bedtime && row.wake_time
    ? `${row.bedtime.slice(0, 5)} → ${row.wake_time.slice(0, 5)}${row.sleep_minutes ? ` (${formatMinutes(row.sleep_minutes)})` : ''}`
    : '—'

  return (
    <div className="overlay" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="dialog-body">
        <h2 id="confirm-title">Confirm {formatDateLabel(date)}?</h2>
        <p className="dialog-warning">
          After confirming, this day is <strong>locked forever</strong>. Values can never be changed. You can only add notes.
        </p>
        {isToday && (
          <p className="dialog-warning">
            It is still today. Anything you eat or drink later tonight <strong>cannot be added</strong> after confirming.
          </p>
        )}

        {loadError && <p className="error">{loadError}</p>}
        {!items && !loadError && <p className="muted">Loading the day…</p>}

        {items && food && fluids && (
          <div className="summary">
            <h3>Body</h3>
            <dl>
              <div><dt>Morning weight</dt><dd>{val(row?.weight_kg ?? null, ' kg')}</dd></div>
            </dl>

            <h3>Food &amp; calories</h3>
            <dl>
              <div><dt>Calories</dt><dd>{kcalUnknown > 0 ? 'at least ' : ''}{formatNumber(kcal)} / {formatNumber(KCAL_CAP)} kcal{kcal > KCAL_CAP ? ' (over the cap)' : ''}</dd></div>
              <div><dt>Food items</dt><dd>{items.food.length === 0 ? 'none logged' : items.food.length}</dd></div>
              {items.food.length > 0 && (
                <>
                  <div><dt>Protein</dt><dd>{formatTotal(food.protein_g, ' g')}</dd></div>
                  <div><dt>Carbs</dt><dd>{formatTotal(food.carbs_g, ' g')}</dd></div>
                  <div><dt>Fat</dt><dd>{formatTotal(food.fat_g, ' g')}</dd></div>
                  <div><dt>Fibre</dt><dd>{formatTotal(food.fibre_total_g, ' g')}</dd></div>
                  <div><dt>Hunger add-ons</dt><dd>{formatNumber(food.hungerAddonKcal)} kcal</dd></div>
                </>
              )}
              <div><dt>From drinks</dt><dd>{formatNumber(fluids.kcalKnown)} kcal{kcalUnknown > 0 ? ` (+ ${kcalUnknown} unknown)` : ''}</dd></div>
            </dl>

            <h3>Fluids</h3>
            <dl>
              <div><dt>Total</dt><dd>{formatNumber(fluids.totalMl)} / {formatNumber(FLUID_TARGET_ML)} ml</dd></div>
              <div><dt>Sugary drinks</dt><dd>{formatNumber(fluids.sugaryMl)} ml</dd></div>
              <div><dt>Drinks logged</dt><dd>{items.fluids.length === 0 ? 'none' : items.fluids.length}</dd></div>
            </dl>

            <h3>Sleep</h3>
            <dl>
              <div><dt>Bed → wake</dt><dd>{sleepText}</dd></div>
              <div><dt>Quality</dt><dd>{val(row?.sleep_quality ?? null, ' / 5')}</dd></div>
              <div><dt>Snoring</dt><dd>{yesNo(row?.snoring ?? null)}</dd></div>
              <div><dt>Gasping</dt><dd>{yesNo(row?.gasping ?? null)}</dd></div>
              <div><dt>Afternoon sleepiness</dt><dd>{yesNo(row?.afternoon_sleepiness ?? null)}</dd></div>
              <div><dt>Nap</dt><dd>{val(row?.nap_minutes ?? null, ' min')}</dd></div>
            </dl>

            <h3>Workout</h3>
            <dl>
              <div><dt>Steps</dt><dd>{val(row?.steps ?? null)}</dd></div>
              <div>
                <dt>Cardio</dt>
                <dd>
                  {items.cardio.length === 0
                    ? 'none logged'
                    : `${formatMinutes(totalMinutes(items.cardio))}: ${items.cardio.map((c) => `${cardioLabel(c.cardio_type)} ${c.minutes} min`).join(', ')}`}
                </dd>
              </div>
            </dl>

            <h3>Stress &amp; habits</h3>
            <dl>
              <div><dt>Stress</dt><dd>{val(row?.stress ?? null, ' / 10')}</dd></div>
              <div><dt>Energy</dt><dd>{val(row?.energy ?? null, ' / 10')}</dd></div>
              <div><dt>Resting pulse</dt><dd>{val(row?.resting_pulse ?? null, ' bpm')}</dd></div>
              <div><dt>Gaming</dt><dd>{val(row?.gaming_hours ?? null, ' h')}</dd></div>
              <div><dt>Porn</dt><dd>{yesNo(row?.porn ?? null)}</dd></div>
              <div><dt>Naam Jaap</dt><dd>{yesNo(row?.naam_jaap ?? null)}</dd></div>
              <div><dt>Junk meals</dt><dd>{val(row?.junk_meals ?? null)}</dd></div>
            </dl>

            <div className={blanks.length > 0 ? 'blanks has-blanks' : 'blanks'}>
              <h3>Not answered ({blanks.length})</h3>
              {blanks.length === 0
                ? <p className="small">Every once-a-day field has an answer.</p>
                : <p className="small">{blanks.join(', ')}. These will stay blank forever.</p>}
            </div>
          </div>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        </div>

        <div className="dialog-buttons">
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Go back</button>
          <button type="button" className="lock-button" onClick={confirm} disabled={busy || !items}>
            {busy ? 'Locking…' : 'Confirm & lock forever'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
