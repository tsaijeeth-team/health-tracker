// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_FOOD_FORM, foodTotals, formatTotal, formFromRecent, kcalLevel, recentFoods,
  scaledNutrients, validateFoodForm, type FoodForm, type FoodRow, type RecentFood,
} from '../src/lib/food.ts'

const valid: FoodForm = { ...EMPTY_FOOD_FORM, meal: 'lunch', food: 'Dal', weight_g: '60', weight_state: 'raw', kcal: '210' }

test('a minimal valid food: unknown nutrients stay null', () => {
  const { errors, payload } = validateFoodForm(valid)
  assert.deepEqual(errors, {})
  assert.equal(payload?.protein_g, null)
  assert.equal(payload?.fibre_total_g, null)
  assert.equal(payload?.data_source, null)
  assert.equal(payload?.is_hunger_addon, false)
})

test('required fields', () => {
  const { errors } = validateFoodForm(EMPTY_FOOD_FORM)
  for (const key of ['meal', 'food', 'weight_g', 'weight_state', 'kcal'] as const) {
    assert.ok(errors[key], `${key} should be required`)
  }
})

test('number checks', () => {
  assert.ok(validateFoodForm({ ...valid, weight_g: '0' }).errors.weight_g)
  assert.ok(validateFoodForm({ ...valid, weight_g: '5001' }).errors.weight_g)
  assert.ok(validateFoodForm({ ...valid, kcal: '-1' }).errors.kcal)
  assert.ok(validateFoodForm({ ...valid, protein_g: '1.234' }).errors.protein_g)
  assert.ok(validateFoodForm({ ...valid, fat_g: 'abc' }).errors.fat_g)
  assert.equal(validateFoodForm({ ...valid, kcal: '0' }).payload?.kcal, 0)
  assert.equal(validateFoodForm({ ...valid, protein_g: '12,5' }).payload?.protein_g, 12.5)
})

test('fibre: soluble + insoluble must not exceed total', () => {
  const f = (t: string, s: string, i: string) => validateFoodForm({ ...valid, fibre_total_g: t, fibre_soluble_g: s, fibre_insoluble_g: i })
  assert.match(f('4', '2', '2.5').errors.fibre_total_g ?? '', /cannot be more than total/)
  assert.deepEqual(f('4', '1.5', '2.5').errors, {}) // exactly equal is fine
  assert.deepEqual(f('0.3', '0.1', '0.2').errors, {}) // no floating-point false alarm
  assert.match(f('4', '5', '').errors.fibre_total_g ?? '', /cannot be more than total/)
  assert.deepEqual(f('', '1', '2').errors, {}) // no total -> rule does not apply
  assert.deepEqual(f('4', '', '').errors, {})
})

const row = (o: Partial<FoodRow>): FoodRow => ({
  id: 'x', day_id: 'd', meal: 'lunch', food: 'Dal', weight_g: 60, weight_state: 'raw', kcal: 210,
  protein_g: 14, carbs_g: 36, fat_g: 1, fibre_total_g: 6, fibre_soluble_g: 2, fibre_insoluble_g: 4,
  is_hunger_addon: false, data_source: 'ifct', created_at: '2026-10-01T08:00:00Z', ...o,
})

test('totals: unknowns are counted, never treated as 0', () => {
  const t = foodTotals([row({}), row({ kcal: 100, protein_g: null, fibre_total_g: null, is_hunger_addon: true }), row({ kcal: 50.5, protein_g: null })])
  assert.equal(t.kcal.known, 360.5)
  assert.equal(t.kcal.unknownCount, 0)
  assert.equal(t.protein_g.known, 14)
  assert.equal(t.protein_g.unknownCount, 2)
  assert.equal(t.hungerAddonKcal, 100)
  assert.equal(formatTotal(t.protein_g, ' g'), 'at least 14 g (2 items unknown)')
  assert.equal(formatTotal(t.carbs_g, ' g'), '108 g')
  assert.equal(formatTotal(t.fibre_total_g, ' g'), 'at least 12 g (1 item unknown)')
})

test('calorie bar colours', () => {
  assert.equal(kcalLevel(0), 'green')
  assert.equal(kcalLevel(1799), 'green')
  assert.equal(kcalLevel(1800), 'amber')
  assert.equal(kcalLevel(2000), 'amber')
  assert.equal(kcalLevel(2001), 'red')
})

const recent = (o: Partial<RecentFood>): RecentFood => ({
  food: 'Dal', weight_g: 60, weight_state: 'raw', kcal: 210, protein_g: 14, carbs_g: 36, fat_g: 1,
  fibre_total_g: 6, fibre_soluble_g: 2, fibre_insoluble_g: 4, data_source: 'ifct', meal: 'lunch',
  created_at: '2026-10-01T08:00:00Z', ...o,
})

test('recent foods: newest entry per food + raw/cooked', () => {
  const list = recentFoods([
    recent({ created_at: '2026-10-01T08:00:00Z', kcal: 200 }),
    recent({ created_at: '2026-10-03T08:00:00Z', kcal: 210 }),
    recent({ food: ' dal ', weight_state: 'cooked', created_at: '2026-10-02T08:00:00Z' }),
    recent({ food: 'Rice', weight_state: 'cooked', created_at: '2026-09-01T08:00:00Z' }),
  ])
  assert.equal(list.length, 3)
  assert.equal(list[0].kcal, 210) // newest raw dal wins
  assert.equal(list[0].weight_state, 'raw')
  assert.equal(list[1].weight_state, 'cooked')
  assert.equal(list[2].food, 'Rice')
})

test('scaling is proportional; unknowns stay unknown; rounding', () => {
  const base = recent({ protein_g: null })
  const s = scaledNutrients(base, '90')! // 1.5x
  assert.equal(s.kcal, '315')
  assert.equal(s.protein_g, '')
  assert.equal(s.carbs_g, '54')
  assert.equal(s.fibre_total_g, '9')
  assert.equal(s.fibre_soluble_g, '3')
  const odd = scaledNutrients(recent({ kcal: 210, fat_g: 1 }), '65')! // 65/60
  assert.equal(odd.kcal, '228') // 227.5 -> 228
  assert.equal(odd.fat_g, '1.1') // 1.083 -> 1.1
  assert.equal(scaledNutrients(base, ''), null)
  assert.equal(scaledNutrients(base, '0'), null)
  assert.equal(scaledNutrients(base, 'abc'), null)
})

test('scaled fibre parts never exceed scaled total after rounding', () => {
  // Rounding each part separately could push the sum above the total; check a spread of weights.
  const base = recent({ weight_g: 100, fibre_total_g: 3.3, fibre_soluble_g: 1.65, fibre_insoluble_g: 1.65 })
  for (let g = 1; g <= 500; g++) {
    const s = scaledNutrients(base, String(g))!
    const { errors } = validateFoodForm({ ...valid, weight_g: String(g), ...s })
    assert.equal(errors.fibre_total_g, undefined, `${g} g: total ${s.fibre_total_g}, parts ${s.fibre_soluble_g} + ${s.fibre_insoluble_g}`)
  }
})

test('quick-add form copies the last entry exactly at the same grams', () => {
  const f = formFromRecent(recent({ kcal: 210.5 }), 'dinner')
  assert.equal(f.meal, 'dinner')
  assert.equal(f.weight_g, '60')
  assert.equal(f.kcal, '210.5')
  assert.equal(f.weight_state, 'raw')
  assert.equal(f.is_hunger_addon, false)
  assert.equal(f.data_source, 'ifct')
})

test('fibre rule holds for many random foods and weights after scaling', () => {
  let seed = 42
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let n = 0; n < 20000; n++) {
    const total = Math.round(rand() * 200) / 10 // 0 – 20 g, 1 decimal
    const sol = Math.round(rand() * total * 10) / 10
    const insol = Math.round(rand() * (total - sol) * 10) / 10
    const base = recent({ weight_g: 1 + Math.round(rand() * 400), fibre_total_g: total, fibre_soluble_g: sol, fibre_insoluble_g: insol })
    const grams = String(1 + Math.round(rand() * 600))
    const s = scaledNutrients(base, grams)!
    const { errors } = validateFoodForm({ ...valid, weight_g: grams, ...s })
    // Only the sum rule matters here; absurd scale-ups may hit the normal maximums.
    assert.doesNotMatch(errors.fibre_total_g ?? '', /cannot be more than total/, `base ${JSON.stringify(base)} grams ${grams} -> ${JSON.stringify(s)}`)
    const t = Number(s.fibre_total_g || 0), parts = Number(s.fibre_soluble_g || 0) + Number(s.fibre_insoluble_g || 0)
    assert.ok(Math.round(parts * 100) <= Math.round(t * 100), `sum ${parts} > total ${t}`)
  }
})
