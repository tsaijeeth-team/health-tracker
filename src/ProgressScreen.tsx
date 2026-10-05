import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import LineChart, { type ChartPoint } from './components/LineChart'
import { E1RM_MAX_REPS, formatSet, progressPoints, type GymSet } from './lib/gym'
import { fetchAllRows, type Row } from './lib/export'
import { formatDateLabel } from './lib/dates'
import { formatNumber } from './lib/food'
import { friendlyError } from './lib/errors'

// Progressive overload graphs, one exercise at a time.
// Rules (PLAN.md, step 12): top set = heaviest weight (ties: more reps); volume = sets × reps × kg;
// e1RM = Epley from sets of ≤ 10 reps (none = a gap). Bodyweight-only sessions (0 kg) chart total reps only.

type Entry = {
  exercise_id: string
  exercises: { name: string } | null
  gym_sessions: { days: { log_date: string } | null } | null
  gym_sets: GymSet[]
}

function ProgressScreen({ supabase, onBack }: { supabase: SupabaseClient; onBack: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState('')

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => {
    let cancelled = false
    fetchAllRows((from, to) =>
      supabase
        .from('gym_exercises')
        .select('exercise_id, exercises(name), gym_sessions(days(log_date)), gym_sets(reps, weight_kg)')
        .order('created_at')
        .order('id')
        .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>,
    )
      .then((rows) => { if (!cancelled) setEntries(rows as unknown as Entry[]) })
      .catch((e: { message?: string; code?: string }) => { if (!cancelled) setError(friendlyError(e.message ?? String(e), e.code, true)) })
    return () => { cancelled = true }
  }, [supabase])

  // Exercises with at least one logged session, most recently done first.
  const exercises = useMemo(() => {
    const latest = new Map<string, { id: string; name: string; last: string }>()
    for (const e of entries ?? []) {
      const date = e.gym_sessions?.days?.log_date
      if (!date || e.gym_sets.length === 0) continue
      const prev = latest.get(e.exercise_id)
      if (!prev || date > prev.last) latest.set(e.exercise_id, { id: e.exercise_id, name: e.exercises?.name ?? 'Exercise', last: date })
    }
    return [...latest.values()].sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name))
  }, [entries])

  const selected = exercises.find((e) => e.id === chosen) ?? exercises[0]

  const points = useMemo(() => {
    if (!selected) return []
    return progressPoints(
      (entries ?? [])
        .filter((e) => e.exercise_id === selected.id && e.gym_sessions?.days?.log_date)
        .map((e) => ({ date: e.gym_sessions!.days!.log_date, sets: e.gym_sets.map((s) => ({ reps: s.reps, weight_kg: Number(s.weight_kg) })) })),
    )
  }, [entries, selected])

  // A session where every set is 0 kg has no weight to chart: it shows in total reps only.
  const weighted = points.filter((p) => (p.topKg ?? 0) > 0)
  const hasBodyweight = points.some((p) => p.topKg === 0)
  const kgPoint = (value: (p: (typeof points)[number]) => number | null, detail?: (p: (typeof points)[number]) => string) =>
    points.map((p): ChartPoint => ({ date: p.date, value: (p.topKg ?? 0) > 0 ? value(p) : null, detail: (p.topKg ?? 0) > 0 ? detail?.(p) : 'bodyweight only' }))

  return (
    <div className="app">
      <header className="topbar">
        <strong>Progress</strong>
        <div className="topbar-right">
          <button type="button" className="secondary small-button" onClick={onBack}>← Back</button>
        </div>
      </header>
      <main className="content">
        {error && <p className="error">{error}</p>}
        {!error && entries === null && <p className="muted">Loading your gym log…</p>}
        {entries !== null && exercises.length === 0 && (
          <section className="card">
            <h2>No gym sessions yet</h2>
            <p className="muted small">Log a session in the Workout section of a day. Your graphs appear here.</p>
          </section>
        )}
        {selected && (
          <>
            <section className="card">
              <label className="field">
                <span className="field-label">Exercise</span>
                <select aria-label="Exercise" value={selected.id} onChange={(e) => setChosen(e.target.value)}>
                  {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
              <p className="muted small">
                {points.length} session{points.length === 1 ? '' : 's'}. Tap a graph to see a value.
              </p>
            </section>

            {weighted.length > 0 && (
              <section className="card">
                <LineChart title="Top set (kg)" unit="kg" points={kgPoint((p) => p.topKg, (p) => `${p.topReps} reps`)} />
                <LineChart title="Volume (kg)" unit="kg" points={kgPoint((p) => p.volume, (p) => `${p.sets.length} sets`)} />
                <LineChart title="Estimated 1-rep max (kg)" unit="kg" points={kgPoint((p) => p.e1rm, (p) => (p.e1rm === null ? `no set of ${E1RM_MAX_REPS} reps or fewer` : 'Epley'))} />
                <p className="muted small">
                  Estimated 1-rep max uses only sets of {E1RM_MAX_REPS} reps or fewer. A session without one shows as a gap.
                </p>
              </section>
            )}
            {hasBodyweight && (
              <section className="card">
                <LineChart
                  title="Total reps (bodyweight sessions)"
                  unit="reps"
                  points={points.map((p) => ({ date: p.date, value: p.topKg === 0 ? p.totalReps : null, detail: p.topKg === 0 ? `${p.sets.length} sets` : 'weighted session' }))}
                />
              </section>
            )}

            <section className="card">
              <h2>Table</h2>
              <div className="table-scroll">
                <table className="progress-table">
                  <thead>
                    <tr><th>Date</th><th>Sets</th><th>Top set</th><th>Volume</th><th>e1RM</th><th>Reps</th></tr>
                  </thead>
                  <tbody>
                    {[...points].reverse().map((p) => (
                      <tr key={p.date}>
                        <td>{formatDateLabel(p.date)}</td>
                        <td>{p.sets.map((x, i) => <span key={i} className="set-line">{formatSet(x)}</span>)}</td>
                        <td>{p.topKg === null ? '' : formatSet({ reps: p.topReps ?? 0, weight_kg: p.topKg })}</td>
                        <td>{p.topKg ? `${formatNumber(p.volume)} kg` : ''}</td>
                        <td>{p.e1rm === null ? '—' : `${formatNumber(p.e1rm)} kg`}</td>
                        <td>{p.totalReps}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default ProgressScreen
