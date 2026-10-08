// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, formatDateLabel, isValidDate, todayIST } from '../src/lib/dates.ts'
import { formatMinutes, sleepDuration } from '../src/lib/sleep.ts'
import { EMPTY_FORM, formFromRow, formsEqual, validateDayForm, type DayRow } from '../src/lib/dayForm.ts'

test('today uses India time, not UTC', () => {
  // 20:00 UTC on 4 Oct = 01:30 on 5 Oct in India.
  assert.equal(todayIST(new Date('2026-10-04T20:00:00Z')), '2026-10-05')
  // 18:00 UTC on 4 Oct = 23:30 on 4 Oct in India.
  assert.equal(todayIST(new Date('2026-10-04T18:00:00Z')), '2026-10-04')
  // 18:30 UTC = exactly midnight in India.
  assert.equal(todayIST(new Date('2026-10-04T18:30:00Z')), '2026-10-05')
})

test('day arithmetic crosses months, years and leap days', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(addDays('2026-01-01', -1), '2025-12-31')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(addDays('2027-02-28', 1), '2027-03-01')
  assert.equal(isValidDate('2026-02-30'), false)
  assert.equal(isValidDate('2026-10-04'), true)
  assert.equal(isValidDate(''), false)
  assert.equal(formatDateLabel('2026-10-04'), 'Sun, 4 Oct 2026')
  assert.equal(formatDateLabel('2028-02-29'), 'Tue, 29 Feb 2028')
})

test('sleep duration handles midnight', () => {
  assert.deepEqual(sleepDuration('23:30', '07:00'), { kind: 'ok', minutes: 450 })
  assert.deepEqual(sleepDuration('01:00', '07:00'), { kind: 'ok', minutes: 360 })
  assert.deepEqual(sleepDuration('22:00', '22:01'), { kind: 'ok', minutes: 1 })
  assert.deepEqual(sleepDuration('07:00', '06:59'), { kind: 'ok', minutes: 1439 })
  assert.deepEqual(sleepDuration('23:30:00', '07:00:00'), { kind: 'ok', minutes: 450 })
  assert.deepEqual(sleepDuration('07:00', '07:00'), { kind: 'same' })
  assert.deepEqual(sleepDuration('', '07:00'), { kind: 'missing' })
  assert.equal(formatMinutes(450), '7 h 30 min')
  assert.equal(formatMinutes(480), '8 h')
  assert.equal(formatMinutes(45), '45 min')
})

test('blank fields are saved as "not answered" (null), never 0 or No', () => {
  const { errors, payload } = validateDayForm(EMPTY_FORM)
  assert.deepEqual(errors, {})
  assert.ok(payload)
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'fast_day') continue // a Yes/No toggle, never blank (checked below)
    assert.equal(value, null, `${key} should be null when blank`)
  }
})

test('fast day: a toggle that defaults to No and is saved as true/false', () => {
  assert.equal(validateDayForm(EMPTY_FORM).payload?.fast_day, false)
  assert.equal(validateDayForm({ ...EMPTY_FORM, fast_day: 'yes' }).payload?.fast_day, true)
})

test('junk meals: blank = null, 0 = 0', () => {
  assert.equal(validateDayForm({ ...EMPTY_FORM, junk_meals: '' }).payload?.junk_meals, null)
  assert.equal(validateDayForm({ ...EMPTY_FORM, junk_meals: '0' }).payload?.junk_meals, 0)
  assert.equal(validateDayForm({ ...EMPTY_FORM, junk_meals: '2' }).payload?.junk_meals, 2)
  assert.ok(validateDayForm({ ...EMPTY_FORM, junk_meals: '-1' }).errors.junk_meals)
  assert.ok(validateDayForm({ ...EMPTY_FORM, junk_meals: '21' }).errors.junk_meals)
  assert.ok(validateDayForm({ ...EMPTY_FORM, junk_meals: '1.5' }).errors.junk_meals)
})

test('yes / no / not answered are stored as true / false / null', () => {
  const { payload } = validateDayForm({ ...EMPTY_FORM, snoring: 'yes', gasping: 'no', porn: '' })
  assert.equal(payload?.snoring, true)
  assert.equal(payload?.gasping, false)
  assert.equal(payload?.porn, null)
})

test('weight: up to 1 decimal, comma accepted', () => {
  assert.equal(validateDayForm({ ...EMPTY_FORM, weight_kg: '82.4' }).payload?.weight_kg, 82.4)
  assert.equal(validateDayForm({ ...EMPTY_FORM, weight_kg: '82,4' }).payload?.weight_kg, 82.4)
  assert.equal(validateDayForm({ ...EMPTY_FORM, weight_kg: ' 82 ' }).payload?.weight_kg, 82)
  assert.match(validateDayForm({ ...EMPTY_FORM, weight_kg: '82.45' }).errors.weight_kg ?? '', /1 decimal/)
  assert.ok(validateDayForm({ ...EMPTY_FORM, weight_kg: '0' }).errors.weight_kg)
  assert.ok(validateDayForm({ ...EMPTY_FORM, weight_kg: '400' }).errors.weight_kg)
  assert.ok(validateDayForm({ ...EMPTY_FORM, weight_kg: 'abc' }).errors.weight_kg)
  assert.ok(validateDayForm({ ...EMPTY_FORM, weight_kg: '-5' }).errors.weight_kg)
})

test('ranges match the database rules', () => {
  const bad: [keyof typeof EMPTY_FORM, string][] = [
    ['sleep_quality', '6'], ['sleep_quality', '0'], ['stress', '11'], ['energy', '0'],
    ['nap_minutes', '721'], ['steps', '200001'], ['resting_pulse', '24'], ['resting_pulse', '251'],
    ['gaming_hours', '24.5'], ['gaming_hours', '1.555'],
  ]
  for (const [key, value] of bad) {
    assert.ok(validateDayForm({ ...EMPTY_FORM, [key]: value }).errors[key], `${key}=${value} should be rejected`)
  }
  const good: [keyof typeof EMPTY_FORM, string][] = [
    ['sleep_quality', '5'], ['stress', '10'], ['energy', '1'], ['nap_minutes', '0'],
    ['steps', '12000'], ['resting_pulse', '60'], ['gaming_hours', '1.25'], ['gaming_hours', '0'],
  ]
  for (const [key, value] of good) {
    assert.deepEqual(validateDayForm({ ...EMPTY_FORM, [key]: value }).errors, {}, `${key}=${value} should be accepted`)
  }
})

test('same bedtime and wake time is an error', () => {
  const { errors, payload } = validateDayForm({ ...EMPTY_FORM, bedtime: '07:00', wake_time: '07:00' })
  assert.ok(errors.wake_time)
  assert.equal(payload, null)
})

test('a saved row loads back into the same form', () => {
  const row: DayRow = {
    id: 'x', log_date: '2026-10-04', weight_kg: 82.4, bedtime: '23:30:00', wake_time: '07:00:00',
    sleep_minutes: 450, sleep_quality: 4, snoring: true, gasping: false, afternoon_sleepiness: null,
    nap_minutes: 20, steps: 9000, stress: 3, energy: 7, resting_pulse: 62, gaming_hours: 1.5,
    porn: false, naam_jaap: true, junk_meals: 0, confirmed_at: null,
  }
  const form = formFromRow(row)
  assert.equal(form.bedtime, '23:30')
  assert.equal(form.junk_meals, '0')
  assert.equal(form.afternoon_sleepiness, '')
  const again = validateDayForm(form).payload
  assert.ok(again)
  assert.equal(again.weight_kg, 82.4)
  assert.equal(again.junk_meals, 0)
  assert.equal(again.snoring, true)
  assert.equal(again.afternoon_sleepiness, null)
  assert.ok(formsEqual(form, formFromRow(row)))
  assert.ok(!formsEqual(form, { ...form, steps: '9001' }))
})
