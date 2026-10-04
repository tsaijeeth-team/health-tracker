import { createClient } from '@supabase/supabase-js'

// Accepts the project URL in any of the forms Supabase shows it and returns
// just the base, e.g. "https://abc.supabase.co/rest/v1/ " -> "https://abc.supabase.co".
// The client adds its own paths (/auth/v1, /rest/v1), so any extra path breaks login.
export function normalizeSupabaseUrl(raw: string): string {
  let url = raw.trim()
  for (;;) {
    const next = url.replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/i, '')
    if (next === url) return url
    url = next
  }
}

// Both values come from Vercel's environment variables (see .env.example).
// The publishable key is designed to be public: the database rules protect the data.
const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim()
const url = rawUrl ? normalizeSupabaseUrl(rawUrl) : undefined

export const isConfigured = Boolean(url && publishableKey)

export const supabase = isConfigured
  ? createClient(url!, publishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null
