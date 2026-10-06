import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SharedDay, SharedProgress } from './lib/share'
import { formatDateLabel } from './lib/dates'
import { KCAL_CAP, formatNumber, formatTotal, kcalLevel } from './lib/food'
import { FLUID_TARGET_ML } from './lib/fluids'
import { cardioLabel } from './lib/cardio'
import { formatMinutes } from './lib/sleep'

// Read-only page for viewers of a share link. No login, nothing editable.
// The database decides what is shown (confirmed days, allowed fields only).

function SharedDayCard({ day }: { day: SharedDay }) {
  const kcal = Math.round((Number(day.food.kcal) + Number(day.fluids.kcal)) * 100) / 100
  const unknownKcal = day.fluids.kcal_unknown > 0
  const level = kcalLevel(kcal)
  const t = (known: number, unknownCount: number) => formatTotal({ known: Number(known), unknownCount }, ' g')
  return (
    <article className="card shared-day">
      <h2>{formatDateLabel(day.date)}</h2>
      <dl className="shared-grid">
        <div><dt>Weight</dt><dd>{day.weight_kg === null ? '—' : `${formatNumber(day.weight_kg)} kg`}</dd></div>
        <div>
          <dt>Calories</dt>
          <dd className={`kcal-text ${level}`}>
            {unknownKcal ? 'at least ' : ''}{formatNumber(kcal)} / {formatNumber(KCAL_CAP)} kcal
          </dd>
        </div>
        <div><dt>Protein</dt><dd>{t(day.food.protein_g, day.food.protein_unknown)}</dd></div>
        <div><dt>Carbs</dt><dd>{t(day.food.carbs_g, day.food.carbs_unknown)}</dd></div>
        <div><dt>Fat</dt><dd>{t(day.food.fat_g, day.food.fat_unknown)}</dd></div>
        <div><dt>Fibre</dt><dd>{t(day.food.fibre_g, day.food.fibre_unknown)}</dd></div>
        <div><dt>Fluids</dt><dd>{formatNumber(day.fluids.total_ml)} / {formatNumber(FLUID_TARGET_ML)} ml</dd></div>
        <div>
          <dt>Water &amp; other / sugary</dt>
          <dd>{formatNumber(day.fluids.total_ml - day.fluids.sugary_ml)} / {formatNumber(day.fluids.sugary_ml)} ml</dd>
        </div>
        <div><dt>Steps</dt><dd>{day.steps === null ? '—' : formatNumber(day.steps)}</dd></div>
        <div><dt>Junk meals</dt><dd>{day.junk_meals === null ? '—' : day.junk_meals}</dd></div>
        <div className="wide">
          <dt>Sleep</dt>
          <dd>
            {day.bedtime && day.wake_time
              ? `${day.bedtime} → ${day.wake_time}${day.sleep_minutes ? ` (${formatMinutes(day.sleep_minutes)})` : ''}`
              : '—'}
          </dd>
        </div>
        <div className="wide">
          <dt>Cardio</dt>
          <dd>
            {day.cardio.length === 0
              ? 'none'
              : day.cardio.map((c) => `${c.start_time} ${cardioLabel(c.type)}${c.description ? ` (${c.description})` : ''} ${c.minutes} min`).join(' · ')}
          </dd>
        </div>
      </dl>
    </article>
  )
}

function SharePage({ supabase, token }: { supabase: SupabaseClient | null; token: string }) {
  const [state, setState] = useState<'loading' | 'invalid' | 'error' | 'ready'>(token ? 'loading' : 'invalid')
  const [data, setData] = useState<SharedProgress | null>(null)

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => {
    if (!token || !supabase) return
    let cancelled = false
    supabase.rpc('get_shared_progress', { p_token: token }).then(({ data: result, error }) => {
      if (cancelled) return
      if (error) setState('error')
      else if (!result) setState('invalid')
      else {
        setData(result as SharedProgress)
        setState('ready')
      }
    })
    return () => { cancelled = true }
  }, [supabase, token])

  return (
    <div className="app share-view">
      <header className="topbar">
        <strong>Health progress</strong>
        <span className="muted small">Read-only</span>
      </header>
      <main className="content">
        {state === 'loading' && <p className="muted center">Loading…</p>}
        {state === 'invalid' && (
          <div className="card">
            <h2>This link is not valid</h2>
            <p className="muted">It may have been typed wrongly, expired, or been switched off by its owner.</p>
          </div>
        )}
        {state === 'error' && (
          <div className="card">
            <p className="error">Can't load right now. Check your internet connection and reload the page.</p>
          </div>
        )}
        {state === 'ready' && data && (
          <>
            {data.rank && (
              <div className="card rank-card" aria-label="Current rank">
                <span className="muted small">Current rank</span>
                <strong className="rank-name">🏆 {data.rank}</strong>
              </div>
            )}
            <p className="muted small center">Confirmed days only, newest first.</p>
            {data.days.length === 0 && <div className="card"><p className="muted">No confirmed days yet.</p></div>}
            {data.days.map((d) => <SharedDayCard key={d.date} day={d} />)}
          </>
        )}
      </main>
    </div>
  )
}

export default SharePage
