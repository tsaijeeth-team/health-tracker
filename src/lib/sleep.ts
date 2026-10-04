// Sleep duration from bedtime and wake time ("HH:MM"), crossing midnight if needed.
// Matches the database's sleep_minutes calculation.

export type SleepResult =
  | { kind: 'missing' }
  | { kind: 'same' }
  | { kind: 'ok'; minutes: number }

function toMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(time)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

export function sleepDuration(bedtime: string, wakeTime: string): SleepResult {
  const bed = toMinutes(bedtime)
  const wake = toMinutes(wakeTime)
  if (bed === null || wake === null) return { kind: 'missing' }
  if (bed === wake) return { kind: 'same' }
  return { kind: 'ok', minutes: wake > bed ? wake - bed : wake + 1440 - bed }
}

// e.g. 450 -> "7 h 30 min", 60 -> "1 h", 45 -> "45 min"
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}
