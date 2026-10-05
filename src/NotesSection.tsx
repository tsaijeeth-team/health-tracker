import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateTimeIST } from './lib/confirm'
import { friendlyError } from './lib/errors'
import { useDayRows } from './lib/useDayRows'

type NoteRow = { id: string; day_id: string; body: string; created_at: string }

type Props = {
  supabase: SupabaseClient
  dayId: string | null
  ensureDay: () => Promise<string>
  onDirtyChange: (dirty: boolean) => void
}

const MAX_LENGTH = 2000

// Notes are permanent: the database refuses edits and deletes, so there are no such buttons.
function NotesSection({ supabase, dayId, ensureDay, onDirtyChange }: Props) {
  const { rows, loading, error: loadError, reload } = useDayRows<NoteRow>(supabase, 'day_notes', dayId)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const dirty = text.trim() !== ''

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  async function add() {
    const body = text.trim()
    if (!body) {
      setError('Write something first.')
      return
    }
    if (body.length > MAX_LENGTH) {
      setError(`A note can be at most ${MAX_LENGTH} characters.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const id = await ensureDay()
      const { error: err } = await supabase.from('day_notes').insert({ day_id: id, body })
      if (err) throw err
      setText('')
      await reload(id)
    } catch (e) {
      const err = e as { message?: string; code?: string }
      setError(friendlyError(err.message ?? String(e), err.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Notes</h2>
      {loading && <p className="muted small">Loading notes…</p>}
      {loadError && <p className="error small">{loadError}</p>}
      {!loading && !loadError && rows.length === 0 && <p className="muted small">No notes for this day.</p>}
      {rows.length > 0 && (
        <ul className="notes">
          {rows.map((n) => (
            <li key={n.id}>
              <span className="muted small">{formatDateTimeIST(n.created_at)}</span>
              <p>{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      <label className="field">
        <span className="field-label">
          <span>Add a note</span>
          <span className="muted small">{text.trim().length} / {MAX_LENGTH}</span>
        </span>
        <textarea
          rows={3}
          value={text}
          maxLength={MAX_LENGTH}
          disabled={busy}
          onChange={(e) => { setText(e.target.value); setError('') }}
        />
      </label>
      <p className="note small">Notes are permanent: once added, they can never be edited or deleted.</p>
      {error && <p className="error small" role="alert">{error}</p>}
      <button type="button" onClick={add} disabled={busy || !dirty}>
        {busy ? 'Adding…' : 'Add note (permanent)'}
      </button>
    </section>
  )
}

export default NotesSection
