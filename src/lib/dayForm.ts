// The once-a-day fields: form values, checks and conversion to/from the database.
// Every limit here mirrors a check in supabase/migrations/001_init.sql, so the
// app explains a problem in plain English before the database refuses it.
// Blank always means "not answered" and is stored as null, never as 0 or "No".

import { sleepDuration } from './sleep.ts'

export type TriState = '' | 'yes' | 'no'

export type DayForm = {
  weight_kg: string
  bedtime: string
  wake_time: string
  sleep_quality: string
  snoring: TriState
  gasping: TriState
  afternoon_sleepiness: TriState
  nap_minutes: string
  steps: string
  stress: string
  energy: string
  resting_pulse: string
  gaming_hours: string
  porn: TriState
  naam_jaap: TriState
  junk_meals: string
}

export type DayRow = {
  id: string
  log_date: string
  weight_kg: number | null
  bedtime: string | null
  wake_time: string | null
  sleep_minutes: number | null
  sleep_quality: number | null
  snoring: boolean | null
  gasping: boolean | null
  afternoon_sleepiness: boolean | null
  nap_minutes: number | null
  steps: number | null
  stress: number | null
  energy: number | null
  resting_pulse: number | null
  gaming_hours: number | null
  porn: boolean | null
  naam_jaap: boolean | null
  junk_meals: number | null
  confirmed_at: string | null
}

export type DayPayload = Omit<DayRow, 'id' | 'log_date' | 'sleep_minutes' | 'confirmed_at'>

export type FieldErrors = Partial<Record<keyof DayForm, string>>

export const EMPTY_FORM: DayForm = {
  weight_kg: '',
  bedtime: '',
  wake_time: '',
  sleep_quality: '',
  snoring: '',
  gasping: '',
  afternoon_sleepiness: '',
  nap_minutes: '',
  steps: '',
  stress: '',
  energy: '',
  resting_pulse: '',
  gaming_hours: '',
  porn: '',
  naam_jaap: '',
  junk_meals: '',
}

function numToText(value: number | null): string {
  return value === null ? '' : String(value)
}

function boolToTri(value: boolean | null): TriState {
  return value === null ? '' : value ? 'yes' : 'no'
}

function triToBool(value: TriState): boolean | null {
  return value === '' ? null : value === 'yes'
}

export function formFromRow(row: DayRow | null): DayForm {
  if (!row) return { ...EMPTY_FORM }
  return {
    weight_kg: numToText(row.weight_kg),
    bedtime: row.bedtime ? row.bedtime.slice(0, 5) : '',
    wake_time: row.wake_time ? row.wake_time.slice(0, 5) : '',
    sleep_quality: numToText(row.sleep_quality),
    snoring: boolToTri(row.snoring),
    gasping: boolToTri(row.gasping),
    afternoon_sleepiness: boolToTri(row.afternoon_sleepiness),
    nap_minutes: numToText(row.nap_minutes),
    steps: numToText(row.steps),
    stress: numToText(row.stress),
    energy: numToText(row.energy),
    resting_pulse: numToText(row.resting_pulse),
    gaming_hours: numToText(row.gaming_hours),
    porn: boolToTri(row.porn),
    naam_jaap: boolToTri(row.naam_jaap),
    junk_meals: numToText(row.junk_meals),
  }
}

export function formsEqual(a: DayForm, b: DayForm): boolean {
  return (Object.keys(a) as (keyof DayForm)[]).every((key) => a[key].trim() === b[key].trim())
}

// Whole number between min and max. Blank -> null.
function wholeNumber(
  text: string, min: number, max: number, label: string, errors: FieldErrors, key: keyof DayForm,
): number | null {
  const value = text.trim()
  if (value === '') return null
  if (!/^\d+$/.test(value)) {
    errors[key] = `${label} must be a whole number.`
    return null
  }
  const n = Number(value)
  if (n < min || n > max) {
    errors[key] = `${label} must be between ${min} and ${max}.`
    return null
  }
  return n
}

// Decimal number with at most `decimals` places, min < value <= max (or >= min when inclusive). Blank -> null.
function decimalNumber(
  text: string, decimals: number, min: number, max: number, minInclusive: boolean,
  label: string, unitHint: string, errors: FieldErrors, key: keyof DayForm,
): number | null {
  const value = text.trim().replace(',', '.')
  if (value === '') return null
  const pattern = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`)
  if (!/^\d+(\.\d+)?$/.test(value)) {
    errors[key] = `${label} must be a number${unitHint}.`
    return null
  }
  if (!pattern.test(value)) {
    errors[key] = `${label} can have at most ${decimals} decimal${decimals === 1 ? '' : 's'}.`
    return null
  }
  const n = Number(value)
  if ((minInclusive ? n < min : n <= min) || n > max) {
    errors[key] = `${label} must be ${minInclusive ? 'from' : 'above'} ${min} ${minInclusive ? 'to' : 'and at most'} ${max}${unitHint}.`
    return null
  }
  return n
}

export function validateDayForm(form: DayForm): { errors: FieldErrors; payload: DayPayload | null } {
  const errors: FieldErrors = {}

  const weight_kg = decimalNumber(form.weight_kg, 1, 0, 399.9, false, 'Weight', ' kg', errors, 'weight_kg')

  const bedtime = form.bedtime.trim() || null
  const wake_time = form.wake_time.trim() || null
  if (bedtime && wake_time && sleepDuration(bedtime, wake_time).kind === 'same') {
    errors.wake_time = 'Bedtime and wake time cannot be the same.'
  }

  const sleep_quality = wholeNumber(form.sleep_quality, 1, 5, 'Sleep quality', errors, 'sleep_quality')
  const nap_minutes = wholeNumber(form.nap_minutes, 0, 720, 'Nap minutes', errors, 'nap_minutes')
  const steps = wholeNumber(form.steps, 0, 200000, 'Steps', errors, 'steps')
  const stress = wholeNumber(form.stress, 1, 10, 'Stress', errors, 'stress')
  const energy = wholeNumber(form.energy, 1, 10, 'Energy', errors, 'energy')
  const resting_pulse = wholeNumber(form.resting_pulse, 25, 250, 'Resting pulse', errors, 'resting_pulse')
  const gaming_hours = decimalNumber(form.gaming_hours, 2, 0, 24, true, 'Gaming hours', ' hours', errors, 'gaming_hours')
  const junk_meals = wholeNumber(form.junk_meals, 0, 20, 'Junk meals', errors, 'junk_meals')

  if (Object.keys(errors).length > 0) return { errors, payload: null }

  return {
    errors,
    payload: {
      weight_kg,
      bedtime,
      wake_time,
      sleep_quality,
      snoring: triToBool(form.snoring),
      gasping: triToBool(form.gasping),
      afternoon_sleepiness: triToBool(form.afternoon_sleepiness),
      nap_minutes,
      steps,
      stress,
      energy,
      resting_pulse,
      gaming_hours,
      porn: triToBool(form.porn),
      naam_jaap: triToBool(form.naam_jaap),
      junk_meals,
    },
  }
}
