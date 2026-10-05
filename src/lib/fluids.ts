// Drinks: types, checks and totals. Limits mirror supabase/migrations/001 and 003.

export const FLUID_TARGET_ML = 4000

export const FLUID_TYPES = [
  { value: 'water', label: 'Water', kcal: false },
  { value: 'lemonade_stevia', label: 'Lemonade (stevia)', kcal: false },
  { value: 'lassi', label: 'Lassi', kcal: false },
  { value: 'maad_water', label: 'Maad water', kcal: true },
  { value: 'black_coffee', label: 'Black coffee', kcal: false },
  { value: 'green_tea', label: 'Green tea', kcal: false },
  { value: 'milk', label: 'Milk', kcal: false },
  { value: 'sugary_drink', label: 'Sugary drink', kcal: true },
  { value: 'other', label: 'Other', kcal: true },
] as const

export type FluidType = (typeof FLUID_TYPES)[number]['value']

export const fluidLabel = (type: string) => FLUID_TYPES.find((t) => t.value === type)?.label ?? type
export const kcalAllowed = (type: string) => FLUID_TYPES.some((t) => t.value === type && t.kcal)

export type FluidRow = {
  id: string
  day_id: string
  drink_time: string
  drink_type: FluidType
  ml: number
  kcal: number | null
  is_sugary: boolean
  description: string | null
  created_at: string
}

export type FluidForm = {
  drink_time: string
  drink_type: FluidType | ''
  ml: string
  kcal: string
  description: string
}

export type FluidPayload = Pick<FluidRow, 'drink_time' | 'drink_type' | 'ml' | 'kcal' | 'description'>
export type FluidErrors = Partial<Record<keyof FluidForm, string>>

export const EMPTY_FLUID_FORM: FluidForm = { drink_time: '', drink_type: '', ml: '', kcal: '', description: '' }

export function fluidFormFromRow(row: FluidRow): FluidForm {
  return {
    drink_time: row.drink_time.slice(0, 5),
    drink_type: row.drink_type,
    ml: String(row.ml),
    kcal: row.kcal === null ? '' : String(row.kcal),
    description: row.description ?? '',
  }
}

export function fluidFormsEqual(a: FluidForm, b: FluidForm): boolean {
  return (Object.keys(a) as (keyof FluidForm)[]).every((k) => a[k].trim() === b[k].trim())
}

export function validateFluidForm(form: FluidForm): { errors: FluidErrors; payload: FluidPayload | null } {
  const errors: FluidErrors = {}
  if (!/^\d{2}:\d{2}$/.test(form.drink_time.trim())) errors.drink_time = 'Enter the time.'
  if (!form.drink_type) errors.drink_type = 'Choose a drink type.'

  const mlText = form.ml.trim()
  let ml: number | null = null
  if (mlText === '') errors.ml = 'Enter the amount in ml.'
  else if (!/^\d+$/.test(mlText)) errors.ml = 'Amount must be a whole number of ml.'
  else if (Number(mlText) < 1 || Number(mlText) > 5000) errors.ml = 'Amount must be between 1 and 5000 ml.'
  else ml = Number(mlText)

  // kcal is only kept for types that may carry it; for other types it is ignored.
  let kcal: number | null = null
  const kcalText = form.kcal.trim().replace(',', '.')
  if (form.drink_type && kcalAllowed(form.drink_type) && kcalText !== '') {
    if (!/^\d+(\.\d{1,2})?$/.test(kcalText)) errors.kcal = 'Calories must be a number with at most 2 decimals.'
    else if (Number(kcalText) > 5000) errors.kcal = 'Calories must be at most 5000.'
    else kcal = Number(kcalText)
  }

  let description: string | null = null
  if (form.drink_type === 'other') {
    const d = form.description.trim()
    if (d.length > 100) errors.description = 'Description can be at most 100 characters.'
    else description = d || null
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null }
  return { errors, payload: { drink_time: form.drink_time.trim(), drink_type: form.drink_type as FluidType, ml: ml!, kcal, description } }
}

export type FluidTotals = {
  totalMl: number
  sugaryMl: number
  otherMl: number
  kcalKnown: number
  kcalUnknownCount: number // drinks that could have kcal but it was left blank
}

export function fluidTotals(rows: FluidRow[]): FluidTotals {
  const t: FluidTotals = { totalMl: 0, sugaryMl: 0, otherMl: 0, kcalKnown: 0, kcalUnknownCount: 0 }
  for (const r of rows) {
    t.totalMl += r.ml
    if (r.drink_type === 'sugary_drink') t.sugaryMl += r.ml
    else t.otherMl += r.ml
    if (r.kcal !== null) t.kcalKnown = Math.round((t.kcalKnown + Number(r.kcal)) * 100) / 100
    else if (kcalAllowed(r.drink_type)) t.kcalUnknownCount += 1
  }
  return t
}

export function sortByTime<T extends { drink_time?: string; start_time?: string; created_at: string }>(rows: T[]): T[] {
  const key = (r: T) => `${(r.drink_time ?? r.start_time ?? '').slice(0, 5)}|${r.created_at}`
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)))
}
