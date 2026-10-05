import { useEffect, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { isConfigured, supabase } from './lib/supabase'
import Login from './Login'
import DayScreen from './DayScreen'
import ShareScreen from './ShareScreen'
import ProgressScreen from './ProgressScreen'
import SharePage from './SharePage'
import { tokenFromPath } from './lib/share'
import OfflineBanner from './OfflineBanner'

function App() {
  return (
    <>
      <OfflineBanner />
      <Screens />
    </>
  )
}

function Screens() {
  // A /share/<token> address shows the read-only viewer page: no login, nothing editable.
  const shareToken = tokenFromPath(window.location.pathname)
  if (shareToken !== null) {
    return <SharePage supabase={supabase} token={isConfigured ? shareToken : ''} />
  }
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
  const [view, setView] = useState<'day' | 'share' | 'progress'>('day')

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

  const email = session.user.email ?? ''
  if (view === 'share') {
    return <ShareScreen supabase={supabase} email={email} onBack={() => setView('day')} />
  }
  if (view === 'progress') {
    return <ProgressScreen supabase={supabase} onBack={() => setView('day')} />
  }
  return <DayScreen supabase={supabase} email={email} onOpenShare={() => setView('share')} onOpenProgress={() => setView('progress')} />
}

export default App
