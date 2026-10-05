// Cardio sessions: types, checks and totals. Limits mirror supabase/migrations/001 and 003.

export const CARDIO_TYPES = [
  { value: 'walk', label: 'Walk' },
  { value: 'brisk_walk', label: 'Brisk walk' },
  { value: 'run', label: 'Run' },
  { value: 'cycle', label: 'Cycle' },
  { value: 'swim', label: 'Swim' },
  { value: 'skipping', label: 'Skipping' },
  { value: 'stairs', label: 'Stairs' },
  { value: 'other', label: 'Other' },
] as const

export type CardioType = (typeof CARDIO_TYPES)[number]['value']
export const cardioLabel = (type: string) => CARDIO_TYPES.find((t) => t.value === type)?.label ?? type

export type CardioRow = {
  id: string
  day_id: string
  cardio_type: CardioType
  minutes: number
  start_time: string
  description: string | null
  created_at: string
}

export type CardioForm = { cardio_type: CardioType | ''; minutes: string; start_time: string; description: string }
export type CardioPayload = Pick<CardioRow, 'cardio_type' | 'minutes' | 'start_time' | 'description'>
export type CardioErrors = Partial<Record<keyof CardioForm, string>>

export const EMPTY_CARDIO_FORM: CardioForm = { cardio_type: '', minutes: '', start_time: '', description: '' }

export function cardioFormFromRow(row: CardioRow): CardioForm {
  return {
    cardio_type: row.cardio_type,
    minutes: String(row.minutes),
    start_time: row.start_time.slice(0, 5),
    description: row.description ?? '',
  }
}

export function cardioFormsEqual(a: CardioForm, b: CardioForm): boolean {
  return (Object.keys(a) as (keyof CardioForm)[]).every((k) => a[k].trim() === b[k].trim())
}

export function validateCardioForm(form: CardioForm): { errors: CardioErrors; payload: CardioPayload | null } {
  const errors: CardioErrors = {}
  if (!form.cardio_type) errors.cardio_type = 'Choose a type.'
  const m = form.minutes.trim()
  let minutes: number | null = null
  if (m === '') errors.minutes = 'Enter the minutes.'
  else if (!/^\d+$/.test(m)) errors.minutes = 'Minutes must be a whole number.'
  else if (Number(m) < 1 || Number(m) > 1440) errors.minutes = 'Minutes must be between 1 and 1440.'
  else minutes = Number(m)
  if (!/^\d{2}:\d{2}$/.test(form.start_time.trim())) errors.start_time = 'Enter the start time.'

  let description: string | null = null
  if (form.cardio_type === 'other') {
    const d = form.description.trim()
    if (d.length > 100) errors.description = 'Description can be at most 100 characters.'
    else description = d || null
  }

  if (Object.keys(errors).length > 0) return { errors, payload: null }
  return { errors, payload: { cardio_type: form.cardio_type as CardioType, minutes: minutes!, start_time: form.start_time.trim(), description } }
}

export function totalMinutes(rows: CardioRow[]): number {
  return rows.reduce((sum, r) => sum + r.minutes, 0)
}
