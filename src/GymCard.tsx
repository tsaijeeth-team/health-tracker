import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_NAME, MUSCLE_GROUPS, cleanName, findExercise, formatSet, nameKey, nextSet, validateSession,
  type ExerciseForm, type MuscleGroup, type SessionForm,
} from './lib/gym'
import { nowTimeIST } from './lib/dates'
import { friendlyError } from './lib/errors'

// Gym session for one day (at most one; the database enforces it).
// Lives inside the Workout section. Saves the whole session in one go via save_gym_session().

type Exercise = { id: string; name: string }
type SessionRow = {
  id: string
  start_time: string
  muscle_groups: MuscleGroup[]
  gym_exercises: {
    id: string; position: number; note: string | null; exercise_id: string
    exercises: { name: string } | null
    gym_sets: { set_number: number; reps: number; weight_kg: number }[]
  }[]
}

type Props = {
  supabase: SupabaseClient
  dayId: string | null
  locked: boolean
  ensureDay: () => Promise<string>
  onDirtyChange: (dirty: boolean) => void
  onOpenProgress: () => void
}

const EMPTY: SessionForm = { start_time: '', muscle_groups: [], exercises: [] }
const label = (g: string) => MUSCLE_GROUPS.find((m) => m.value === g)?.label ?? g

function formFromSession(s: SessionRow): SessionForm {
  return {
    start_time: s.start_time.slice(0, 5),
    muscle_groups: s.muscle_groups,
    exercises: [...s.gym_exercises]
      .sort((a, b) => a.position - b.position)
      .map((e) => ({
        exercise_id: e.exercise_id,
        name: e.exercises?.name ?? 'Exercise',
        note: e.note ?? '',
        sets: [...e.gym_sets].sort((a, b) => a.set_number - b.set_number)
          .map((x) => ({ reps: String(x.reps), weight_kg: String(Number(x.weight_kg)) })),
      })),
  }
}

function GymCard({ supabase, dayId, locked, ensureDay, onDirtyChange, onOpenProgress }: Props) {
  const [session, setSession] = useState<SessionRow | null>(null)
  const [loading, setLoading] = useState(Boolean(dayId))
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<SessionForm>(EMPTY)
  const [baseline, setBaseline] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [exercises, setExercises] = useState<Exercise[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const requestId = useRef(0)

  const dirty = editing && JSON.stringify(form) !== baseline
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  const load = useCallback(async (id: string) => {
    const req = ++requestId.current
    const { data, error } = await supabase
      .from('gym_sessions')
      .select('id, start_time, muscle_groups, gym_exercises(id, position, note, exercise_id, exercises(name), gym_sets(set_number, reps, weight_kg))')
      .eq('day_id', id)
      .maybeSingle()
    if (req !== requestId.current) return
    setLoading(false)
    if (error) { setLoadError(friendlyError(error.message, error.code, true)); return }
    setLoadError('')
    setSession((data as SessionRow | null) ?? null)
  }, [supabase])

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => { if (dayId) load(dayId) }, [dayId, load])

  async function loadExercises() {
    const { data, error } = await supabase.from('exercises').select('id, name').order('name')
    if (error) { setErrors([friendlyError(error.message, error.code, true)]); return }
    setExercises(data as Exercise[])
  }

  function startEditing() {
    const start = session ? formFromSession(session) : { ...EMPTY, start_time: nowTimeIST() }
    setForm(start)
    setBaseline(JSON.stringify(start))
    setErrors([])
    setEditing(true)
    setPicking(false)
    if (!exercises) loadExercises()
  }

  function stopEditing() {
    if (dirty && !window.confirm('Discard the changes to this gym session?')) return
    setEditing(false)
    setPicking(false)
    setErrors([])
  }

  const change = (f: (current: SessionForm) => SessionForm) => { setForm(f); setErrors([]) }
  const changeExercise = (i: number, f: (e: ExerciseForm) => ExerciseForm) =>
    change((c) => ({ ...c, exercises: c.exercises.map((e, j) => (j === i ? f(e) : e)) }))

  function toggleGroup(g: MuscleGroup) {
    change((c) => ({
      ...c,
      muscle_groups: c.muscle_groups.includes(g) ? c.muscle_groups.filter((x) => x !== g) : MUSCLE_GROUPS.map((m) => m.value).filter((v) => v === g || c.muscle_groups.includes(v)),
    }))
  }

  function addExercise(ex: Exercise) {
    change((c) => ({ ...c, exercises: [...c.exercises, { exercise_id: ex.id, name: ex.name, note: '', sets: [{ reps: '', weight_kg: '' }] }] }))
    setPicking(false)
    setSearch('')
  }

  async function createExercise() {
    const name = cleanName(search)
    if (!name) return
    if (name.length > MAX_NAME) { setErrors([`An exercise name can be at most ${MAX_NAME} characters.`]); return }
    const existing = findExercise(exercises ?? [], name)
    if (existing) { addExercise(existing); return }
    setBusy(true)
    const { data, error } = await supabase.from('exercises').insert({ name }).select('id, name').single()
    setBusy(false)
    if (error) {
      setErrors([error.code === '23505' ? `"${name}" is already in your list.` : friendlyError(error.message, error.code)])
      await loadExercises()
      return
    }
    const created = data as Exercise
    setExercises((list) => [...(list ?? []), created].sort((a, b) => a.name.localeCompare(b.name)))
    addExercise(created)
  }

  async function save() {
    const { errors: found, payload } = validateSession(form)
    if (!payload) { setErrors(found); return }
    setBusy(true)
    try {
      const id = await ensureDay()
      const { error } = await supabase.rpc('save_gym_session', {
        p_day_id: id,
        p_start_time: payload.start_time,
        p_muscle_groups: payload.muscle_groups,
        p_exercises: payload.exercises,
      })
      if (error) throw error
      await load(id)
      setEditing(false)
      setPicking(false)
    } catch (e) {
      const err = e as { message?: string; code?: string }
      const msg = err.message ?? String(e)
      setErrors([/gym_one_session_per_day/.test(msg) ? 'There is already a gym session on this day (one per day).' : friendlyError(msg, err.code)])
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!session || !window.confirm('Delete this whole gym session?')) return
    setBusy(true)
    const { error } = await supabase.from('gym_sessions').delete().eq('id', session.id)
    setBusy(false)
    if (error) { setErrors([friendlyError(error.message, error.code)]); return }
    setSession(null)
    setEditing(false)
  }

  const inSession = useMemo(() => new Set(form.exercises.map((e) => e.exercise_id)), [form.exercises])
  const matches = useMemo(
    () => (exercises ?? []).filter((e) => !inSession.has(e.id) && nameKey(e.name).includes(nameKey(search))),
    [exercises, search, inSession],
  )
  const exactExists = Boolean(findExercise(exercises ?? [], search))
  const summary = session ? formFromSession(session) : null

  return (
    <div className="gym-card">
      <div className="gym-head">
        <h3>Gym</h3>
        <button type="button" className="link" onClick={onOpenProgress}>📈 Progress graphs</button>
      </div>

      {loading && <p className="muted small">Loading gym session…</p>}
      {loadError && <p className="error small">{loadError}</p>}

      {!loading && !loadError && !editing && (
        <>
          {!summary && <p className="muted small">No gym session on this day.</p>}
          {summary && (
            <div className="gym-summary">
              <p className="small"><strong>{summary.start_time}</strong> · {summary.muscle_groups.map(label).join(', ')}</p>
              <ul className="gym-list">
                {summary.exercises.map((e) => (
                  <li key={e.exercise_id}>
                    <strong>{e.name}</strong>
                    <span className="small"> {e.sets.map((s) => formatSet({ reps: Number(s.reps), weight_kg: Number(s.weight_kg) })).join(' · ')}</span>
                    {e.note && <span className="muted small"> — {e.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!locked && (
            <button type="button" className={summary ? 'secondary' : ''} onClick={startEditing}>
              {summary ? 'Edit gym session' : '+ Log gym session'}
            </button>
          )}
        </>
      )}

      {editing && (
        <div className="subpanel">
          <label className="field">
            <span className="field-label">Start time</span>
            <input type="time" aria-label="Gym start time" value={form.start_time} disabled={busy}
              onChange={(e) => change((c) => ({ ...c, start_time: e.target.value }))} />
          </label>

          <div className="field">
            <span className="field-label"><span>Muscle groups</span><span className="muted small">tap all that apply</span></span>
            <div className="chip-grid" role="group" aria-label="Muscle groups">
              {MUSCLE_GROUPS.map((m) => (
                <button key={m.value} type="button" disabled={busy}
                  className={form.muscle_groups.includes(m.value) ? 'chip selected' : 'chip'}
                  aria-pressed={form.muscle_groups.includes(m.value)} onClick={() => toggleGroup(m.value)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {form.exercises.map((ex, i) => (
            <div key={ex.exercise_id} className="gym-exercise" aria-label={`Exercise ${ex.name}`} role="group">
              <div className="gym-head">
                <strong>{ex.name}</strong>
                <button type="button" className="link" disabled={busy}
                  onClick={() => change((c) => ({ ...c, exercises: c.exercises.filter((_, j) => j !== i) }))}>
                  Remove
                </button>
              </div>
              {ex.sets.map((s, k) => (
                <div key={k} className="set-row">
                  <span className="muted small set-no">Set {k + 1}</span>
                  <input type="text" inputMode="numeric" aria-label={`${ex.name} set ${k + 1} reps`} placeholder="reps"
                    value={s.reps} disabled={busy}
                    onChange={(e) => changeExercise(i, (x) => ({ ...x, sets: x.sets.map((y, j) => (j === k ? { ...y, reps: e.target.value } : y)) }))} />
                  <span className="muted small">×</span>
                  <input type="text" inputMode="decimal" aria-label={`${ex.name} set ${k + 1} kg`} placeholder="kg"
                    value={s.weight_kg} disabled={busy}
                    onChange={(e) => changeExercise(i, (x) => ({ ...x, sets: x.sets.map((y, j) => (j === k ? { ...y, weight_kg: e.target.value } : y)) }))} />
                  <span className="muted small">kg</span>
                  <button type="button" className="link" aria-label={`Remove ${ex.name} set ${k + 1}`} disabled={busy || ex.sets.length === 1}
                    onClick={() => changeExercise(i, (x) => ({ ...x, sets: x.sets.filter((_, j) => j !== k) }))}>✕</button>
                </div>
              ))}
              <button type="button" className="secondary small-button" disabled={busy || ex.sets.length >= 50}
                onClick={() => changeExercise(i, (x) => ({ ...x, sets: [...x.sets, nextSet(x.sets)] }))}>
                + Add set
              </button>
              <input type="text" aria-label={`${ex.name} note`} placeholder="Note (optional)" maxLength={500}
                value={ex.note} disabled={busy}
                onChange={(e) => changeExercise(i, (x) => ({ ...x, note: e.target.value }))} />
            </div>
          ))}
          <p className="muted small">0 kg = bodyweight. A new set copies the previous one.</p>

          {!picking && (
            <button type="button" className="secondary" disabled={busy} onClick={() => setPicking(true)}>+ Add exercise</button>
          )}
          {picking && (
            <div className="gym-picker">
              <input type="search" aria-label="Find or add an exercise" placeholder="Find or add an exercise"
                value={search} maxLength={MAX_NAME} onChange={(e) => setSearch(e.target.value)} autoFocus />
              {exercises === null && <p className="muted small">Loading your exercises…</p>}
              <ul className="recent-list">
                {matches.slice(0, 30).map((e) => (
                  <li key={e.id}><button type="button" className="recent-item" onClick={() => addExercise(e)}>{e.name}</button></li>
                ))}
              </ul>
              {search.trim() && !exactExists && (
                <button type="button" disabled={busy} onClick={createExercise}>+ Add “{cleanName(search)}” as a new exercise</button>
              )}
              {search.trim() && exactExists && inSession.has(findExercise(exercises ?? [], search)!.id) && (
                <p className="muted small">Already in this session.</p>
              )}
              <button type="button" className="link" onClick={() => { setPicking(false); setSearch('') }}>Close</button>
            </div>
          )}

          {errors.length > 0 && (
            <div role="alert">{errors.map((e) => <p key={e} className="error small">{e}</p>)}</div>
          )}
          <div className="button-row">
            <button type="button" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save session'}</button>
            <button type="button" className="secondary" onClick={stopEditing} disabled={busy}>Cancel</button>
          </div>
          {session && (
            <button type="button" className="danger" onClick={remove} disabled={busy}>Delete gym session</button>
          )}
        </div>
      )}

      {locked && summary && <p className="muted small">This day is locked. The gym session can no longer be changed.</p>}
    </div>
  )
}

export default GymCard
