import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_NAME, cleanName, exerciseNameError, usedMessage } from './lib/gym'
import { formatDateTimeIST } from './lib/confirm'
import { friendlyError } from './lib/errors'

// The owner's exercise list: rename any time (sets, reps and kg never change),
// delete only if never used. Every rename is kept in a permanent history.

export type Rename = { old_name: string; new_name: string; renamed_at: string }
export type ExerciseItem = { id: string; name: string; exercise_renames: Rename[] }

type Props = {
  supabase: SupabaseClient
  exercises: ExerciseItem[]
  sessionCounts: Map<string, number>
  onChanged: () => Promise<void>
}

function ExercisesCard({ supabase, exercises, sessionCounts, onChanged }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<{ id: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  function startRename(ex: ExerciseItem) {
    setEditing(ex.id)
    setDraft(ex.name)
    setMessage(null)
  }

  async function saveRename(ex: ExerciseItem) {
    const name = cleanName(draft)
    if (name === ex.name) { setEditing(null); return }
    const problem = exerciseNameError(name, exercises, ex.id)
    if (problem) { setMessage({ id: ex.id, text: problem }); return }
    setBusy(true)
    const { error } = await supabase.from('exercises').update({ name }).eq('id', ex.id)
    setBusy(false)
    if (error) {
      setMessage({ id: ex.id, text: error.code === '23505' ? `"${name}" is already in your list.` : friendlyError(error.message, error.code) })
      return
    }
    setEditing(null)
    await onChanged()
  }

  async function remove(ex: ExerciseItem) {
    const used = sessionCounts.get(ex.id) ?? 0
    if (used > 0) { setMessage({ id: ex.id, text: usedMessage(used) }); return }
    if (!window.confirm(`Delete "${ex.name}" from your exercise list?`)) return
    setBusy(true)
    const { error } = await supabase.from('exercises').delete().eq('id', ex.id)
    setBusy(false)
    if (error) {
      // The database has the final word (e.g. used on another device a moment ago).
      const used = /Used in \d+ sessions?/.exec(error.message)
      setMessage({ id: ex.id, text: used ? `${used[0]} — rename instead.` : friendlyError(error.message, error.code) })
      await onChanged() // show the up-to-date usage count
      return
    }
    await onChanged()
  }

  return (
    <section className="card">
      <h2>Your exercises</h2>
      <p className="muted small">Renaming keeps every set and graph. Each rename is recorded below the exercise.</p>
      <ul className="exercise-list">
        {exercises.map((ex) => {
          const used = sessionCounts.get(ex.id) ?? 0
          const history = [...ex.exercise_renames].sort((a, b) => b.renamed_at.localeCompare(a.renamed_at))
          return (
            <li key={ex.id} className="exercise-row" aria-label={ex.name}>
              {editing === ex.id ? (
                <div className="exercise-rename">
                  <input type="text" aria-label={`New name for ${ex.name}`} value={draft} maxLength={MAX_NAME + 20}
                    disabled={busy} autoFocus
                    onChange={(e) => { setDraft(e.target.value); setMessage(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(ex) }} />
                  <div className="button-row">
                    <button type="button" disabled={busy} onClick={() => saveRename(ex)}>{busy ? 'Saving…' : 'Save name'}</button>
                    <button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(null); setMessage(null) }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="gym-head">
                  <span>
                    <strong>{ex.name}</strong>
                    <span className="muted small"> · {used === 0 ? 'not used yet' : `${used} session${used === 1 ? '' : 's'}`}</span>
                  </span>
                  <span className="exercise-actions">
                    <button type="button" className="link" disabled={busy || editing !== null} onClick={() => startRename(ex)}>Rename</button>
                    <button type="button" className="link" disabled={busy || editing !== null} onClick={() => remove(ex)}>Delete</button>
                  </span>
                </div>
              )}
              {message?.id === ex.id && <p className="error small" role="alert">{message.text}</p>}
              {history.length > 0 && (
                <ul className="rename-history muted small" aria-label={`Rename history of ${ex.name}`}>
                  {history.map((h) => (
                    <li key={h.renamed_at + h.old_name}>
                      Renamed “{h.old_name}” → “{h.new_name}” · {formatDateTimeIST(h.renamed_at)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default ExercisesCard
