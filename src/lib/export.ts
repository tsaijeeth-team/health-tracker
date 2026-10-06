// "Export my data": full JSON backup and a one-row-per-day CSV summary.
// Files are built in the browser and saved to the device; nothing is uploaded.

export type Row = Record<string, unknown>

// Supabase returns at most 1,000 rows per request, so read in pages until done.
export async function fetchAllRows(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>,
  pageSize = 1000,
): Promise<Row[]> {
  const all: Row[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw error
    const page = data ?? []
    all.push(...page)
    if (page.length < pageSize) return all
  }
}

export const BACKUP_TABLES = [
  'days', 'food_items', 'fluids', 'cardio_sessions', 'day_notes',
  'exercises', 'exercise_renames', 'gym_sessions', 'gym_exercises', 'gym_sets', 'weight_targets',
] as const
export type BackupTable = (typeof BACKUP_TABLES)[number]
export type BackupData = Record<BackupTable, Row[]>

export function buildBackup(data: BackupData, exportedAt: Date) {
  return {
    app: 'health-tracker',
    format_version: 1,
    exported_at: exportedAt.toISOString(),
    time_zone: 'Asia/Kolkata',
    note: 'Personal health data. Keep this file private. Share-link secrets are not included.',
    tables: data,
  }
}

// ---------- Daily summary (CSV) ----------

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const round2 = (n: number) => Math.round(n * 100) / 100
const KCAL_DRINKS = ['maad_water', 'sugary_drink', 'other']

export const SUMMARY_COLUMNS = [
  'date', 'confirmed', 'weight_kg',
  'bedtime', 'wake_time', 'sleep_minutes', 'sleep_quality', 'snoring', 'gasping', 'afternoon_sleepiness', 'nap_minutes',
  'steps', 'cardio_minutes', 'gym_exercises', 'gym_sets', 'gym_volume_kg',
  'stress', 'energy', 'resting_pulse', 'gaming_hours', 'porn', 'naam_jaap', 'junk_meals',
  'food_items', 'food_kcal', 'drink_kcal', 'total_kcal', 'kcal_unknown_drinks',
  'protein_g', 'protein_unknown_items', 'carbs_g', 'carbs_unknown_items', 'fat_g', 'fat_unknown_items',
  'fibre_g', 'fibre_unknown_items', 'hunger_addon_kcal',
  'fluids_ml', 'sugary_ml', 'notes',
] as const

export function dailySummary(data: BackupData): Row[] {
  const byDay = <T extends Row>(rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const k = String(r.day_id)
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return m
  }
  const food = byDay(data.food_items)
  const fluids = byDay(data.fluids)
  const cardio = byDay(data.cardio_sessions)
  const notes = byDay(data.day_notes)
  // Gym: session -> day, exercise entry -> session, set -> entry.
  const sessionDay = new Map(data.gym_sessions.map((g) => [String(g.id), String(g.day_id)]))
  const entryDay = new Map(data.gym_exercises.map((e) => [String(e.id), sessionDay.get(String(e.session_id))]))
  const gymEntries = new Map<string, number>()
  for (const e of data.gym_exercises) {
    const day = sessionDay.get(String(e.session_id))
    if (day) gymEntries.set(day, (gymEntries.get(day) ?? 0) + 1)
  }
  const gymSets = new Map<string, Row[]>()
  for (const st of data.gym_sets) {
    const day = entryDay.get(String(st.entry_id))
    if (day) gymSets.set(day, [...(gymSets.get(day) ?? []), st])
  }
  const sumKnown = (rows: Row[], key: string) => round2(rows.reduce((s, r) => s + (num(r[key]) ?? 0), 0))
  const unknown = (rows: Row[], key: string) => rows.filter((r) => r[key] === null).length
  const time = (v: unknown) => (v ? String(v).slice(0, 5) : null)

  return [...data.days]
    .sort((a, b) => String(a.log_date).localeCompare(String(b.log_date)))
    .map((d) => {
      const id = String(d.id)
      const f = food.get(id) ?? []
      const fl = fluids.get(id) ?? []
      const c = cardio.get(id) ?? []
      const foodKcal = sumKnown(f, 'kcal')
      const drinkKcal = sumKnown(fl, 'kcal')
      return {
        date: d.log_date,
        confirmed: d.confirmed_at ? 'yes' : 'no',
        weight_kg: d.weight_kg,
        bedtime: time(d.bedtime),
        wake_time: time(d.wake_time),
        sleep_minutes: d.sleep_minutes,
        sleep_quality: d.sleep_quality,
        snoring: d.snoring,
        gasping: d.gasping,
        afternoon_sleepiness: d.afternoon_sleepiness,
        nap_minutes: d.nap_minutes,
        steps: d.steps,
        cardio_minutes: c.reduce((s, r) => s + (num(r.minutes) ?? 0), 0),
        gym_exercises: gymEntries.get(id) ?? 0,
        gym_sets: (gymSets.get(id) ?? []).length,
        gym_volume_kg: round2((gymSets.get(id) ?? []).reduce((s, r) => s + (num(r.reps) ?? 0) * (num(r.weight_kg) ?? 0), 0)),
        stress: d.stress,
        energy: d.energy,
        resting_pulse: d.resting_pulse,
        gaming_hours: d.gaming_hours,
        porn: d.porn,
        naam_jaap: d.naam_jaap,
        junk_meals: d.junk_meals,
        food_items: f.length,
        food_kcal: foodKcal,
        drink_kcal: drinkKcal,
        total_kcal: round2(foodKcal + drinkKcal),
        kcal_unknown_drinks: fl.filter((r) => r.kcal === null && KCAL_DRINKS.includes(String(r.drink_type))).length,
        protein_g: sumKnown(f, 'protein_g'),
        protein_unknown_items: unknown(f, 'protein_g'),
        carbs_g: sumKnown(f, 'carbs_g'),
        carbs_unknown_items: unknown(f, 'carbs_g'),
        fat_g: sumKnown(f, 'fat_g'),
        fat_unknown_items: unknown(f, 'fat_g'),
        fibre_g: sumKnown(f, 'fibre_total_g'),
        fibre_unknown_items: unknown(f, 'fibre_total_g'),
        hunger_addon_kcal: sumKnown(f.filter((r) => r.is_hunger_addon === true), 'kcal'),
        fluids_ml: fl.reduce((s, r) => s + (num(r.ml) ?? 0), 0),
        sugary_ml: fl.filter((r) => r.drink_type === 'sugary_drink').reduce((s, r) => s + (num(r.ml) ?? 0), 0),
        notes: (notes.get(id) ?? []).length,
      }
    })
}

// One CSV cell. Blank (not answered) stays an empty cell. true/false become yes/no.
// Cells starting with = + - @ are prefixed with ' so spreadsheets never run them as formulas.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Row[], columns: readonly string[]): string {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))]
  return '﻿' + lines.join('\r\n') + '\r\n' // BOM: Excel opens it as UTF-8
}

export const exportFileName = (kind: 'backup' | 'daily', isoDate: string) =>
  kind === 'backup' ? `health-export-${isoDate}.json` : `health-export-daily-${isoDate}.csv`

// ---------- "Last export" nudge (remembered on this device only) ----------

export const LAST_EXPORT_KEY = 'health-tracker:last-export'
export const EXPORT_NUDGE_DAYS = 7

export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86400000)
}
