import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { friendlyError } from './errors'

// Loads all rows of `table` for one day and lets the caller reload after a change.
export function useDayRows<T>(supabase: SupabaseClient, table: string, dayId: string | null) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(Boolean(dayId))
  const [error, setError] = useState('')
  const requestId = useRef(0)

  const reload = useCallback(async (id: string) => {
    const req = ++requestId.current
    const { data, error: err } = await supabase.from(table).select('*').eq('day_id', id).order('created_at')
    if (req !== requestId.current) return // a newer request is in flight
    setLoading(false)
    if (err) {
      setError(friendlyError(err.message, err.code))
      return
    }
    setError('')
    setRows((data ?? []) as T[])
  }, [supabase, table])

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => {
    if (dayId) reload(dayId)
  }, [dayId, reload])

  return { rows, loading, error, reload }
}
