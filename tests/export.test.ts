// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUMMARY_COLUMNS, buildBackup, csvCell, dailySummary, daysSince, exportFileName, fetchAllRows, toCsv, type BackupData } from '../src/lib/export.ts'

test('reads every page (Supabase returns max 1,000 rows per request)', async () => {
  const all = Array.from({ length: 2345 }, (_, i) => ({ i }))
  const calls: [number, number][] = []
  const rows = await fetchAllRows(async (from, to) => { calls.push([from, to]); return { data: all.slice(from, to + 1), error: null } })
  assert.equal(rows.length, 2345)
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
  const exact = await fetchAllRows(async (from, to) => ({ data: all.slice(0, 1000).slice(from, to + 1), error: null }))
  assert.equal(exact.length, 1000) // exactly one full page, then an empty one
})

test('a failed page stops the export with the error', async () => {
  await assert.rejects(fetchAllRows(async () => ({ data: null, error: { message: 'boom' } })), (e: { message: string }) => e.message === 'boom')
})

test('CSV cells: blanks empty, yes/no, quoting, formula protection', () => {
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(true), 'yes')
  assert.equal(csvCell(false), 'no')
  assert.equal(csvCell(82.4), '82.4')
  assert.equal(csvCell(-5), '-5')
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  assert.equal(csvCell('+cmd'), "'+cmd")
})

const data: BackupData = {
  days: [
    { id: 'd2', log_date: '2026-10-05', confirmed_at: null, weight_kg: null, bedtime: null, wake_time: null, sleep_minutes: null, sleep_quality: null, snoring: null, gasping: null, afternoon_sleepiness: null, nap_minutes: null, steps: null, stress: null, energy: null, resting_pulse: null, gaming_hours: null, porn: null, naam_jaap: null, junk_meals: null },
    { id: 'd1', log_date: '2026-10-04', confirmed_at: '2026-10-04T17:00:00Z', weight_kg: 82.4, bedtime: '23:30:00', wake_time: '07:00:00', sleep_minutes: 450, sleep_quality: 4, snoring: false, gasping: false, afternoon_sleepiness: true, nap_minutes: 0, steps: 9000, stress: 3, energy: 7, resting_pulse: 62, gaming_hours: 1.5, porn: false, naam_jaap: true, junk_meals: 0 },
  ],
  food_items: [
    { day_id: 'd1', kcal: 210, protein_g: 14, carbs_g: 36, fat_g: 1, fibre_total_g: 6, is_hunger_addon: false },
    { day_id: 'd1', kcal: 90.5, protein_g: null, carbs_g: 12, fat_g: 4, fibre_total_g: null, is_hunger_addon: true },
  ],
  fluids: [
    { day_id: 'd1', drink_type: 'water', ml: 2000, kcal: null },
    { day_id: 'd1', drink_type: 'sugary_drink', ml: 300, kcal: 120 },
    { day_id: 'd1', drink_type: 'maad_water', ml: 200, kcal: null },
  ],
  cardio_sessions: [{ day_id: 'd1', minutes: 30 }, { day_id: 'd1', minutes: 15 }],
  day_notes: [{ day_id: 'd1', body: 'x' }],
}

test('daily summary: oldest first, honest totals, blanks stay blank', () => {
  const rows = dailySummary(data)
  assert.deepEqual(rows.map((r) => r.date), ['2026-10-04', '2026-10-05'])
  const d = rows[0]
  assert.equal(d.confirmed, 'yes')
  assert.equal(d.bedtime, '23:30')
  assert.equal(d.food_kcal, 300.5)
  assert.equal(d.drink_kcal, 120)
  assert.equal(d.total_kcal, 420.5)
  assert.equal(d.kcal_unknown_drinks, 1) // maad water with blank kcal; water is not "unknown"
  assert.equal(d.protein_g, 14)
  assert.equal(d.protein_unknown_items, 1)
  assert.equal(d.fibre_unknown_items, 1)
  assert.equal(d.hunger_addon_kcal, 90.5)
  assert.equal(d.fluids_ml, 2500)
  assert.equal(d.sugary_ml, 300)
  assert.equal(d.cardio_minutes, 45)
  assert.equal(d.notes, 1)
  const empty = rows[1]
  assert.equal(empty.weight_kg, null)
  assert.equal(empty.junk_meals, null)
  assert.equal(empty.food_items, 0)
})

test('CSV file: header + one line per day, blank cells for not answered', () => {
  const csv = toCsv(dailySummary(data), SUMMARY_COLUMNS)
  assert.ok(csv.startsWith('﻿date,confirmed,weight_kg,'))
  const lines = csv.trim().split('\r\n')
  assert.equal(lines.length, 3)
  assert.ok(lines[1].startsWith('2026-10-04,yes,82.4,23:30,07:00,450,4,no,no,yes,0,9000,45,'))
  assert.ok(lines[2].startsWith('2026-10-05,no,,,,,,,,,,,0,'))
})

test('backup file: all tables, no share-link secrets, private note', () => {
  const b = buildBackup(data, new Date('2026-10-05T10:00:00Z'))
  assert.deepEqual(Object.keys(b.tables).sort(), ['cardio_sessions', 'day_notes', 'days', 'fluids', 'food_items'])
  assert.equal(b.exported_at, '2026-10-05T10:00:00.000Z')
  assert.ok(!JSON.stringify(b).includes('token'))
  assert.equal(exportFileName('backup', '2026-10-05'), 'health-export-2026-10-05.json')
  assert.equal(exportFileName('daily', '2026-10-05'), 'health-export-daily-2026-10-05.csv')
})

test('days since last export', () => {
  const now = new Date('2026-10-12T10:00:00Z')
  assert.equal(daysSince(null, now), null)
  assert.equal(daysSince('2026-10-12T09:00:00Z', now), 0)
  assert.equal(daysSince('2026-10-05T09:00:00Z', now), 7)
  assert.equal(daysSince('garbage', now), null)
})
