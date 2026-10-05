import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, formatDateLabel, isValidDate, todayIST } from './lib/dates'
import {
  EMPTY_FORM, formFromRow, formsEqual, validateDayForm,
  type DayForm, type DayRow, type FieldErrors, type TriState,
} from './lib/dayForm'
import { formatMinutes, sleepDuration } from './lib/sleep'
import { friendlyError } from './lib/errors'
import { Field, ScaleButtons, TextInput, TriStateButtons } from './components/inputs'
import FoodSection from './FoodSection'
import FluidsSection, { type DrinkKcal } from './FluidsSection'
import CardioSection from './CardioSection'
import GymCard from './GymCard'
import NotesSection from './NotesSection'
import ConfirmDialog from './ConfirmDialog'
import { deadlineText, formatDateTimeIST, unconfirmedDays } from './lib/confirm'

const UNSAVED_WARNING = 'You have unsaved changes. Leave without saving them?'

function DayScreen({ supabase, email, onOpenShare, onOpenProgress, onOpenPoints }: { supabase: SupabaseClient; email: string; onOpenShare: () => void; onOpenProgress: () => void; onOpenPoints: () => void }) {
  const [date, setDate] = useState(() => todayIST())
  const [savedRow, setSavedRow] = useState<DayRow | null>(null)
  const [savedForm, setSavedForm] = useState<DayForm>(EMPTY_FORM)
  const [form, setForm] = useState<DayForm>(EMPTY_FORM)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const [foodDirty, setFoodDirty] = useState(false)
  const [fluidsDirty, setFluidsDirty] = useState(false)
  const [cardioDirty, setCardioDirty] = useState(false)
  const [gymDirty, setGymDirty] = useState(false)
  const [drinkKcal, setDrinkKcal] = useState<DrinkKcal>({ known: 0, unknownCount: 0 })
  const [notesDirty, setNotesDirty] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [allDays, setAllDays] = useState<{ log_date: string; confirmed_at: string | null }[]>([])
  const [showAllPending, setShowAllPending] = useState(false)
  const requestId = useRef(0)

  const dirty = !formsEqual(form, savedForm)
  const anyDirty = dirty || foodDirty || fluidsDirty || cardioDirty || gymDirty || notesDirty
  const locked = Boolean(savedRow?.confirmed_at)
  const today = todayIST()
  const pending = unconfirmedDays(allDays, today)

  // Shows the loading state and clears messages. Called from taps, not from effects.
  function resetForLoad() {
    setLoadState('loading')
    setLoadError('')
    setErrors({})
    setSaveError('')
    setJustSaved(false)
  }

  const fetchDay = useCallback(async (day: string) => {
    const id = ++requestId.current
    const { data, error } = await supabase.from('days').select('*').eq('log_date', day).maybeSingle()
    if (id !== requestId.current) return // a newer day was opened meanwhile
    if (error) {
      setLoadError(friendlyError(error.message, error.code, true))
      setLoadState('error')
      return
    }
    const row = (data as DayRow | null) ?? null
    const loaded = formFromRow(row)
    setSavedRow(row)
    setSavedForm(loaded)
    setForm(loaded)
    setLoadState('ready')
  }, [supabase])

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => {
    fetchDay(date)
  }, [date, fetchDay])

  // Every day's date and lock state, for the "earlier days not confirmed" notice.
  // Re-read whenever this day's row appears or gets confirmed.
  const savedRowId = savedRow?.id
  const savedRowConfirmed = savedRow?.confirmed_at
  useEffect(() => {
    let cancelled = false
    supabase.from('days').select('log_date, confirmed_at').then(({ data }) => {
      if (!cancelled && data) setAllDays(data)
    })
    return () => { cancelled = true }
  }, [supabase, savedRowId, savedRowConfirmed])

  // Warn before closing or reloading the page with unsaved changes.
  useEffect(() => {
    if (!anyDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [anyDirty])

  function goTo(newDate: string) {
    if (newDate === date || !isValidDate(newDate)) return
    if (anyDirty && !window.confirm(UNSAVED_WARNING)) return
    setFoodDirty(false)
    setFluidsDirty(false)
    setCardioDirty(false)
    setGymDirty(false)
    setDrinkKcal({ known: 0, unknownCount: 0 })
    setNotesDirty(false)
    setConfirmOpen(false)
    resetForLoad()
    setDate(newDate)
  }

  function logOut() {
    if (anyDirty && !window.confirm(UNSAVED_WARNING)) return
    supabase.auth.signOut()
  }

  function openShare() {
    if (anyDirty && !window.confirm(UNSAVED_WARNING)) return
    onOpenShare()
  }

  function openPoints() {
    if (anyDirty && !window.confirm(UNSAVED_WARNING)) return
    onOpenPoints()
  }

  function openProgress() {
    if (anyDirty && !window.confirm(UNSAVED_WARNING)) return
    onOpenProgress()
  }

  // Food needs a saved day to attach to. Creates an empty day row if there isn't one yet,
  // without touching unsaved entries in the day form.
  async function ensureDay(): Promise<string> {
    if (savedRow) return savedRow.id
    const inserted = await supabase.from('days').insert({ log_date: date }).select().single()
    if (!inserted.error) {
      setSavedRow(inserted.data as DayRow)
      return (inserted.data as DayRow).id
    }
    if (inserted.error.code === '23505') {
      // Created meanwhile in another tab or device: use that one.
      const existing = await supabase.from('days').select('*').eq('log_date', date).single()
      if (!existing.error) {
        setSavedRow(existing.data as DayRow)
        return (existing.data as DayRow).id
      }
    }
    throw inserted.error
  }

  function update<K extends keyof DayForm>(key: K, value: DayForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setJustSaved(false)
    setSaveError('')
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }))
  }

  async function save() {
    const { errors: found, payload } = validateDayForm(form)
    setErrors(found)
    if (!payload) {
      setSaveError('Please fix the highlighted fields.')
      return
    }
    setSaving(true)
    setSaveError('')
    const result = savedRow
      ? await supabase.from('days').update(payload).eq('id', savedRow.id).select().single()
      : await supabase.from('days').insert({ log_date: date, ...payload }).select().single()
    setSaving(false)
    if (result.error) {
      setSaveError(friendlyError(result.error.message, result.error.code))
      return
    }
    const row = result.data as DayRow
    const saved = formFromRow(row)
    setSavedRow(row)
    setSavedForm(saved)
    setForm(saved)
    setJustSaved(true)
  }

  const sleep = sleepDuration(form.bedtime, form.wake_time)
  const disabled = locked || saving || loadState !== 'ready'

  const numberField = (
    key: keyof DayForm, label: string, hint: string, inputMode: 'decimal' | 'numeric', placeholder?: string,
  ) => (
    <Field label={label} hint={hint} error={errors[key]}>
      <TextInput
        value={form[key]}
        onChange={(v) => update(key, v)}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        ariaLabel={label}
      />
    </Field>
  )

  const triField = (key: 'snoring' | 'gasping' | 'afternoon_sleepiness' | 'porn' | 'naam_jaap', label: string) => (
    <Field label={label} error={errors[key]}>
      <TriStateButtons value={form[key]} onChange={(v: TriState) => update(key, v)} disabled={disabled} ariaLabel={label} />
    </Field>
  )

  const timeField = (key: 'bedtime' | 'wake_time', label: string) => (
    <Field label={label} error={errors[key]}>
      <div className="time-row">
        <input
          type="time"
          value={form[key]}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => update(key, e.target.value)}
        />
        {form[key] && !disabled && (
          <button type="button" className="link" onClick={() => update(key, '')}>
            Clear
          </button>
        )}
      </div>
    </Field>
  )

  return (
    <div className="app">
      <header className="topbar">
        <strong>Health Tracker</strong>
        <div className="topbar-right">
          <span className="muted small email">{email}</span>
          <button type="button" className="secondary small-button" onClick={openPoints} aria-label="Points & rank">
            🏆<span className="hide-narrow"> Points</span>
          </button>
          <button type="button" className="secondary small-button" onClick={openShare} aria-label="Share & backup">
            Share<span className="hide-narrow"> &amp; backup</span>
          </button>
          <button type="button" className="secondary small-button" onClick={logOut}>
            Log out
          </button>
        </div>
      </header>

      <nav className="datebar" aria-label="Choose day">
        <button type="button" className="secondary icon-button" aria-label="Previous day" onClick={() => goTo(addDays(date, -1))}>
          ◀
        </button>
        <label className="date-picker">
          <span className="date-label">
            {formatDateLabel(date)}
            {date === today && <span className="badge">Today</span>}
          </span>
          <input type="date" value={date} aria-label="Pick a date" onChange={(e) => goTo(e.target.value)} />
        </label>
        <button type="button" className="secondary icon-button" aria-label="Next day" onClick={() => goTo(addDays(date, 1))}>
          ▶
        </button>
      </nav>
      <div className="day-status">
        {loadState === 'ready' && (
          locked
            ? <span className="status-locked">🔒 Confirmed {formatDateTimeIST(savedRow!.confirmed_at!)}</span>
            : <span className="status-open">Not confirmed</span>
        )}
        {date !== today && (
          <button type="button" className="link" onClick={() => goTo(today)}>
            Go to today
          </button>
        )}
      </div>

      <main className="content">
        {pending.length > 0 && (
          <section className={pending.some((p) => p.daysLeft < 0) ? 'card pending overdue' : 'card pending'} aria-label="Earlier days not confirmed">
            <h2>{pending.length} earlier day{pending.length === 1 ? '' : 's'} not confirmed</h2>
            <ul className="pending-list">
              {(showAllPending ? pending : pending.slice(0, 5)).map((p) => (
                <li key={p.date}>
                  <button type="button" className="link" onClick={() => goTo(p.date)} disabled={p.date === date}>
                    {formatDateLabel(p.date)}
                  </button>
                  <span className="pending-meta">
                    <span className={p.daysLeft < 0 ? 'deadline late' : p.daysLeft <= 1 ? 'deadline soon' : 'deadline'}>
                      {deadlineText(p)}
                    </span>
                    {!p.hasEntries && <span className="muted small"> · nothing logged</span>}
                  </span>
                </li>
              ))}
            </ul>
            {pending.length > 5 && (
              <button type="button" className="link" onClick={() => setShowAllPending((v) => !v)}>
                {showAllPending ? 'Show fewer' : `Show all ${pending.length}`}
              </button>
            )}
          </section>
        )}
        {loadState === 'loading' && <p className="muted center">Loading…</p>}
        {loadState === 'error' && (
          <div className="card">
            <p className="error">{loadError}</p>
            <button type="button" onClick={() => { resetForLoad(); fetchDay(date) }}>Try again</button>
          </div>
        )}
        {loadState === 'ready' && (
          <>
            {locked && (
              <p className="banner">🔒 This day is confirmed and locked. Values can no longer be changed. You can still add notes.</p>
            )}

            <section className="card">
              <h2>Body</h2>
              {numberField('weight_kg', 'Morning weight', 'kg, 1 decimal', 'decimal', 'e.g. 82.4')}
            </section>

            <FoodSection
              key={date}
              supabase={supabase}
              dayId={savedRow?.id ?? null}
              locked={locked}
              ensureDay={ensureDay}
              onDirtyChange={setFoodDirty}
              drinkKcal={drinkKcal}
            />

            <FluidsSection
              key={`fluids-${date}`}
              supabase={supabase}
              dayId={savedRow?.id ?? null}
              locked={locked}
              ensureDay={ensureDay}
              onDirtyChange={setFluidsDirty}
              onKcalChange={setDrinkKcal}
            />

            <section className="card">
              <h2>Sleep</h2>
              <p className="muted small">Last night's sleep, logged on the day you woke up.</p>
              {timeField('bedtime', 'Bedtime')}
              {timeField('wake_time', 'Wake time')}
              <p className="sleep-duration" aria-live="polite">
                {sleep.kind === 'ok' && <>Sleep: <strong>{formatMinutes(sleep.minutes)}</strong></>}
                {sleep.kind === 'same' && <span className="error">Bedtime and wake time cannot be the same.</span>}
                {sleep.kind === 'missing' && <span className="muted">Enter both times to see sleep duration.</span>}
              </p>
              <Field label="Sleep quality" hint="1 = worst, 5 = best" error={errors.sleep_quality}>
                <ScaleButtons value={form.sleep_quality} max={5} onChange={(v) => update('sleep_quality', v)} disabled={disabled} ariaLabel="Sleep quality" />
              </Field>
              {triField('snoring', 'Snoring')}
              {triField('gasping', 'Gasping')}
              {triField('afternoon_sleepiness', 'Afternoon sleepiness')}
              {numberField('nap_minutes', 'Nap', 'minutes', 'numeric')}
            </section>

            <section className="card">
              <h2>Workout</h2>
              {numberField('steps', 'Steps', '', 'numeric')}
              <GymCard
                key={`gym-${date}`}
                supabase={supabase}
                dayId={savedRow?.id ?? null}
                locked={locked}
                ensureDay={ensureDay}
                onDirtyChange={setGymDirty}
                onOpenProgress={openProgress}
              />
            </section>

            <CardioSection
              key={`cardio-${date}`}
              supabase={supabase}
              dayId={savedRow?.id ?? null}
              locked={locked}
              ensureDay={ensureDay}
              onDirtyChange={setCardioDirty}
            />

            <section className="card">
              <h2>Stress &amp; habits</h2>
              <Field label="Stress" hint="1 = calm, 10 = very stressed" error={errors.stress}>
                <ScaleButtons value={form.stress} max={10} onChange={(v) => update('stress', v)} disabled={disabled} ariaLabel="Stress" />
              </Field>
              <Field label="Energy" hint="1 = exhausted, 10 = full of energy" error={errors.energy}>
                <ScaleButtons value={form.energy} max={10} onChange={(v) => update('energy', v)} disabled={disabled} ariaLabel="Energy" />
              </Field>
              {numberField('resting_pulse', 'Resting pulse', 'beats per minute', 'numeric')}
              {numberField('gaming_hours', 'Gaming', 'hours, e.g. 1.5', 'decimal')}
              {triField('porn', 'Porn')}
              {triField('naam_jaap', 'Naam Jaap')}
              {numberField('junk_meals', 'Junk meals', 'blank = not answered', 'numeric')}
            </section>
            <p className="muted small center">Tap a selected number again to clear it.</p>

            <NotesSection
              key={`notes-${date}`}
              supabase={supabase}
              dayId={savedRow?.id ?? null}
              ensureDay={ensureDay}
              onDirtyChange={setNotesDirty}
            />

            {!locked && date <= today && (
              <section className="card confirm-card">
                <h2>Confirm this day</h2>
                <p className="small">When everything is logged, confirm the day. It then locks forever (notes can still be added).</p>
                {anyDirty && <p className="warning small">Save or cancel your changes first.</p>}
                <button type="button" className="lock-button" disabled={anyDirty} onClick={() => setConfirmOpen(true)}>
                  🔒 Confirm day…
                </button>
              </section>
            )}
            {!locked && date > today && (
              <p className="muted small center">Future days can be logged but not confirmed.</p>
            )}
          </>
        )}
      </main>

      {confirmOpen && (
        <ConfirmDialog
          supabase={supabase}
          date={date}
          isToday={date === today}
          row={savedRow}
          ensureDay={ensureDay}
          onCancel={() => setConfirmOpen(false)}
          onConfirmed={() => {
            setConfirmOpen(false)
            fetchDay(date)
          }}
        />
      )}

      {loadState === 'ready' && !locked && (
        <footer className="savebar">
          <div className="save-status" aria-live="polite">
            {saveError ? (
              <span className="error small">{saveError}</span>
            ) : saving ? (
              <span className="muted">Saving…</span>
            ) : dirty ? (
              <span className="warning">Unsaved changes</span>
            ) : justSaved ? (
              <span className="success">Saved ✓</span>
            ) : savedRow ? (
              <span className="muted">All changes saved</span>
            ) : (
              <span className="muted">Nothing saved for this day yet</span>
            )}
          </div>
          <button type="button" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      )}
    </div>
  )
}

export default DayScreen
