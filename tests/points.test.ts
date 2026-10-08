// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankCost, formatPoints, nextRankNeeds, pillarLine, pillarMisses, targetError, weekOf, type Pillar } from '../src/lib/points.ts'

test('points are shown with a sign', () => {
  assert.equal(formatPoints(20), '+20')
  assert.equal(formatPoints(-50), '−50')
  assert.equal(formatPoints(0), '0')
  assert.equal(formatPoints(12000), '+12,000')
})

test('weeks run Monday to Sunday', () => {
  assert.deepEqual(weekOf('2026-10-05'), { start: '2026-10-05', end: '2026-10-11' }) // a Monday
  assert.deepEqual(weekOf('2026-10-11'), { start: '2026-10-05', end: '2026-10-11' }) // the Sunday
  assert.deepEqual(weekOf('2026-10-08'), { start: '2026-10-05', end: '2026-10-11' })
  assert.deepEqual(weekOf('2027-01-01'), { start: '2026-12-28', end: '2027-01-03' }) // across a new year
})

test('weekly target input: 30–300 kg, 1 decimal', () => {
  assert.equal(targetError('99.5'), null)
  assert.equal(targetError(' 99,5 '), null)
  assert.equal(targetError('100'), null)
  assert.equal(targetError(''), 'Enter a target weight.')
  assert.equal(targetError('99.25'), 'Use a number with at most 1 decimal, e.g. 99.5.')
  assert.equal(targetError('abc'), 'Use a number with at most 1 decimal, e.g. 99.5.')
  assert.equal(targetError('29.9'), 'Target must be between 30 and 300 kg.')
  assert.equal(targetError('301'), 'Target must be between 30 and 300 kg.')
})

test('next rank: what is still needed', () => {
  assert.deepEqual(nextRankNeeds({ name: 'Samanth', points: 700, points_needed: 340, gate_kg: null, hold_days: null, held_days: null }),
    ['340 more points'])
  assert.deepEqual(nextRankNeeds({ name: 'Maharaj', points: 3500, points_needed: 0, gate_kg: 94, hold_days: 28, held_days: 5 }),
    ['7-day average weight 94 kg or less, held 28 days in a row (now 5)'])
  assert.deepEqual(nextRankNeeds({ name: 'Chakravarti Samrat', points: 7500, points_needed: 1200, gate_kg: 85, hold_days: 0, held_days: 0 }),
    ['1,200 more points', '7-day average weight 85 kg or less'])
})

test('pillar line, misses and blank costs', () => {
  const p = (code: string, name: string, points: number, blank = false, detail = ''): Pillar => ({ code, name, points, blank, detail })
  const pillars = [p('nutrition', 'Nutrition', 20), p('steps', 'Steps', -10, true, 'blank'), p('junk', 'Junk', 10),
    p('gym', 'Gym', 0, false, 'no session'), p('naam_jaap', 'Naam Jaap', 0, true, 'blank')]
  assert.equal(pillarLine(pillars), 'Nutrition +20 · Steps −10 · Junk +10 · Gym 0 · Naam Jaap 0')
  assert.deepEqual(pillarMisses(pillars).map((x) => x.code), ['steps', 'naam_jaap']) // gym 0 with no session is not a miss
  assert.equal(blankCost(pillars[1]), 'Steps: blank → −10')
  assert.equal(blankCost(p('junk', 'Junk', -50, true)), 'Junk: blank → −50')
})
