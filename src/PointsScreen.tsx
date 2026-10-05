import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPoints, nextRankNeeds, targetError, weekOf, type PointsReport } from './lib/points'
import { formatDateLabel } from './lib/dates'
import { formatNumber } from './lib/food'
import { friendlyError } from './lib/errors'

// Points & rank: total, rank, what the next rank needs, this week's target weight and a
// day-by-day list of every rule that applied. The database does all the counting.

const PAGE = 30

// The rules in words, built from the database's values (private.points_rules), so they never disagree.
function ruleLines(rules: PointsReport['rules']): string[] {
  const n = (k: string) => Number(rules[k])
  const p = (k: string) => formatPoints(n(k))
  const kg = (rules.milestones_kg as number[]).join(', ')
  return [
    `Only confirmed days earn or lose points. A day not confirmed by 23:59 on the ${n('confirm_days')}th day after it: ${p('missed_confirm')}.`,
    `Clean day (0 junk meals, porn No, gaming ${n('gaming_limit_h')} h or less; blanks are not clean): ${p('clean_day')}.`,
    `No games (0 h): ${p('no_games')}. Gym session with an exercise of ${n('gym_min_sets')}+ sets: ${p('gym')}.`,
    `Every ${n('streak_length')}th clean day in a row: ${p('streak_bonus')}. Weekly target hit: ${p('weekly_target')}.`,
    `Weight milestones (${kg} kg): ${p('milestone')} each, once.`,
    `Junk food: ${p('junk_day')}. Porn: ${p('porn')}. Gaming over ${n('gaming_limit_h')} h: ${p('gaming_over')}.`,
  ]
}

function PointsScreen({ supabase, onBack }: { supabase: SupabaseClient; onBack: () => void }) {
  const [report, setReport] = useState<PointsReport | null>(null)
  const [error, setError] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [target, setTarget] = useState('')
  const [editing, setEditing] = useState(false)
  const [targetMsg, setTargetMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('get_my_points')
    if (err) { setError(friendlyError(err.message, err.code, true)); return }
    setError('')
    setReport(data as PointsReport)
  }, [supabase])

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => { load() }, [load])

  async function saveTarget() {
    if (!report) return
    const problem = targetError(target)
    if (problem) { setTargetMsg(problem); return }
    const kg = Number(target.trim().replace(',', '.'))
    setBusy(true)
    const { error: err } = report.this_week
      ? await supabase.from('weight_targets').update({ target_kg: kg }).eq('week_start', report.week_start)
      : await supabase.from('weight_targets').insert({ week_start: report.week_start, target_kg: kg })
    setBusy(false)
    if (err) {
      const hit = /already hit/.test(err.message)
      await load() // first the database's current state, then the message, so they never disagree
      setTargetMsg(hit ? 'This week\'s target was already hit — locked.' : friendlyError(err.message, err.code))
      if (hit) setEditing(false)
      return
    }
    setEditing(false)
    setTargetMsg('')
    await load()
  }

  const week = report ? weekOf(report.week_start) : null
  const notStarted = report ? report.start_date > report.today : false
  const needs = report?.next_rank ? nextRankNeeds(report.next_rank) : []

  return (
    <div className="app">
      <header className="topbar">
        <strong>Points &amp; rank</strong>
        <div className="topbar-right">
          <button type="button" className="secondary small-button" onClick={onBack}>← Back</button>
        </div>
      </header>
      <main className="content">
        {error && <p className="error">{error}</p>}
        {!error && !report && <p className="muted">Loading your points…</p>}
        {report && (
          <>
            <section className="card rank-card" aria-label="Your rank">
              <span className="muted small">Current rank</span>
              <strong className="rank-name">🏆 {report.rank}</strong>
              <p className="points-total"><strong>{report.total.toLocaleString('en-IN')}</strong> points</p>
              <p className="muted small">
                7-day average weight: {report.avg7_kg === null ? 'no confirmed weight in the last 7 days' : `${formatNumber(report.avg7_kg)} kg`}
              </p>
              {report.next_rank ? (
                <p className="small">
                  Next: <strong>{report.next_rank.name}</strong>
                  {needs.length > 0 ? ` needs ${needs.join(' and ')}.` : ' (requirements met; it updates with your next confirmed day).'}
                </p>
              ) : <p className="small">Highest rank reached.</p>}
              {notStarted && (
                <p className="note small">Points start on {formatDateLabel(report.start_date)}. Earlier days are not counted.</p>
              )}
            </section>

            <section className="card" aria-label="This week's target">
              <h2>This week's target</h2>
              {week && <p className="muted small">{formatDateLabel(week.start)} – {formatDateLabel(week.end)}</p>}
              {report.this_week && !editing && (
                <>
                  <p>
                    Target: <strong>{formatNumber(report.this_week.target_kg)} kg</strong>
                    {report.this_week.hit ? ' · ✅ hit (+10) — locked' : ' · not hit yet'}
                  </p>
                  <p className="muted small">
                    Set on {formatDateLabel(report.this_week.set_on)}. The first confirmed weigh-in at or below it from that day on earns +10.
                  </p>
                  {!report.this_week.hit && (
                    <button type="button" className="secondary" onClick={() => { setEditing(true); setTarget(String(report.this_week!.target_kg)); setTargetMsg('') }}>
                      Change target
                    </button>
                  )}
                </>
              )}
              {(!report.this_week || editing) && (
                <div className="target-form">
                  <label className="field">
                    <span className="field-label"><span>Target weight</span><span className="muted small">kg, 1 decimal</span></span>
                    <input type="text" inputMode="decimal" aria-label="Target weight" value={target} disabled={busy}
                      onChange={(e) => { setTarget(e.target.value); setTargetMsg('') }} placeholder="e.g. 99.5" />
                  </label>
                  <p className="muted small">Changing it restarts the count: only weigh-ins from today on count.</p>
                  <div className="button-row">
                    <button type="button" onClick={saveTarget} disabled={busy}>{busy ? 'Saving…' : 'Save target'}</button>
                    {editing && <button type="button" className="secondary" onClick={() => { setEditing(false); setTargetMsg('') }}>Cancel</button>}
                  </div>
                </div>
              )}
              {targetMsg && <p className="error small" role="alert">{targetMsg}</p>}
            </section>

            <section className="card" aria-label="Day by day">
              <h2>Day by day</h2>
              {report.days.length === 0 && <p className="muted small">No days counted yet.</p>}
              <ul className="points-days">
                {report.days.slice(0, shown).map((d) => (
                  <li key={d.date} className="points-day">
                    <div className="gym-head">
                      <strong>{formatDateLabel(d.date)}</strong>
                      <span className={d.points < 0 ? 'points-minus' : d.points > 0 ? 'points-plus' : 'muted'}>{formatPoints(d.points)}</span>
                    </div>
                    <ul className="points-items small">
                      {d.items.map((it, i) => (
                        <li key={i} className={it.points === 0 ? 'muted' : ''}>
                          {it.points !== 0 && <span className="points-amount">{formatPoints(it.points)}</span>}
                          {it.label}
                        </li>
                      ))}
                    </ul>
                    <p className="muted small">Total {d.total.toLocaleString('en-IN')} · {d.rank}</p>
                  </li>
                ))}
              </ul>
              {report.days.length > shown && (
                <button type="button" className="secondary" onClick={() => setShown((n) => n + PAGE)}>Show older days</button>
              )}
            </section>

            <section className="card">
              <details>
                <summary>How points and ranks work</summary>
                <ul className="small rules-list">
                  {ruleLines(report.rules).map((line) => <li key={line}>{line}</li>)}
                </ul>
                <div className="table-scroll">
                <table className="progress-table rank-table">
                  <thead><tr><th>Rank</th><th>Points</th><th>Weight (7-day average)</th></tr></thead>
                  <tbody>
                    {report.rules.ranks.map((r) => (
                      <tr key={r.name}>
                        <td>{r.name}</td>
                        <td>{r.points.toLocaleString('en-IN')}</td>
                        <td>{r.gate_kg ? `≤ ${r.gate_kg} kg${r.hold_days ? `, held ${r.hold_days} days` : ''}; lost above ${r.keep_kg} kg` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </details>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default PointsScreen
