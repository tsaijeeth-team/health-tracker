// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankDayFields, deadlineText, formatDateTimeIST, unconfirmedDays } from '../src/lib/confirm.ts'
import type { DayRow } from '../src/lib/dayForm.ts'
import { addDays } from '../src/lib/dates.ts'

const row = (o: Partial<DayRow>): DayRow => ({
  id: 'x', log_date: '2026-10-05', weight_kg: 82.4, bedtime: '23:30:00', wake_time: '07:00:00', sleep_minutes: 450,
  sleep_quality: 4, snoring: false, gasping: false, afternoon_sleepiness: false, nap_minutes: 0, steps: 9000,
  stress: 3, energy: 7, resting_pulse: 62, gaming_hours: 0, porn: false, naam_jaap: true, junk_meals: 0,
  confirmed_at: null, ...o,
})

test('blank fields: none when complete; false and 0 are answers, not blanks', () => {
  assert.deepEqual(blankDayFields(row({})), [])
})

test('blank fields listed by label', () => {
  assert.deepEqual(blankDayFields(row({ weight_kg: null, junk_meals: null, porn: null })), ['Morning weight', 'Porn', 'Junk meals'])
  assert.equal(blankDayFields(null).length, 16)
})

test('earlier unconfirmed days: from first logged day to yesterday, newest first, gaps included', () => {
  const list = unconfirmedDays([
    { log_date: '2026-10-01', confirmed_at: '2026-10-01T18:00:00Z' },
    { log_date: '2026-10-03', confirmed_at: null },
    { log_date: '2026-10-05', confirmed_at: null }, // today: not listed
    { log_date: '2026-10-06', confirmed_at: null }, // future: not listed
  ], '2026-10-05')
  assert.deepEqual(list.map((d) => [d.date, d.daysAgo, d.hasEntries]), [
    ['2026-10-04', 1, false], // gap: nothing logged
    ['2026-10-03', 2, true],
    ['2026-10-02', 3, false],
  ])
})

test('no notice before any past day exists', () => {
  assert.deepEqual(unconfirmedDays([], '2026-10-05'), [])
  assert.deepEqual(unconfirmedDays([{ log_date: '2026-10-05', confirmed_at: null }], '2026-10-05'), [])
})

test('7-day window text', () => {
  const at = (daysAgo: number) => unconfirmedDays([{ log_date: '2026-09-01', confirmed_at: null }], addDays('2026-09-01', daysAgo)).find((d) => d.date === '2026-09-01')!
  assert.equal(deadlineText(at(1)), '6 days left')
  assert.equal(deadlineText(at(6)), '1 day left')
  assert.equal(deadlineText(at(7)), 'last day to confirm')
  assert.equal(deadlineText(at(8)), 'over 7 days')
})

test('confirm time shown in India time', () => {
  assert.equal(formatDateTimeIST('2026-10-05T16:44:00Z'), '5 Oct 2026, 22:14')
  assert.equal(formatDateTimeIST('2026-10-05T18:45:00Z'), '6 Oct 2026, 00:15')
})
