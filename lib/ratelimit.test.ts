import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, resetRateLimit, clearAllRateLimits, clientKey, LIMITS } from './ratelimit'

beforeEach(() => clearAllRateLimits())

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null }
}

describe('rateLimit', () => {
  const now = 1_700_000_000_000

  it('allows attempts up to the limit', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 1000, now).allowed).toBe(true)
    }
  })

  it('blocks the attempt past the limit', () => {
    for (let i = 0; i < 3; i++) rateLimit('k', 3, 1000, now)
    const result = rateLimit('k', 3, 1000, now)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it('counts down the remaining budget', () => {
    expect(rateLimit('k', 3, 1000, now).remaining).toBe(2)
    expect(rateLimit('k', 3, 1000, now).remaining).toBe(1)
    expect(rateLimit('k', 3, 1000, now).remaining).toBe(0)
  })

  it('reports when the window resets', () => {
    expect(rateLimit('k', 3, 5000, now).resetAt).toBe(now + 5000)
  })

  it('keeps the reset time stable across the window', () => {
    rateLimit('k', 3, 5000, now)
    expect(rateLimit('k', 3, 5000, now + 100).resetAt).toBe(now + 5000)
  })

  it('starts a fresh window once the old one lapses', () => {
    for (let i = 0; i < 3; i++) rateLimit('k', 3, 1000, now)
    expect(rateLimit('k', 3, 1000, now + 1001).allowed).toBe(true)
  })

  it('tracks keys independently, so one client cannot lock out another', () => {
    for (let i = 0; i < 3; i++) rateLimit('a', 3, 1000, now)
    expect(rateLimit('a', 3, 1000, now).allowed).toBe(false)
    expect(rateLimit('b', 3, 1000, now).allowed).toBe(true)
  })

  it('forgets a key on reset, so a successful login is not held against the user', () => {
    for (let i = 0; i < 3; i++) rateLimit('k', 3, 1000, now)
    resetRateLimit('k')
    expect(rateLimit('k', 3, 1000, now).allowed).toBe(true)
  })

  it('handles a limit of one', () => {
    expect(rateLimit('k', 1, 1000, now).allowed).toBe(true)
    expect(rateLimit('k', 1, 1000, now).allowed).toBe(false)
  })

  it('stays blocked for every further attempt inside the window', () => {
    for (let i = 0; i < 5; i++) rateLimit('k', 2, 1000, now)
    expect(rateLimit('k', 2, 1000, now + 500).allowed).toBe(false)
  })
})

describe('LIMITS', () => {
  it('keeps password attempts tight', () => {
    expect(LIMITS.login.limit).toBeLessThanOrEqual(10)
    expect(LIMITS.login.windowMs).toBeGreaterThanOrEqual(5 * 60 * 1000)
  })

  it('bounds transfers per hour', () => {
    expect(LIMITS.transfer.limit).toBeLessThanOrEqual(20)
  })

  it('is looser on reads than on writes', () => {
    expect(LIMITS.read.limit).toBeGreaterThan(LIMITS.transfer.limit)
  })
})

describe('clientKey', () => {
  it('prefers the platform-set x-real-ip', () => {
    // x-forwarded-for is client-controllable; x-real-ip is set by the platform.
    expect(clientKey(headers({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1' }))).toBe(
      '203.0.113.9',
    )
  })

  it('falls back to the left-most forwarded address', () => {
    expect(clientKey(headers({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18' }))).toBe('203.0.113.9')
  })

  it('trims whitespace', () => {
    expect(clientKey(headers({ 'x-forwarded-for': '  203.0.113.9  ' }))).toBe('203.0.113.9')
  })

  it('returns a constant when no forwarding header is present', () => {
    // Every such caller then shares one bucket, which fails closed rather than
    // handing out an unlimited budget per request.
    expect(clientKey(headers({}))).toBe('unknown')
  })

  it('does not crash on an empty forwarded header', () => {
    expect(clientKey(headers({ 'x-forwarded-for': '' }))).toBe('unknown')
  })
})
