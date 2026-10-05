// Share links: types, status and the data shape returned by get_shared_progress().

export type ShareLink = {
  id: string
  label: string | null
  token: string
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

export type LinkStatus = 'active' | 'expired' | 'revoked'

export function linkStatus(link: ShareLink, now: Date = new Date()): LinkStatus {
  if (link.revoked_at) return 'revoked'
  if (link.expires_at && new Date(link.expires_at) <= now) return 'expired'
  return 'active'
}

export const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never', days: null },
  { value: '7', label: '7 days', days: 7 },
  { value: '30', label: '30 days', days: 30 },
] as const
export type ExpiryChoice = (typeof EXPIRY_OPTIONS)[number]['value']

export function expiresAt(choice: ExpiryChoice, now: Date = new Date()): string | null {
  const days = EXPIRY_OPTIONS.find((o) => o.value === choice)?.days ?? null
  return days === null ? null : new Date(now.getTime() + days * 86400000).toISOString()
}

export function shareUrl(token: string, origin: string): string {
  return `${origin}/share/${token}`
}

// The token from a /share/<token> address, or null for any other page.
export function tokenFromPath(pathname: string): string | null {
  const match = /^\/share\/([0-9a-f]{64})\/?$/.exec(pathname)
  if (match) return match[1]
  return pathname.startsWith('/share/') || pathname === '/share' ? '' : null
}

export type SharedDay = {
  date: string
  weight_kg: number | null
  bedtime: string | null
  wake_time: string | null
  sleep_minutes: number | null
  steps: number | null
  junk_meals: number | null
  food: {
    kcal: number
    protein_g: number; protein_unknown: number
    carbs_g: number; carbs_unknown: number
    fat_g: number; fat_unknown: number
    fibre_g: number; fibre_unknown: number
  }
  fluids: { total_ml: number; sugary_ml: number; kcal: number; kcal_unknown: number }
  cardio: { type: string; minutes: number; start_time: string; description: string | null }[]
}

export type SharedProgress = { days: SharedDay[] }
