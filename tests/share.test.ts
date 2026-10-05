// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expiresAt, linkStatus, shareUrl, tokenFromPath, type ShareLink } from '../src/lib/share.ts'

const T = 'a'.repeat(64)
const link = (o: Partial<ShareLink>): ShareLink => ({ id: '1', label: null, token: T, expires_at: null, revoked_at: null, created_at: '2026-10-05T00:00:00Z', ...o })

test('link status', () => {
  const now = new Date('2026-10-05T12:00:00Z')
  assert.equal(linkStatus(link({}), now), 'active')
  assert.equal(linkStatus(link({ expires_at: '2026-10-06T00:00:00Z' }), now), 'active')
  assert.equal(linkStatus(link({ expires_at: '2026-10-05T11:59:59Z' }), now), 'expired')
  assert.equal(linkStatus(link({ revoked_at: '2026-10-05T10:00:00Z', expires_at: '2026-10-01T00:00:00Z' }), now), 'revoked')
})

test('expiry choices', () => {
  const now = new Date('2026-10-05T12:00:00Z')
  assert.equal(expiresAt('never', now), null)
  assert.equal(expiresAt('7', now), '2026-10-12T12:00:00.000Z')
  assert.equal(expiresAt('30', now), '2026-11-04T12:00:00.000Z')
})

test('share address and reading the token back', () => {
  assert.equal(shareUrl(T, 'https://x.vercel.app'), `https://x.vercel.app/share/${T}`)
  assert.equal(tokenFromPath(`/share/${T}`), T)
  assert.equal(tokenFromPath(`/share/${T}/`), T)
  assert.equal(tokenFromPath('/share/not-a-token'), '') // share page, invalid link
  assert.equal(tokenFromPath(`/share/${'A'.repeat(64)}`), '') // tokens are lower-case hex
  assert.equal(tokenFromPath('/'), null) // normal app
})
