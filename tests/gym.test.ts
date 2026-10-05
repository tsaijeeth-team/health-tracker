// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanName, e1rm, findExercise, formatSet, nameKey, nextSet, progressPoints, sessionStats, validateSession, type SessionForm } from '../src/lib/gym.ts'

test('e1RM: Epley, only 1-10 reps, 1 rep = weight, 0 kg none', () => {
  assert.equal(e1rm({ reps: 10, weight_kg: 60 }), 80) // 60 × (1 + 10/30) = 80
  assert.equal(e1rm({ reps: 5, weight_kg: 100 }), 116.7) // 116.666… → 116.7
  assert.equal(e1rm({ reps: 1, weight_kg: 120 }), 120) // 1 rep = the weight lifted
  assert.equal(e1rm({ reps: 11, weight_kg: 60 }), null) // over 10 reps: excluded
  assert.equal(e1rm({ reps: 8, weight_kg: 0 }), null) // bodyweight: no e1RM
})

test('session stats: top set (ties → more reps), volume, best e1RM, total reps', () => {
  const s = sessionStats([
    { reps: 10, weight_kg: 40 }, { reps: 8, weight_kg: 45 }, { reps: 6, weight_kg: 45 }, { reps: 12, weight_kg: 30 },
  ])
  assert.deepEqual(s.topSet, { reps: 8, weight_kg: 45 })
  assert.equal(s.volume, 400 + 360 + 270 + 360)
  assert.equal(s.e1rm, 57) // 45 × (1 + 8/30) = 57; the 12-rep set is ignored
  assert.equal(s.totalReps, 36)
  assert.equal(s.bodyweightOnly, false)
})

test('only >10-rep sets: no e1RM point, but top set and volume still there', () => {
  const s = sessionStats([{ reps: 12, weight_kg: 30 }, { reps: 15, weight_kg: 25 }])
  assert.equal(s.e1rm, null)
  assert.deepEqual(s.topSet, { reps: 12, weight_kg: 30 })
  assert.equal(s.volume, 360 + 375)
})

test('bodyweight exercise: total reps only', () => {
  const s = sessionStats([{ reps: 8, weight_kg: 0 }, { reps: 7, weight_kg: 0 }, { reps: 6, weight_kg: 0 }])
  assert.equal(s.bodyweightOnly, true)
  assert.equal(s.e1rm, null)
  assert.equal(s.volume, 0)
  assert.equal(s.totalReps, 21)
  assert.equal(formatSet({ reps: 8, weight_kg: 0 }), '8 × bodyweight')
  assert.equal(formatSet({ reps: 8, weight_kg: 42.5 }), '8 × 42.5 kg')
})

test('exercise names: no near-duplicates (same rule as the database)', () => {
  assert.equal(nameKey('  Bench   PRESS '), 'bench press')
  assert.equal(cleanName('  Bench   press '), 'Bench press')
  const list = [{ id: '1', name: 'Bench press' }]
  assert.equal(findExercise(list, ' bench  press')?.id, '1')
  assert.equal(findExercise(list, 'Incline bench press'), undefined)
})

test('a new set copies the previous one', () => {
  assert.deepEqual(nextSet([]), { reps: '', weight_kg: '' })
  assert.deepEqual(nextSet([{ reps: '10', weight_kg: '40' }, { reps: '8', weight_kg: '42.5' }]), { reps: '8', weight_kg: '42.5' })
})

const ok: SessionForm = {
  start_time: '18:30', muscle_groups: ['chest'],
  exercises: [{ exercise_id: 'e1', name: 'Bench press', note: ' ', sets: [{ reps: '10', weight_kg: '40' }] }],
}

test('session checks match the database limits', () => {
  assert.deepEqual(validateSession(ok).errors, [])
  assert.equal(validateSession(ok).payload?.exercises[0].note, null)
  const bad = (sets: { reps: string; weight_kg: string }[]) => validateSession({ ...ok, exercises: [{ ...ok.exercises[0], sets }] }).errors
  assert.equal(bad([{ reps: '0', weight_kg: '40' }]).length, 1)
  assert.equal(bad([{ reps: '101', weight_kg: '40' }]).length, 1)
  assert.equal(bad([{ reps: '10', weight_kg: '500.01' }]).length, 1)
  assert.equal(bad([{ reps: '10', weight_kg: '40.125' }]).length, 1)
  assert.equal(bad([{ reps: '10', weight_kg: '0' }]).length, 0)
  assert.equal(bad([{ reps: '10', weight_kg: '42,5' }]).length, 0)
  assert.equal(bad([]).length, 1)
  assert.ok(validateSession({ ...ok, muscle_groups: [] }).errors.length === 1)
  assert.ok(validateSession({ ...ok, exercises: [] }).errors.length === 1)
  assert.ok(validateSession({ ...ok, exercises: [ok.exercises[0], ok.exercises[0]] }).errors[0].includes('added twice'))
})

test('progress points: oldest first, gaps where no e1RM', () => {
  const pts = progressPoints([
    { date: '2026-10-21', sets: [{ reps: 12, weight_kg: 30 }] },
    { date: '2026-10-19', sets: [{ reps: 10, weight_kg: 60 }] },
  ])
  assert.deepEqual(pts.map((p) => p.date), ['2026-10-19', '2026-10-21'])
  assert.equal(pts[0].e1rm, 80)
  assert.equal(pts[1].e1rm, null)
  assert.equal(pts[1].topKg, 30)
})
