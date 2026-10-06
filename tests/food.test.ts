// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_FOOD_FORM, foodFormFromRow, foodTotals, formGrams, formatQuantity, formatTotal, formFromRecent, gramsFor,
  gramsPerUnitMemory, kcalLevel, memoryKey, recentFoods, scaledNutrients, validateFoodForm,
  type FoodForm, type FoodRow, type RecentFood,
} from '../src/lib/food.ts'

const valid: FoodForm = { ...EMPTY_FOOD_FORM, meal: 'lunch', food: 'Dal', amount: '60', weight_state: 'raw', kcal: '210' }

test('a minimal valid food: unknown nutrients stay null', () => {
  const { errors, payload } = validateFoodForm(valid)
  assert.deepEqual(errors, {})
  assert.equal(payload?.protein_g, null)
  assert.equal(payload?.fibre_total_g, null)
  assert.equal(payload !== null && 'data_source' in payload, false) // never sent (hidden field)
  assert.equal(payload?.is_hunger_addon, false)
})

test('required fields', () => {
  const { errors } = validateFoodForm(EMPTY_FOOD_FORM)
  for (const key of ['meal', 'food', 'amount', 'weight_state', 'kcal'] as const) {
    assert.ok(errors[key], `${key} should be required`)
  }
})

test('number checks', () => {
  assert.ok(validateFoodForm({ ...valid, amount: '0' }).errors.amount)
  assert.ok(validateFoodForm({ ...valid, amount: '5001' }).errors.amount)
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
  id: 'x', day_id: 'd', meal: 'lunch', food: 'Dal', weight_g: 60, amount: null, unit: null, grams_per_unit: null, weight_state: 'raw', kcal: 210,
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
  food: 'Dal', weight_g: 60, amount: null, unit: null, grams_per_unit: null, weight_state: 'raw', kcal: 210, protein_g: 14, carbs_g: 36, fat_g: 1,
  fibre_total_g: 6, fibre_soluble_g: 2, fibre_insoluble_g: 4, meal: 'lunch',
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
    const { errors } = validateFoodForm({ ...valid, amount: String(g), ...s })
    assert.equal(errors.fibre_total_g, undefined, `${g} g: total ${s.fibre_total_g}, parts ${s.fibre_soluble_g} + ${s.fibre_insoluble_g}`)
  }
})

test('quick-add form copies the last entry exactly at the same grams', () => {
  const f = formFromRecent(recent({ kcal: 210.5 }), 'dinner')
  assert.equal(f.meal, 'dinner')
  assert.equal(f.amount, '60')
  assert.equal(f.unit, 'g')
  assert.equal(f.kcal, '210.5')
  assert.equal(f.weight_state, 'raw')
  assert.equal(f.is_hunger_addon, false)
  assert.equal('data_source' in f, false) // hidden field: not copied to new entries
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
    const { errors } = validateFoodForm({ ...valid, amount: grams, ...s })
    // Only the sum rule matters here; absurd scale-ups may hit the normal maximums.
    assert.doesNotMatch(errors.fibre_total_g ?? '', /cannot be more than total/, `base ${JSON.stringify(base)} grams ${grams} -> ${JSON.stringify(s)}`)
    const t = Number(s.fibre_total_g || 0), parts = Number(s.fibre_soluble_g || 0) + Number(s.fibre_insoluble_g || 0)
    assert.ok(Math.round(parts * 100) <= Math.round(t * 100), `sum ${parts} > total ${t}`)
  }
})

// ---------- Food units ----------

test('grams from amount + unit are exact (no floating-point slips)', () => {
  assert.equal(gramsFor(3, 'piece', 33.33), 99.99)
  assert.equal(0.1 * 3 === 0.3, false) // plain JS gives 0.30000000000000004: the trap is real
  assert.equal(gramsFor(0.1, 'tsp', 3), 0.3)
  assert.equal(gramsFor(0.33, 'tsp', 3.33), 1.0989)
  assert.equal(gramsFor(250, 'ml', 1.03), 257.5)
  assert.equal(gramsFor(2, 'tbsp', 12.5), 25)
  assert.equal(gramsFor(500, 'mg', null), 0.5)
  assert.equal(gramsFor(5, 'mg', null), 0.005)
  assert.equal(gramsFor(150.5, 'g', null), 150.5)
  // Every amount and grams per unit with 2 decimals, in a broad sweep: always the exact decimal.
  for (let a = 1; a <= 1000; a += 7) {
    for (let g = 1; g <= 10000; g += 97) {
      // Independent reference: the exact product written out as a decimal string (a and g are hundredths).
      const digits = String(a * g).padStart(5, '0')
      const exact = Number(`${digits.slice(0, -4)}.${digits.slice(-4)}`)
      assert.equal(gramsFor(Number(`${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`), 'piece',
        Number(`${Math.floor(g / 100)}.${String(g % 100).padStart(2, '0')}`)), exact, `${a} x ${g} hundredths`)
    }
  }
})

test('form grams: null until amount and grams per unit are both valid', () => {
  const f = (amount: string, unit: FoodForm['unit'], grams_per_unit = '') => formGrams({ amount, unit, grams_per_unit })
  assert.equal(f('2', 'piece'), null)
  assert.equal(f('2', 'piece', '50'), 100)
  assert.equal(f('3', 'piece', '33,33'), 99.99) // comma decimal
  assert.equal(f('', 'g'), null)
  assert.equal(f('1.234', 'g'), null)
  assert.equal(f('400', 'mg'), 0.4)
})

test('units: validation and payload', () => {
  const v = (o: Partial<FoodForm>) => validateFoodForm({ ...valid, ...o })
  const egg = v({ amount: '2', unit: 'piece', grams_per_unit: '50' })
  assert.deepEqual(egg.errors, {})
  assert.deepEqual([egg.payload?.amount, egg.payload?.unit, egg.payload?.grams_per_unit, egg.payload?.weight_g], [2, 'piece', 50, 100])
  assert.equal(v({ amount: '2', unit: 'piece' }).errors.grams_per_unit, 'Grams per piece is required.')
  assert.equal(v({ amount: '1', unit: 'tbsp', grams_per_unit: '0' }).errors.grams_per_unit, 'Grams per tbsp must be more than 0 g.')
  assert.ok(v({ amount: '1', unit: 'tsp', grams_per_unit: '1.234' }).errors.grams_per_unit)
  assert.ok(v({ amount: '1', unit: 'ml', grams_per_unit: '1001' }).errors.grams_per_unit)
  const mg = v({ amount: '500', unit: 'mg', grams_per_unit: '' })
  assert.deepEqual([mg.payload?.weight_g, mg.payload?.grams_per_unit], [0.5, null])
  // g and mg never send grams per unit, even if one was left in the form.
  assert.equal(v({ amount: '40', unit: 'g', grams_per_unit: '9' }).payload?.grams_per_unit, null)
  assert.equal(v({ amount: '200', unit: 'piece', grams_per_unit: '30' }).errors.amount, 'That is 6,000 g. One entry can be at most 5,000 g.')
  assert.deepEqual(v({ amount: '100', unit: 'piece', grams_per_unit: '50' }).errors, {}) // exactly 5,000 g is fine
  assert.equal(v({ amount: '3', unit: 'piece', grams_per_unit: '33.33' }).payload?.weight_g, 99.99)
})

test('units: list text shows what was typed', () => {
  assert.equal(formatQuantity({ weight_g: 60, amount: null, unit: null }), '60 g') // old entry
  assert.equal(formatQuantity({ weight_g: 150.5, amount: 150.5, unit: 'g' }), '150.5 g')
  assert.equal(formatQuantity({ weight_g: 0.5, amount: 500, unit: 'mg' }), '500 mg')
  assert.equal(formatQuantity({ weight_g: 100, amount: 2, unit: 'piece' }), '2 piece (100 g)')
  assert.equal(formatQuantity({ weight_g: 1.0989, amount: 0.33, unit: 'tsp' }), '0.33 tsp (1.0989 g)')
  assert.equal(formatQuantity({ weight_g: 1500, amount: 1500, unit: 'ml' }), '1,500 ml (1,500 g)')
})

test('units: old entries open in the form as grams', () => {
  const f = foodFormFromRow(row({}))
  assert.deepEqual([f.amount, f.unit, f.grams_per_unit], ['60', 'g', ''])
  const egg = foodFormFromRow(row({ weight_g: 100, amount: 2, unit: 'piece', grams_per_unit: 50 }))
  assert.deepEqual([egg.amount, egg.unit, egg.grams_per_unit], ['2', 'piece', '50'])
})

test('units: grams per unit remembered per food + raw/cooked + unit, newest wins, never invented', () => {
  const mem = gramsPerUnitMemory([
    recent({ food: 'Egg', unit: 'piece', amount: 2, grams_per_unit: 48, created_at: '2026-10-01T08:00:00Z' }),
    recent({ food: 'egg ', unit: 'piece', amount: 1, grams_per_unit: 52, created_at: '2026-10-03T08:00:00Z' }),
    recent({ food: 'Egg', weight_state: 'cooked', unit: 'piece', amount: 1, grams_per_unit: 45 }),
    recent({ food: 'Chia', unit: 'tbsp', amount: 1, grams_per_unit: 12 }),
    recent({ food: 'Chia', unit: 'g', amount: 10 }),
    recent({ food: 'Milk' }), // old entry, no unit
  ])
  assert.equal(mem.get(memoryKey('EGG', 'raw', 'piece')), 52)
  assert.equal(mem.get(memoryKey('Egg', 'cooked', 'piece')), 45)
  assert.equal(mem.get(memoryKey('Chia', 'raw', 'tbsp')), 12)
  assert.equal(mem.get(memoryKey('Chia', 'raw', 'tsp')), undefined) // never guessed from tbsp
  assert.equal(mem.get(memoryKey('Milk', 'raw', 'ml')), undefined)
})

test('units: quick-add keeps the last unit and scales by grams', () => {
  const base = recent({ food: 'Egg', weight_g: 100, amount: 2, unit: 'piece', grams_per_unit: 50, kcal: 140, protein_g: 12 })
  const f = formFromRecent(base, 'breakfast')
  assert.deepEqual([f.amount, f.unit, f.grams_per_unit, f.kcal], ['2', 'piece', '50', '140'])
  const three = scaledNutrients(base, String(formGrams({ ...f, amount: '3' })))!
  assert.deepEqual([three.kcal, three.protein_g], ['210', '18'])
})
