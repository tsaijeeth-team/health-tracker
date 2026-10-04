import { useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { isConfigured, supabase } from './lib/supabase'
import Login from './Login'
import DayScreen from './DayScreen'

function App() {
  if (!isConfigured || !supabase) {
    return (
      <main className="screen">
        <div className="card">
          <h1>Health Tracker</h1>
          <p className="error">
            Setup needed: the Supabase settings are missing. Add them in Vercel → Settings →
            Environment Variables, then redeploy.
          </p>
        </div>
      </main>
    )
  }
  return <AuthGate supabase={supabase} />
}

function AuthGate({ supabase }: { supabase: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => data.subscription.unsubscribe()
  }, [supabase])

  if (loading) {
    return (
      <main className="screen">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  if (!session) {
    return <Login supabase={supabase} />
  }

  return <DayScreen supabase={supabase} email={session.user.email ?? ''} />
}

export default App
