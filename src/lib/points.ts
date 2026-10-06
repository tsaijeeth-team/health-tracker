// Points & rank (step 14). The database calculates everything (private.points_report in
// 007_points.sql, where all point values and rank thresholds live). This file only shapes and
// formats what it returns, plus the weekly-target input check.

export type PointsItem = { code: string; label: string; points: number }
export type PointsDay = {
  date: string
  confirmed: boolean
  items: PointsItem[]
  points: number
  total: number
  avg7_kg: number | null
  rank: string
}
export type RankRule = { name: string; points: number; gate_kg?: number; keep_kg?: number; hold_days?: number }
export type NextRank = {
  name: string
  points: number
  points_needed: number
  gate_kg: number | null
  hold_days: number | null
  held_days: number | null
}
export type WeekTarget = { week_start: string; target_kg: number; set_on: string; hit: boolean }
export type PointsReport = {
  start_date: string
  today: string
  total: number
  rank: string
  avg7_kg: number | null
  next_rank: NextRank | null
  week_start: string
  this_week: WeekTarget | null
  rules: Record<string, unknown> & { ranks: RankRule[] }
  days: PointsDay[]
}

// "+20", "−50", "0" (a real minus sign reads better than a hyphen).
export function formatPoints(n: number): string {
  if (n > 0) return `+${n.toLocaleString('en-IN')}`
  if (n < 0) return `−${Math.abs(n).toLocaleString('en-IN')}`
  return '0'
}

// The Monday-to-Sunday week (dates as YYYY-MM-DD) containing a date.
export function weekOf(date: string): { start: string; end: string } {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  const sinceMonday = (day.getUTCDay() + 6) % 7
  const start = new Date(day.getTime() - sinceMonday * 86400000)
  const end = new Date(start.getTime() + 6 * 86400000)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

// Weekly target: 30–300 kg, at most 1 decimal (same rule as the database).
export function targetError(text: string): string | null {
  const t = text.trim().replace(',', '.')
  if (!t) return 'Enter a target weight.'
  if (!/^\d+(\.\d)?$/.test(t)) return 'Use a number with at most 1 decimal, e.g. 99.5.'
  const n = Number(t)
  if (n < 30 || n > 300) return 'Target must be between 30 and 300 kg.'
  return null
}

// What the next rank still needs, in plain words.
export function nextRankNeeds(next: NextRank): string[] {
  const needs: string[] = []
  if (next.points_needed > 0) needs.push(`${next.points_needed.toLocaleString('en-IN')} more points`)
  if (next.gate_kg !== null) {
    const hold = next.hold_days ? `, held ${next.hold_days} days in a row (now ${next.held_days ?? 0})` : ''
    needs.push(`7-day average weight ${next.gate_kg} kg or less${hold}`)
  }
  return needs
}
