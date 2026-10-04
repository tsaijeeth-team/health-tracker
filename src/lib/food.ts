// Food items: form values, checks, totals, the calorie bar and recent-food scaling.
// Limits mirror supabase/migrations/001_init.sql and 002_fibre_sum.sql.
// Blank nutrient = unknown. Unknowns are never treated as 0 in totals.

export const KCAL_CAP = 2000
export const KCAL_AMBER_FROM = 1800 // 90% of the cap

export const MEALS = [
  { value: 'wake_up', label: 'Wake-up' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'snack', label: 'Snack' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'pre_sleep', label: 'Pre-sleep' },
  { value: 'other', label: 'Other' },
] as const

export const DATA_SOURCES = [
  { value: 'label', label: 'Label' },
  { value: 'ifct', label: 'IFCT' },
  { value: 'usda', label: 'USDA' },
  { value: 'research', label: 'Research' },
  { value: 'other', label: 'Other' },
] as const

export type Meal = (typeof MEALS)[number]['value']
export type DataSource = (typeof DATA_SOURCES)[number]['value']
export type WeightState = 'raw' | 'cooked'

export type FoodRow = {
  id: string
  day_id: string
  meal: Meal
  food: string
  weight_g: number
  weight_state: WeightState
  kcal: number
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fibre_total_g: number | null
  fibre_soluble_g: number | null
  fibre_insoluble_g: number | null
  is_hunger_addon: boolean
  data_source: DataSource | null
  created_at: string
}

export type FoodForm = {
  meal: Meal | ''
  food: string
  weight_g: string
  weight_state: WeightState | ''
  kcal: string
  protein_g: string
  carbs_g: string
  fat_g: string
  fibre_total_g: string
  fibre_soluble_g: string
  fibre_insoluble_g: string
  is_hunger_addon: boolean
  data_source: DataSource | ''
}

export type FoodPayload = Omit<FoodRow, 'id' | 'day_id' | 'created_at'>
export type FoodErrors = Partial<Record<keyof FoodForm, string>>

export const NUTRIENT_KEYS = [
  'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fibre_total_g', 'fibre_soluble_g', 'fibre_insoluble_g',
] as const
export type NutrientKey = (typeof NUTRIENT_KEYS)[number]

export const EMPTY_FOOD_FORM: FoodForm = {
  meal: '',
  food: '',
  weight_g: '',
  weight_state: '',
  kcal: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
  fibre_total_g: '',
  fibre_soluble_g: '',
  fibre_insoluble_g: '',
  is_hunger_addon: false,
  data_source: '',
}

const text = (n: number | null) => (n === null ? '' : String(n))

export function foodFormFromRow(row: FoodRow): FoodForm {
  return {
    meal: row.meal,
    food: row.food,
    weight_g: text(row.weight_g),
    weight_state: row.weight_state,
    kcal: text(row.kcal),
    protein_g: text(row.protein_g),
    carbs_g: text(row.carbs_g),
    fat_g: text(row.fat_g),
    fibre_total_g: text(row.fibre_total_g),
    fibre_soluble_g: text(row.fibre_soluble_g),
    fibre_insoluble_g: text(row.fibre_insoluble_g),
    is_hunger_addon: row.is_hunger_addon,
    data_source: row.data_source ?? '',
  }
}

export function foodFormIsEmpty(form: FoodForm): boolean {
  return (Object.keys(EMPTY_FOOD_FORM) as (keyof FoodForm)[]).every((k) => form[k] === EMPTY_FOOD_FORM[k])
}

export function foodFormsEqual(a: FoodForm, b: FoodForm): boolean {
  return (Object.keys(a) as (keyof FoodForm)[]).every((k) =>
    typeof a[k] === 'string' ? (a[k] as string).trim() === (b[k] as string).trim() : a[k] === b[k])
}

// Non-negative number with up to 2 decimals, at most max. Blank -> null.
function amount(
  value: string, max: number, label: string, unit: string, errors: FoodErrors, key: keyof FoodForm,
  options: { required?: boolean; aboveZero?: boolean } = {},
): number | null {
  const v = value.trim().replace(',', '.')
  if (v === '') {
    if (options.required) errors[key] = `${label} is required.`
    return null
  }
  if (!/^\d+(\.\d+)?$/.test(v)) {
    errors[key] = `${label} must be a number${unit}.`
    return null
  }
  if (!/^\d+(\.\d{1,2})?$/.test(v)) {
    errors[key] = `${label} can have at most 2 decimals.`
    return null
  }
  const n = Number(v)
  if (options.aboveZero && n <= 0) {
    errors[key] = `${label} must be more than 0${unit}.`
    return null
  }
  if (n > max) {
    errors[key] = `${label} must be at most ${max}${unit}.`
    return null
  }
  return n
}

export function validateFoodForm(form: FoodForm): { errors: FoodErrors; payload: FoodPayload | null } {
  const errors: FoodErrors = {}
  if (!form.meal) errors.meal = 'Choose a meal.'
  const food = form.food.trim()
  if (!food) errors.food = 'Enter the food name.'
  else if (food.length > 200) errors.food = 'Food name can be at most 200 characters.'
  const weight_g = amount(form.weight_g, 5000, 'Weight', ' g', errors, 'weight_g', { required: true, aboveZero: true })
  if (!form.weight_state) errors.weight_state = 'Choose raw or cooked.'
  const kcal = amount(form.kcal, 10000, 'Calories', ' kcal', errors, 'kcal', { required: true })
  const protein_g = amount(form.protein_g, 1000, 'Protein', ' g', errors, 'protein_g')
  const carbs_g = amount(form.carbs_g, 1000, 'Carbs', ' g', errors, 'carbs_g')
  const fat_g = amount(form.fat_g, 1000, 'Fat', ' g', errors, 'fat_g')
  const fibre_total_g = amount(form.fibre_total_g, 500, 'Total fibre', ' g', errors, 'fibre_total_g')
  const fibre_soluble_g = amount(form.fibre_soluble_g, 500, 'Soluble fibre', ' g', errors, 'fibre_soluble_g')
  const fibre_insoluble_g = amount(form.fibre_insoluble_g, 500, 'Insoluble fibre', ' g', errors, 'fibre_insoluble_g')

  if (fibre_total_g !== null && !errors.fibre_soluble_g && !errors.fibre_insoluble_g) {
    const parts = (fibre_soluble_g ?? 0) + (fibre_insoluble_g ?? 0)
    // Compare in hundredths to avoid floating-point rounding (e.g. 0.1 + 0.2).
    if (Math.round(parts * 100) > Math.round(fibre_total_g * 100)) {
      errors.fibre_total_g = 'Soluble + insoluble fibre cannot be more than total fibre.'
    }
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null }
  return {
    errors,
    payload: {
      meal: form.meal as Meal,
      food,
      weight_g: weight_g!,
      weight_state: form.weight_state as WeightState,
      kcal: kcal!,
      protein_g,
      carbs_g,
      fat_g,
      fibre_total_g,
      fibre_soluble_g,
      fibre_insoluble_g,
      is_hunger_addon: form.is_hunger_addon,
      data_source: form.data_source || null,
    },
  }
}

// ---------- Totals ----------

export type NutrientTotal = { known: number; unknownCount: number }
export type FoodTotals = Record<NutrientKey, NutrientTotal> & { hungerAddonKcal: number; itemCount: number }

const round2 = (n: number) => Math.round(n * 100) / 100

export function foodTotals(items: FoodRow[]): FoodTotals {
  const totals = Object.fromEntries(
    NUTRIENT_KEYS.map((k) => [k, { known: 0, unknownCount: 0 }]),
  ) as Record<NutrientKey, NutrientTotal>
  let hungerAddonKcal = 0
  for (const item of items) {
    for (const k of NUTRIENT_KEYS) {
      const v = item[k]
      if (v === null) totals[k].unknownCount += 1
      else totals[k].known = round2(totals[k].known + Number(v))
    }
    if (item.is_hunger_addon) hungerAddonKcal = round2(hungerAddonKcal + Number(item.kcal))
  }
  return { ...totals, hungerAddonKcal, itemCount: items.length }
}

// e.g. { known: 54, unknownCount: 2 } -> "at least 54 g (2 items unknown)"
export function formatTotal(total: NutrientTotal, unit: string): string {
  const value = `${formatNumber(total.known)}${unit}`
  if (total.unknownCount === 0) return value
  return `at least ${value} (${total.unknownCount} item${total.unknownCount === 1 ? '' : 's'} unknown)`
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n)
}

// ---------- Calorie bar ----------

export type KcalLevel = 'green' | 'amber' | 'red'

export function kcalLevel(total: number): KcalLevel {
  if (total > KCAL_CAP) return 'red'
  if (total >= KCAL_AMBER_FROM) return 'amber'
  return 'green'
}

// ---------- Recent foods ----------

export type RecentFood = Pick<
  FoodRow,
  'food' | 'weight_g' | 'weight_state' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'
  | 'fibre_total_g' | 'fibre_soluble_g' | 'fibre_insoluble_g' | 'data_source' | 'meal' | 'created_at'
>

const recentKey = (food: string, state: WeightState) => `${food.trim().toLowerCase()}|${state}`

// Newest entry per (food name, raw/cooked). Input may be in any order.
export function recentFoods(rows: RecentFood[]): RecentFood[] {
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const seen = new Map<string, RecentFood>()
  for (const row of sorted) {
    const key = recentKey(row.food, row.weight_state)
    if (!seen.has(key)) seen.set(key, row)
  }
  return [...seen.values()]
}

// Rounds half up, immune to floating-point slips like 227.49999 for 227.5.
function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(Number((n * f).toPrecision(12))) / f
}

function floorTo(n: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.floor(Number((n * f).toPrecision(12))) / f
}

// Nutrient values for `grams` of `base`, scaled proportionally. null if grams isn't a valid amount.
// Rounding: kcal to whole numbers, everything else to 1 decimal. Unknown stays unknown.
export function scaledNutrients(base: RecentFood, grams: string): Record<NutrientKey, string> | null {
  const g = Number(grams.trim().replace(',', '.'))
  const baseG = Number(base.weight_g)
  if (!grams.trim() || !Number.isFinite(g) || g <= 0 || baseG <= 0) return null
  const same = g === baseG // same grams: copy exactly
  const scale = (v: number | null, decimals: number) =>
    v === null ? null : same ? Number(v) : roundTo((Number(v) * g) / baseG, decimals)

  const result: Record<NutrientKey, number | null> = {
    kcal: scale(base.kcal, 0),
    protein_g: scale(base.protein_g, 1),
    carbs_g: scale(base.carbs_g, 1),
    fat_g: scale(base.fat_g, 1),
    fibre_total_g: scale(base.fibre_total_g, 1),
    fibre_soluble_g: scale(base.fibre_soluble_g, 1),
    fibre_insoluble_g: scale(base.fibre_insoluble_g, 1),
  }

  // Rounding the parts separately can push soluble + insoluble just above the total.
  // Then round the parts down instead: never invents fibre, always fits the total.
  const total = result.fibre_total_g
  if (!same && total !== null) {
    const parts = (result.fibre_soluble_g ?? 0) + (result.fibre_insoluble_g ?? 0)
    if (roundTo(parts, 1) > total) {
      const exact = (v: number | null) => (v === null ? null : (Number(v) * g) / baseG)
      const sol = exact(base.fibre_soluble_g)
      const insol = exact(base.fibre_insoluble_g)
      result.fibre_soluble_g = sol === null ? null : floorTo(sol, 1)
      result.fibre_insoluble_g = insol === null ? null : floorTo(insol, 1)
    }
  }

  return Object.fromEntries(
    NUTRIENT_KEYS.map((k) => [k, result[k] === null ? '' : String(result[k])]),
  ) as Record<NutrientKey, string>
}

// A new form pre-filled from a recent food at its last weight.
export function formFromRecent(base: RecentFood, meal: Meal | ''): FoodForm {
  const nutrients = scaledNutrients(base, String(base.weight_g))!
  return {
    ...EMPTY_FOOD_FORM,
    ...nutrients,
    meal,
    food: base.food,
    weight_g: String(base.weight_g),
    weight_state: base.weight_state,
    data_source: base.data_source ?? '',
  }
}
