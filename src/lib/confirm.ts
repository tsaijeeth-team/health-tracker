// Confirm-day helpers: blank-field list, earlier-days notice, India-time formatting.

import { addDays, APP_TIME_ZONE } from './dates.ts'
import type { DayRow } from './dayForm.ts'

// Days must be confirmed within this many days (the points system will penalise late ones).
export const CONFIRM_WITHIN_DAYS = 7

const DAY_FIELDS: [keyof DayRow, string][] = [
  ['weight_kg', 'Morning weight'],
  ['bedtime', 'Bedtime'],
  ['wake_time', 'Wake time'],
  ['sleep_quality', 'Sleep quality'],
  ['snoring', 'Snoring'],
  ['gasping', 'Gasping'],
  ['afternoon_sleepiness', 'Afternoon sleepiness'],
  ['nap_minutes', 'Nap minutes'],
  ['steps', 'Steps'],
  ['stress', 'Stress'],
  ['energy', 'Energy'],
  ['resting_pulse', 'Resting pulse'],
  ['gaming_hours', 'Gaming hours'],
  ['porn', 'Porn'],
  ['naam_jaap', 'Naam Jaap'],
  ['junk_meals', 'Junk meals'],
]

// Labels of once-a-day fields left blank ("not answered"). No row = everything blank.
export function blankDayFields(row: DayRow | null): string[] {
  return DAY_FIELDS.filter(([key]) => !row || row[key] === null).map(([, label]) => label)
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

export type UnconfirmedDay = {
  date: string
  daysAgo: number
  hasEntries: boolean // false = nothing logged at all for that date
  daysLeft: number // days left within the confirm window; negative = overdue
}

// Every date from the first logged day up to yesterday (India time) that is not confirmed,
// newest first. Dates with no row at all count too: they were never confirmed either.
export function unconfirmedDays(
  rows: { log_date: string; confirmed_at: string | null }[],
  today: string,
): UnconfirmedDay[] {
  const past = rows.filter((r) => r.log_date < today)
  if (past.length === 0) return []
  const byDate = new Map(past.map((r) => [r.log_date, r]))
  const first = past.reduce((min, r) => (r.log_date < min ? r.log_date : min), past[0].log_date)
  const result: UnconfirmedDay[] = []
  for (let date = addDays(today, -1); date >= first; date = addDays(date, -1)) {
    const row = byDate.get(date)
    if (row?.confirmed_at) continue
    const daysAgo = daysBetween(date, today)
    result.push({ date, daysAgo, hasEntries: Boolean(row), daysLeft: CONFIRM_WITHIN_DAYS - daysAgo })
  }
  return result
}

export function deadlineText(day: UnconfirmedDay): string {
  if (day.daysLeft > 1) return `${day.daysLeft} days left`
  if (day.daysLeft === 1) return '1 day left'
  if (day.daysLeft === 0) return 'last day to confirm'
  return `over ${CONFIRM_WITHIN_DAYS} days`
}

// e.g. "5 Oct 2026, 22:14"
export function formatDateTimeIST(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}
