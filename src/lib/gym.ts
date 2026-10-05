// Gym log: muscle groups, set checks and the progress maths.
// Rules agreed with the owner (PLAN.md, step 12):
// - e1RM: Epley, weight × (1 + reps ÷ 30), only from sets with ≤ 10 reps; a 1-rep set's e1RM is its weight;
//   0 kg sets give no e1RM; the session's e1RM is the best eligible set; no eligible set = no point (gap).
// - Top set: heaviest weight; ties go to more reps.
// - Volume: sum of reps × weight. Total reps: sum of reps (charted for bodyweight exercises).

export const MUSCLE_GROUPS = [
  { value: 'chest', label: 'Chest' },
  { value: 'back', label: 'Back' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'arms', label: 'Arms' },
  { value: 'legs', label: 'Legs' },
  { value: 'core', label: 'Core' },
] as const
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]['value']

export const E1RM_MAX_REPS = 10
export const MAX_KG = 500
export const MAX_REPS = 100
export const MAX_NAME = 60

export type GymSet = { reps: number; weight_kg: number }

const round1 = (n: number) => Math.round(Number((n * 10).toPrecision(12))) / 10

export function e1rm(set: GymSet): number | null {
  const w = Number(set.weight_kg)
  if (w <= 0 || set.reps < 1 || set.reps > E1RM_MAX_REPS) return null
  if (set.reps === 1) return w
  return round1(w * (1 + set.reps / 30))
}

export type SessionStats = {
  topSet: GymSet | null
  volume: number
  e1rm: number | null
  totalReps: number
  setCount: number
  bodyweightOnly: boolean
}

export function sessionStats(sets: GymSet[]): SessionStats {
  let topSet: GymSet | null = null
  let volume = 0
  let best: number | null = null
  let totalReps = 0
  for (const s of sets) {
    const w = Number(s.weight_kg)
    if (!topSet || w > Number(topSet.weight_kg) || (w === Number(topSet.weight_kg) && s.reps > topSet.reps)) topSet = { reps: s.reps, weight_kg: w }
    volume += s.reps * w
    totalReps += s.reps
    const e = e1rm(s)
    if (e !== null && (best === null || e > best)) best = e
  }
  return {
    topSet,
    volume: Math.round(volume * 100) / 100,
    e1rm: best,
    totalReps,
    setCount: sets.length,
    bodyweightOnly: sets.length > 0 && sets.every((s) => Number(s.weight_kg) === 0),
  }
}

// ---------- Exercise names: no near-duplicates ----------

// Same rule as the database: trimmed, single-spaced, lower-case.
export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
export const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ')

export function findExercise<T extends { name: string }>(list: T[], typed: string): T | undefined {
  const key = nameKey(typed)
  return list.find((e) => nameKey(e.name) === key)
}

// Checks a new or changed exercise name against the owner's list. null = fine.
// selfId: the exercise being renamed (its own name never counts as a duplicate).
export function exerciseNameError(typed: string, list: { id: string; name: string }[], selfId?: string): string | null {
  const name = cleanName(typed)
  if (!name) return 'Enter a name.'
  if (name.length > MAX_NAME) return `An exercise name can be at most ${MAX_NAME} characters.`
  const clash = list.find((e) => e.id !== selfId && nameKey(e.name) === nameKey(name))
  if (clash) return `"${clash.name}" is already in your list.`
  return null
}

// Once an exercise is used on a confirmed day its name can no longer change (database rule).
export const LOCKED_MESSAGE = 'Used on a confirmed day — locked'

// "Used in 3 sessions — rename instead." The database gives the same answer.
export const usedMessage = (sessions: number) =>
  `Used in ${sessions} session${sessions === 1 ? '' : 's'} — rename instead.`

// ---------- Form checks ----------

export type SetForm = { reps: string; weight_kg: string }
export type ExerciseForm = { exercise_id: string; name: string; note: string; sets: SetForm[] }
export type SessionForm = { start_time: string; muscle_groups: MuscleGroup[]; exercises: ExerciseForm[] }

export function validateSession(form: SessionForm): { errors: string[]; payload: null | {
  start_time: string; muscle_groups: MuscleGroup[]
  exercises: { exercise_id: string; note: string | null; sets: GymSet[] }[]
} } {
  const errors: string[] = []
  if (!/^\d{2}:\d{2}$/.test(form.start_time.trim())) errors.push('Enter the start time.')
  if (form.muscle_groups.length === 0) errors.push('Choose at least one muscle group.')
  if (form.exercises.length === 0) errors.push('Add at least one exercise.')
  const ids = new Set<string>()
  const exercises = form.exercises.map((ex) => {
    if (ids.has(ex.exercise_id)) errors.push(`${ex.name} is added twice. Put all its sets under one entry.`)
    ids.add(ex.exercise_id)
    if (ex.sets.length === 0) errors.push(`${ex.name}: add at least one set.`)
    if (ex.note.trim().length > 500) errors.push(`${ex.name}: the note can be at most 500 characters.`)
    const sets = ex.sets.map((s, i) => {
      const reps = s.reps.trim()
      const kg = s.weight_kg.trim().replace(',', '.')
      if (!/^\d+$/.test(reps) || Number(reps) < 1 || Number(reps) > MAX_REPS) errors.push(`${ex.name}, set ${i + 1}: reps must be a whole number from 1 to ${MAX_REPS}.`)
      if (!/^\d+(\.\d{1,2})?$/.test(kg) || Number(kg) > MAX_KG) errors.push(`${ex.name}, set ${i + 1}: weight must be 0 to ${MAX_KG} kg, at most 2 decimals.`)
      return { reps: Number(reps), weight_kg: Number(kg) }
    })
    return { exercise_id: ex.exercise_id, note: ex.note.trim() || null, sets }
  })
  if (errors.length > 0) return { errors, payload: null }
  return { errors, payload: { start_time: form.start_time.trim(), muscle_groups: form.muscle_groups, exercises } }
}

// The next set copies the previous set's reps and kg (blank for the first set).
export function nextSet(sets: SetForm[]): SetForm {
  const last = sets.at(-1)
  return last ? { ...last } : { reps: '', weight_kg: '' }
}

export function formatSet(s: GymSet): string {
  return `${s.reps} × ${Number(s.weight_kg) === 0 ? 'bodyweight' : `${Number(s.weight_kg)} kg`}`
}

// ---------- Progress points for the graphs ----------

export type ProgressPoint = { date: string; topKg: number | null; topReps: number | null; volume: number; e1rm: number | null; totalReps: number; sets: GymSet[] }

export function progressPoints(entries: { date: string; sets: GymSet[] }[]): ProgressPoint[] {
  return [...entries]
    .filter((e) => e.sets.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => {
      const s = sessionStats(e.sets)
      return {
        date: e.date,
        topKg: s.topSet ? Number(s.topSet.weight_kg) : null,
        topReps: s.topSet ? s.topSet.reps : null,
        volume: s.volume,
        e1rm: s.e1rm,
        totalReps: s.totalReps,
        sets: e.sets,
      }
    })
}
