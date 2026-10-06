import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EMPTY_FOOD_FORM, FOOD_UNITS, KCAL_CAP, MEALS, NUTRIENT_KEYS,
  foodFormFromRow, foodFormsEqual, foodTotals, formFromRecent, formGrams, formatGrams, formatNumber, formatQuantity,
  formatTotal, gramsPerUnitMemory, kcalLevel, memoryKey, needsGramsPerUnit, recentFoods, scaledNutrients, validateFoodForm,
  type FoodErrors, type FoodForm, type FoodRow, type Meal, type NutrientKey, type RecentFood,
} from './lib/food'
import { formatDateLabel, todayIST } from './lib/dates'
import { friendlyError } from './lib/errors'
import { Field } from './components/inputs'

type Props = {
  supabase: SupabaseClient
  dayId: string | null
  locked: boolean
  ensureDay: () => Promise<string>
  onDirtyChange: (dirty: boolean) => void
  drinkKcal: { known: number; unknownCount: number }
}

type Mode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; item: FoodRow }

function FoodSection({ supabase, dayId, locked, ensureDay, onDirtyChange, drinkKcal }: Props) {
  const [items, setItems] = useState<FoodRow[]>([])
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(Boolean(dayId))
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [form, setForm] = useState<FoodForm>(EMPTY_FOOD_FORM)
  const [errors, setErrors] = useState<FoodErrors>({})
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [scaleBase, setScaleBase] = useState<RecentFood | null>(null)
  const [scaleStopped, setScaleStopped] = useState(false)
  const [lastMeal, setLastMeal] = useState<Meal | ''>('')
  const [recentOpen, setRecentOpen] = useState(false)
  const [history, setHistory] = useState<RecentFood[] | null>(null)
  // Grams per unit filled in from memory (null = typed by hand or nothing filled).
  const [autoGpu, setAutoGpu] = useState<string | null>(null)
  const [recentError, setRecentError] = useState('')
  const [search, setSearch] = useState('')
  const requestId = useRef(0)

  const baseline = mode.kind === 'edit' ? foodFormFromRow(mode.item) : EMPTY_FOOD_FORM
  const dirty = mode.kind !== 'closed' && !foodFormsEqual(form, baseline)

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const fetchItems = useCallback(async (id: string) => {
    const req = ++requestId.current
    const { data, error } = await supabase.from('food_items').select('*').eq('day_id', id).order('created_at')
    if (req !== requestId.current) return
    setLoading(false)
    if (error) {
      setLoadError(friendlyError(error.message, error.code, true))
      return
    }
    setLoadError('')
    setItems((data ?? []) as FoodRow[])
  }, [supabase])

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => {
    if (dayId) fetchItems(dayId)
  }, [dayId, fetchItems])

  const totals = useMemo(() => foodTotals(items), [items])
  // The calorie bar counts food plus drinks with calories (maad water, sugary drinks, other).
  const kcal = Math.round((totals.kcal.known + drinkKcal.known) * 100) / 100
  const level = kcalLevel(kcal)

  function closeForm() {
    setMode({ kind: 'closed' })
    setForm(EMPTY_FOOD_FORM)
    setErrors({})
    setActionError('')
    setScaleBase(null)
    setScaleStopped(false)
  }

  function confirmDiscard(): boolean {
    return !dirty || window.confirm('Discard the food you are entering?')
  }

  function openAdd() {
    if (!confirmDiscard()) return
    closeForm()
    setRecentOpen(false)
    setForm({ ...EMPTY_FOOD_FORM, meal: lastMeal })
    setAutoGpu(null)
    setMode({ kind: 'add' })
    if (!history) loadHistory()
  }

  function openEdit(item: FoodRow) {
    if (locked || !confirmDiscard()) return
    closeForm()
    setRecentOpen(false)
    setForm(foodFormFromRow(item))
    setAutoGpu(null)
    setMode({ kind: 'edit', item })
    if (!history) loadHistory()
  }

  // Past entries: the Recent foods list and the remembered grams per unit.
  async function loadHistory(): Promise<RecentFood[] | null> {
    setRecentError('')
    const { data, error } = await supabase
      .from('food_items')
      .select('food, weight_g, amount, unit, grams_per_unit, weight_state, kcal, protein_g, carbs_g, fat_g, fibre_total_g, fibre_soluble_g, fibre_insoluble_g, meal, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error) {
      setRecentError(friendlyError(error.message, error.code))
      return null
    }
    const rows = (data ?? []) as RecentFood[]
    setHistory(rows)
    return rows
  }

  async function openRecent() {
    if (!confirmDiscard()) return
    closeForm()
    setRecentOpen(true)
    setSearch('')
    await loadHistory()
  }

  const recent = useMemo(() => (history ? recentFoods(history) : null), [history])
  const memory = useMemo(() => gramsPerUnitMemory(history ?? []), [history])

  // Fill grams per unit from the owner's last entry of the same food, raw/cooked and unit.
  // Only replaces a blank or an earlier auto-filled value, never one typed by hand.
  function withRemembered(f: FoodForm, auto: string | null, mem = memory): { form: FoodForm; auto: string | null } {
    if (!needsGramsPerUnit(f.unit) || !f.food.trim() || !f.weight_state) return { form: f, auto }
    if (f.grams_per_unit !== '' && f.grams_per_unit !== auto) return { form: f, auto }
    const known = mem.get(memoryKey(f.food, f.weight_state, f.unit))
    const value = known === undefined ? '' : String(known)
    return { form: { ...f, grams_per_unit: value }, auto: value === '' ? null : value }
  }

  function pickRecent(base: RecentFood) {
    setRecentOpen(false)
    const f = formFromRecent(base, lastMeal)
    setForm(f)
    setAutoGpu(f.grams_per_unit || null)
    setScaleBase(base)
    setScaleStopped(false)
    setErrors({})
    setActionError('')
    setMode({ kind: 'add' })
  }

  function update<K extends keyof FoodForm>(key: K, value: FoodForm[K]) {
    setActionError('')
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
    if (key === 'meal' && value) setLastMeal(value as Meal)

    let next: FoodForm = { ...form, [key]: value }
    let auto = autoGpu
    if (key === 'grams_per_unit') auto = null // typed by hand: never overwritten
    if (key === 'unit' || key === 'food' || key === 'weight_state') ({ form: next, auto } = withRemembered(next, auto))
    if (key === 'unit' && !needsGramsPerUnit(next.unit)) { next = { ...next, grams_per_unit: '' }; auto = null }
    setAutoGpu(auto)

    if (scaleBase && (key === 'amount' || key === 'unit' || key === 'grams_per_unit')) {
      // Rescale every nutrient from the original entry (never from already-rounded values).
      const grams = formGrams(next)
      const scaled = grams === null ? null : scaledNutrients(scaleBase, String(grams))
      setForm({ ...next, ...(scaled ?? {}) })
      return
    }
    if (scaleBase && (NUTRIENT_KEYS.includes(key as NutrientKey) || key === 'weight_state' || key === 'food')) {
      setScaleBase(null) // a manual change stops automatic scaling
      setScaleStopped(true)
    }
    setForm(next)
  }

  // Remembered grams per unit arrive after the form opened: fill them in if still blank.
  useEffect(() => {
    if (mode.kind === 'closed' || !history) return
    const { form: filled, auto } = withRemembered(form, autoGpu, memory)
    if (filled !== form) { setForm(filled); setAutoGpu(auto) }
    // Runs only when the history arrives, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memory])

  async function submit() {
    const { errors: found, payload } = validateFoodForm(form)
    setErrors(found)
    if (!payload) {
      setActionError('Please fix the highlighted fields.')
      return
    }
    setBusy(true)
    setActionError('')
    try {
      if (mode.kind === 'edit') {
        const { error } = await supabase.from('food_items').update(payload).eq('id', mode.item.id)
        if (error) throw error
        await fetchItems(mode.item.day_id)
      } else {
        const id = await ensureDay()
        const { error } = await supabase.from('food_items').insert({ ...payload, day_id: id })
        if (error) throw error
        await fetchItems(id)
      }
      setLastMeal(payload.meal)
      setHistory(null) // reload past entries next time, so this entry's grams per unit is remembered
      closeForm()
    } catch (e) {
      const err = e as { message?: string; code?: string }
      setActionError(friendlyError(err.message ?? String(e), err.code))
    } finally {
      setBusy(false)
    }
  }

  async function remove(item: FoodRow) {
    if (!window.confirm(`Delete ${item.food} (${formatQuantity(item)})?`)) return
    setBusy(true)
    const { error } = await supabase.from('food_items').delete().eq('id', item.id)
    setBusy(false)
    if (error) {
      setActionError(friendlyError(error.message, error.code))
      return
    }
    setHistory(null)
    closeForm()
    await fetchItems(item.day_id)
  }

  const filteredRecent = (recent ?? []).filter((r) => r.food.toLowerCase().includes(search.trim().toLowerCase()))

  const grouped = MEALS.map((m) => ({ ...m, items: items.filter((i) => i.meal === m.value) })).filter((g) => g.items.length > 0)

  const numberInput = (key: keyof FoodForm, label: string, unit: string) => (
    <Field label={label} hint={unit} error={errors[key]}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        value={form[key] as string}
        disabled={busy}
        onChange={(e) => update(key, e.target.value as FoodForm[typeof key])}
      />
    </Field>
  )

  return (
    <section className="card">
      <h2>Food</h2>

      <div className="kcal">
        <div className="kcal-numbers">
          <strong>{drinkKcal.unknownCount > 0 ? 'at least ' : ''}{formatNumber(kcal)}</strong> / {formatNumber(KCAL_CAP)} kcal
          <span className={`kcal-note ${level}`}>
            {kcal > KCAL_CAP
              ? `${formatNumber(kcal - KCAL_CAP)} over the cap`
              : `${formatNumber(KCAL_CAP - kcal)} left`}
          </span>
        </div>
        <div className="kcal-track" role="progressbar" aria-label="Calories against 2,000 kcal cap"
          aria-valuemin={0} aria-valuemax={KCAL_CAP} aria-valuenow={kcal}>
          <div className={`kcal-fill ${level}`} style={{ width: `${Math.min(100, (kcal / KCAL_CAP) * 100)}%` }} />
        </div>
        {(drinkKcal.known > 0 || drinkKcal.unknownCount > 0) && (
          <p className="muted small kcal-drinks">
            incl. {formatNumber(drinkKcal.known)} kcal from drinks
            {drinkKcal.unknownCount > 0 && ` (+ ${drinkKcal.unknownCount} drink${drinkKcal.unknownCount === 1 ? '' : 's'} with unknown kcal)`}
          </p>
        )}
        {level === 'red' && <p className="kcal-warning small">Over the 2,000 kcal cap. Warning only, no penalty.</p>}
      </div>

      {items.length > 0 && (
        <dl className="totals small">
          <div><dt>Protein</dt><dd>{formatTotal(totals.protein_g, ' g')}</dd></div>
          <div><dt>Carbs</dt><dd>{formatTotal(totals.carbs_g, ' g')}</dd></div>
          <div><dt>Fat</dt><dd>{formatTotal(totals.fat_g, ' g')}</dd></div>
          <div><dt>Fibre</dt><dd>{formatTotal(totals.fibre_total_g, ' g')}</dd></div>
          <div><dt>Soluble</dt><dd>{formatTotal(totals.fibre_soluble_g, ' g')}</dd></div>
          <div><dt>Insoluble</dt><dd>{formatTotal(totals.fibre_insoluble_g, ' g')}</dd></div>
          <div><dt>Hunger add-ons</dt><dd>{formatNumber(totals.hungerAddonKcal)} kcal</dd></div>
        </dl>
      )}

      {loading && <p className="muted small">Loading food…</p>}
      {loadError && <p className="error small">{loadError}</p>}
      {!loading && !loadError && items.length === 0 && <p className="muted small">No food logged for this day.</p>}

      {grouped.map((group) => (
        <div key={group.value} className="meal-group">
          <h3>{group.label}</h3>
          <ul className="food-list">
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={mode.kind === 'edit' && mode.item.id === item.id ? 'food-item editing' : 'food-item'}
                  onClick={() => openEdit(item)}
                  disabled={locked}
                  aria-label={`Edit ${item.food}`}
                >
                  <span className="food-main">
                    <span className="food-name">
                      {item.food}
                      {item.is_hunger_addon && <span className="tag">Hunger add-on</span>}
                    </span>
                    <span className="food-kcal">{formatNumber(item.kcal)} kcal</span>
                  </span>
                  <span className="food-sub muted small">
                    {formatQuantity(item)} {item.weight_state}
                    {' · '}P {item.protein_g === null ? '?' : formatNumber(item.protein_g)}
                    {' · '}C {item.carbs_g === null ? '?' : formatNumber(item.carbs_g)}
                    {' · '}F {item.fat_g === null ? '?' : formatNumber(item.fat_g)}
                    {' · '}Fibre {item.fibre_total_g === null ? '?' : formatNumber(item.fibre_total_g)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {!locked && mode.kind === 'closed' && !recentOpen && (
        <div className="button-row">
          <button type="button" onClick={openAdd}>+ Add food</button>
          <button type="button" className="secondary" onClick={openRecent}>Recent foods</button>
        </div>
      )}
      {!locked && <p className="muted small">Food saves as soon as you tap Add or Update. "?" means unknown.</p>}

      {recentOpen && (
        <div className="subpanel">
          <div className="subpanel-head">
            <h3>Recent foods</h3>
            <button type="button" className="link" onClick={() => setRecentOpen(false)}>Close</button>
          </div>
          <input
            type="search"
            placeholder="Search your foods"
            aria-label="Search your foods"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {recentError && <p className="error small">{recentError}</p>}
          {recent === null && !recentError && <p className="muted small">Loading…</p>}
          {recent !== null && filteredRecent.length === 0 && (
            <p className="muted small">{recent.length === 0 ? 'No foods logged yet. Add one with "+ Add food" first.' : 'No match.'}</p>
          )}
          <ul className="recent-list">
            {filteredRecent.slice(0, 50).map((r) => (
              <li key={`${r.food}|${r.weight_state}`}>
                <button type="button" className="recent-item" onClick={() => pickRecent(r)}>
                  <span>{r.food} <span className="muted">· {r.weight_state}</span></span>
                  <span className="muted small">{formatQuantity(r)} · {formatNumber(r.kcal)} kcal</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode.kind !== 'closed' && (
        <div className="subpanel">
          <div className="subpanel-head">
            <h3>{mode.kind === 'edit' ? 'Edit food' : 'Add food'}</h3>
          </div>

          {scaleBase && (
            <p className="note small">
              Scaling from your last entry: <strong>{scaleBase.food}</strong>, {formatQuantity(scaleBase)} {scaleBase.weight_state},{' '}
              {formatNumber(scaleBase.kcal)} kcal ({formatDateLabel(todayIST(new Date(scaleBase.created_at)))}). Change the amount and every value rescales.
            </p>
          )}
          {scaleStopped && !scaleBase && (
            <p className="note small">Automatic scaling stopped because you changed a value by hand.</p>
          )}

          <Field label="Meal" error={errors.meal}>
            <div className="chip-grid" role="group" aria-label="Meal">
              {MEALS.map((m) => (
                <button key={m.value} type="button" disabled={busy}
                  className={form.meal === m.value ? 'chip selected' : 'chip'} aria-pressed={form.meal === m.value}
                  onClick={() => update('meal', m.value)}>
                  {m.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Food" error={errors.food}>
            <input type="text" aria-label="Food" autoComplete="off" value={form.food} disabled={busy}
              onChange={(e) => update('food', e.target.value)} />
          </Field>

          <Field label="Unit">
            <div className="chip-grid units" role="group" aria-label="Unit">
              {FOOD_UNITS.map((u) => (
                <button key={u} type="button" disabled={busy}
                  className={form.unit === u ? 'chip selected' : 'chip'} aria-pressed={form.unit === u}
                  onClick={() => update('unit', u)}>
                  {u}
                </button>
              ))}
            </div>
          </Field>
          <div className="two-col">
            {numberInput('amount', 'Amount', form.unit)}
            {needsGramsPerUnit(form.unit) && numberInput('grams_per_unit', `Grams per ${form.unit}`, 'g')}
          </div>
          {needsGramsPerUnit(form.unit) && autoGpu !== null && form.grams_per_unit === autoGpu && (
            <p className="muted small">Grams per {form.unit}: your saved value for this food. Change it if needed.</p>
          )}
          {needsGramsPerUnit(form.unit) && autoGpu === null && form.grams_per_unit === '' && (
            <p className="muted small">Enter how many grams one {form.unit} weighs. It is remembered for this food.</p>
          )}
          {(() => {
            const g = formGrams(form)
            return g !== null && form.unit !== 'g' ? <p className="small grams-preview">= {formatGrams(g)}</p> : null
          })()}
          <div>
            <Field label="State" error={errors.weight_state}>
              <div className="segmented two" role="group" aria-label="Raw or cooked">
                {(['raw', 'cooked'] as const).map((s) => (
                  <button key={s} type="button" disabled={busy}
                    className={form.weight_state === s ? 'chip selected' : 'chip'} aria-pressed={form.weight_state === s}
                    onClick={() => update('weight_state', s)}>
                    {s === 'raw' ? 'Raw' : 'Cooked'}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {numberInput('kcal', 'Calories', 'kcal')}
          <div className="three-col">
            {numberInput('protein_g', 'Protein', 'g')}
            {numberInput('carbs_g', 'Carbs', 'g')}
            {numberInput('fat_g', 'Fat', 'g')}
          </div>
          <div className="three-col">
            {numberInput('fibre_total_g', 'Fibre', 'g')}
            {numberInput('fibre_soluble_g', 'Soluble', 'g')}
            {numberInput('fibre_insoluble_g', 'Insoluble', 'g')}
          </div>
          <p className="muted small">Leave a value blank if you don't know it. It is never estimated.</p>

          <Field label="Hunger add-on">
            <div className="segmented two" role="group" aria-label="Hunger add-on">
              {[true, false].map((v) => (
                <button key={String(v)} type="button" disabled={busy}
                  className={form.is_hunger_addon === v ? 'chip selected' : 'chip'} aria-pressed={form.is_hunger_addon === v}
                  onClick={() => update('is_hunger_addon', v)}>
                  {v ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </Field>

          {actionError && <p className="error small" role="alert">{actionError}</p>}

          <div className="button-row">
            <button type="button" onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : mode.kind === 'edit' ? 'Update' : 'Add'}
            </button>
            <button type="button" className="secondary" disabled={busy}
              onClick={() => { if (confirmDiscard()) closeForm() }}>
              Cancel
            </button>
          </div>
          {mode.kind === 'edit' && (
            <button type="button" className="danger" disabled={busy} onClick={() => remove(mode.item)}>
              Delete this food
            </button>
          )}
        </div>
      )}

      {locked && items.length > 0 && <p className="muted small">This day is locked. Food can no longer be changed.</p>}
    </section>
  )
}

export default FoodSection
