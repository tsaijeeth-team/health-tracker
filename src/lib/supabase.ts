import { createClient } from '@supabase/supabase-js'

// Both values come from Vercel's environment variables (see .env.example).
// The publishable key is designed to be public: the database rules protect the data.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && publishableKey)

export const supabase = isConfigured
  ? createClient(url!, publishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null
