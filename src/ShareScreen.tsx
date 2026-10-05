import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EXPIRY_OPTIONS, expiresAt, linkStatus, shareUrl, type ExpiryChoice, type ShareLink } from './lib/share'
import { formatDateTimeIST } from './lib/confirm'
import { friendlyError } from './lib/errors'
import { Field } from './components/inputs'

// The owner's page for creating, copying and revoking read-only share links.
function ShareScreen({ supabase, email, onBack }: { supabase: SupabaseClient; email: string; onBack: () => void }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [label, setLabel] = useState('')
  const [expiry, setExpiry] = useState<ExpiryChoice>('never')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('share_links')
      .select('id, label, token, expires_at, revoked_at, created_at')
      .order('created_at', { ascending: false })
    if (err) setLoadError(friendlyError(err.message, err.code))
    else setLinks(data as ShareLink[])
  }, [supabase])

  // Loading data from the server is what effects are for; state changes only after the reply.
  useEffect(() => {
    load()
  }, [load])

  async function create() {
    const trimmed = label.trim()
    if (trimmed.length > 100) {
      setError('Label can be at most 100 characters.')
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await supabase.from('share_links').insert({ label: trimmed || null, expires_at: expiresAt(expiry) })
    setBusy(false)
    if (err) {
      setError(friendlyError(err.message, err.code))
      return
    }
    setLabel('')
    setExpiry('never')
    await load()
  }

  async function copy(link: ShareLink) {
    const url = shareUrl(link.token, window.location.origin)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(link.id)
      window.setTimeout(() => setCopied((c) => (c === link.id ? null : c)), 2000)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  async function revoke(link: ShareLink) {
    const name = link.label ? `"${link.label}"` : 'this link'
    if (!window.confirm(`Switch off ${name}? Anyone using it will lose access immediately. This cannot be undone.`)) return
    setBusy(true)
    const { error: err } = await supabase.from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', link.id)
    setBusy(false)
    if (err) setError(friendlyError(err.message, err.code))
    await load()
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>Share</strong>
        <div className="topbar-right">
          <span className="muted small email">{email}</span>
          <button type="button" className="secondary small-button" onClick={onBack}>← Back</button>
        </div>
      </header>
      <main className="content">
        <section className="card">
          <h2>Create a read-only link</h2>
          <p className="small muted">
            Viewers see confirmed days only: weight, calories and food totals, fluids, steps, cardio, sleep times and
            junk meals. Everything else stays private. Viewers cannot change anything.
          </p>
          <Field label="Label" hint="only you see this, e.g. Family">
            <input type="text" aria-label="Link label" maxLength={100} value={label} disabled={busy}
              onChange={(e) => { setLabel(e.target.value); setError('') }} />
          </Field>
          <Field label="Expires">
            <div className="segmented three-equal" role="group" aria-label="Expires">
              {EXPIRY_OPTIONS.map((o) => (
                <button key={o.value} type="button" disabled={busy}
                  className={expiry === o.value ? 'chip selected' : 'chip'} aria-pressed={expiry === o.value}
                  onClick={() => setExpiry(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
          {error && <p className="error small" role="alert">{error}</p>}
          <button type="button" onClick={create} disabled={busy}>{busy ? 'Working…' : 'Create link'}</button>
        </section>

        <section className="card">
          <h2>Your links</h2>
          {loadError && <p className="error small">{loadError}</p>}
          {!links && !loadError && <p className="muted small">Loading…</p>}
          {links && links.length === 0 && <p className="muted small">No links yet.</p>}
          {links && links.length > 0 && (
            <ul className="link-list">
              {links.map((link) => {
                const status = linkStatus(link)
                return (
                  <li key={link.id} className={`share-link ${status}`}>
                    <div className="share-link-head">
                      <strong>{link.label || 'Untitled link'}</strong>
                      <span className={`link-status ${status}`}>
                        {status === 'active' ? 'Active' : status === 'expired' ? 'Expired' : 'Switched off'}
                      </span>
                    </div>
                    <span className="muted small">
                      Created {formatDateTimeIST(link.created_at)}
                      {link.revoked_at
                        ? ` · switched off ${formatDateTimeIST(link.revoked_at)}`
                        : link.expires_at
                          ? ` · ${status === 'expired' ? 'expired' : 'expires'} ${formatDateTimeIST(link.expires_at)}`
                          : ' · never expires'}
                    </span>
                    {status === 'active' && (
                      <>
                        <code className="share-url">{shareUrl(link.token, window.location.origin)}</code>
                        <div className="button-row">
                          <button type="button" onClick={() => copy(link)}>{copied === link.id ? 'Copied ✓' : 'Copy link'}</button>
                          <a className="button-link secondary" href={shareUrl(link.token, window.location.origin)} target="_blank" rel="noreferrer">
                            Preview
                          </a>
                        </div>
                        <button type="button" className="danger" disabled={busy} onClick={() => revoke(link)}>
                          Switch off this link
                        </button>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

export default ShareScreen
