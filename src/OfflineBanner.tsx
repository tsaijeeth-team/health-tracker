import { useEffect, useState } from 'react'

// Shown at the top whenever the phone has no internet. Version 1 never saves offline.
function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  if (online) return null
  return (
    <div className="offline-banner" role="alert">
      You're offline. Changes can't be saved until you're back online.
    </div>
  )
}

export default OfflineBanner
