import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, formatDateLabel, isValidDate, todayIST } from './lib/dates'
import {
  EMPTY_FORM, formFromRow, formsEqual, validateDayForm,
  type DayForm, type DayRow, type FieldErrors, type TriState,
} from './lib/dayForm'
import { formatMinutes, sleepDuration } from './lib/sleep'
import { Field, ScaleButtons, TextInput, TriStateButtons } from './components/inputs'

const UNSAVED_WARNING = 'You have unsaved changes. Leave without saving them?'

function friendlyError(message: string, code?: string): string {
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "Can't reach the server. Check your internet connection and try again. Your entries are still on screen."
  }
  if (code === '23505') {
    return 'This day was already saved from another tab or device. Reload the page to see it (your unsaved entries here will be lost).'
  }
  return `The database refused to save: ${message}`
}

function DayScreen({ supabase, email }: { supabase: SupabaseClient; email: string }) {
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
  const requestId = useRef(0)

  const dirty = !formsEqual(form, savedForm)
  const locked = Boolean(savedRow?.confirmed_at)
  const today = todayIST()

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
      setLoadError(friendlyError(error.message, error.code))
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

  // Warn before closing or reloading the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  function goTo(newDate: string) {
    if (newDate === date || !isValidDate(newDate)) return
    if (dirty && !window.confirm(UNSAVED_WARNING)) return
    resetForLoad()
    setDate(newDate)
  }

  function logOut() {
    if (dirty && !window.confirm(UNSAVED_WARNING)) return
    supabase.auth.signOut()
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
      {date !== today && (
        <div className="center">
          <button type="button" className="link" onClick={() => goTo(today)}>
            Go to today
          </button>
        </div>
      )}

      <main className="content">
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
              <p className="banner">This day is confirmed and locked. Values can no longer be changed.</p>
            )}

            <section className="card">
              <h2>Body</h2>
              {numberField('weight_kg', 'Morning weight', 'kg, 1 decimal', 'decimal', 'e.g. 82.4')}
            </section>

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
              <p className="muted small">Cardio sessions come in a later step.</p>
            </section>

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
          </>
        )}
      </main>

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
