// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nowTimeIST } from '../src/lib/dates.ts'
import { EMPTY_FLUID_FORM, fluidTotals, kcalAllowed, sortByTime, validateFluidForm, type FluidRow } from '../src/lib/fluids.ts'
import { EMPTY_CARDIO_FORM, totalMinutes, validateCardioForm, type CardioRow } from '../src/lib/cardio.ts'

test('India clock time', () => {
  assert.equal(nowTimeIST(new Date('2026-10-04T20:00:00Z')), '01:30')
  assert.equal(nowTimeIST(new Date('2026-10-04T18:29:00Z')), '23:59')
  assert.equal(nowTimeIST(new Date('2026-10-04T18:30:00Z')), '00:00')
})

test('kcal only for maad water, sugary drink, other', () => {
  const allowed = ['maad_water', 'sugary_drink', 'other']
  for (const t of ['water', 'lemonade_stevia', 'lassi', 'maad_water', 'black_coffee', 'green_tea', 'milk', 'sugary_drink', 'other']) {
    assert.equal(kcalAllowed(t), allowed.includes(t), t)
  }
})

const water = { ...EMPTY_FLUID_FORM, drink_time: '08:15', drink_type: 'water' as const, ml: '250' }

test('drink checks', () => {
  assert.deepEqual(validateFluidForm(water).errors, {})
  const empty = validateFluidForm(EMPTY_FLUID_FORM).errors
  assert.ok(empty.drink_time && empty.drink_type && empty.ml)
  assert.ok(validateFluidForm({ ...water, ml: '0' }).errors.ml)
  assert.ok(validateFluidForm({ ...water, ml: '5001' }).errors.ml)
  assert.ok(validateFluidForm({ ...water, ml: '250.5' }).errors.ml)
  // kcal typed on water is ignored, never saved
  assert.equal(validateFluidForm({ ...water, kcal: '50' }).payload?.kcal, null)
  // kcal kept for sugary drink; blank stays unknown
  assert.equal(validateFluidForm({ ...water, drink_type: 'sugary_drink', kcal: '150' }).payload?.kcal, 150)
  assert.equal(validateFluidForm({ ...water, drink_type: 'sugary_drink', kcal: '' }).payload?.kcal, null)
  assert.ok(validateFluidForm({ ...water, drink_type: 'maad_water', kcal: 'x' }).errors.kcal)
})

test('drink description only for Other, trimmed, max 100', () => {
  assert.equal(validateFluidForm({ ...water, description: 'tap' }).payload?.description, null)
  assert.equal(validateFluidForm({ ...water, drink_type: 'other', description: '  coconut water ' }).payload?.description, 'coconut water')
  assert.equal(validateFluidForm({ ...water, drink_type: 'other', description: '   ' }).payload?.description, null)
  assert.ok(validateFluidForm({ ...water, drink_type: 'other', description: 'x'.repeat(101) }).errors.description)
})

const drink = (o: Partial<FluidRow>): FluidRow => ({
  id: 'x', day_id: 'd', drink_time: '08:00:00', drink_type: 'water', ml: 250, kcal: null, is_sugary: false, description: null, created_at: '2026-10-05T02:00:00Z', ...o,
})

test('fluid totals: all count to 4 L, sugary separate, unknown kcal counted', () => {
  const t = fluidTotals([
    drink({ ml: 500 }),
    drink({ drink_type: 'sugary_drink', ml: 300, kcal: 120, is_sugary: true }),
    drink({ drink_type: 'maad_water', ml: 200, kcal: null }),
    drink({ drink_type: 'lassi', ml: 200 }),
    drink({ drink_type: 'other', ml: 100, kcal: 20.5 }),
  ])
  assert.equal(t.totalMl, 1300)
  assert.equal(t.sugaryMl, 300)
  assert.equal(t.otherMl, 1000)
  assert.equal(t.kcalKnown, 140.5)
  assert.equal(t.kcalUnknownCount, 1) // maad water with blank kcal; lassi is not "unknown"
})

test('drinks sorted by time, then by entry order', () => {
  const sorted = sortByTime([
    drink({ id: 'c', drink_time: '21:00:00' }),
    drink({ id: 'b', drink_time: '08:00:00', created_at: '2026-10-05T03:00:00Z' }),
    drink({ id: 'a', drink_time: '08:00:00', created_at: '2026-10-05T02:00:00Z' }),
  ])
  assert.deepEqual(sorted.map((d) => d.id), ['a', 'b', 'c'])
})

test('cardio checks and total', () => {
  const ok = { ...EMPTY_CARDIO_FORM, cardio_type: 'brisk_walk' as const, minutes: '30', start_time: '06:45' }
  assert.deepEqual(validateCardioForm(ok).errors, {})
  const empty = validateCardioForm(EMPTY_CARDIO_FORM).errors
  assert.ok(empty.cardio_type && empty.minutes && empty.start_time)
  assert.ok(validateCardioForm({ ...ok, minutes: '0' }).errors.minutes)
  assert.ok(validateCardioForm({ ...ok, minutes: '1441' }).errors.minutes)
  assert.ok(validateCardioForm({ ...ok, minutes: '20.5' }).errors.minutes)
  assert.equal(validateCardioForm({ ...ok, description: 'park' }).payload?.description, null)
  assert.equal(validateCardioForm({ ...ok, cardio_type: 'other', description: 'badminton' }).payload?.description, 'badminton')
  const rows = [{ minutes: 30 }, { minutes: 15 }] as CardioRow[]
  assert.equal(totalMinutes(rows), 45)
})
